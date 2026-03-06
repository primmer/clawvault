#!/usr/bin/env python3
"""
v32: Two-level retrieval — session-level embeddings + sentence-level drill-down.
Step 1: Embed session summaries, find top relevant sessions.
Step 2: Within those sessions, do sentence-level hybrid search.
This should improve recall for cross-session counting without adding noise.
"""
import json
import os
import sys
import re
import time
import numpy as np
from collections import defaultdict
from math import log
from sentence_transformers import SentenceTransformer

sys.path.insert(0, os.path.dirname(__file__))
from adapters.base import MemorySystem

DATA_DIR = os.path.join(os.path.dirname(__file__), "LongMemEval", "data")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

print("Loading embedding model...")
EMBED_MODEL = SentenceTransformer('all-MiniLM-L6-v2')
print("Model loaded.")


class ClawVaultV32(MemorySystem):
    name = "ClawVault-v32"

    def setup(self):
        self.sentences = []
        self.embeddings = None
        self.session_of = {}
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0
        self.session_texts = {}  # session_idx -> full concatenated text
        self.session_embeddings = None  # session-level embeddings
        self.session_indices = []  # ordered list of session indices

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def ingest_session(self, session_idx, messages, date):
        session_parts = []
        for msg in messages:
            content = msg.get("content", "")
            if not content:
                continue
            session_parts.append(content)
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date,
                    "role": msg.get("role", ""),
                })
                self.session_of[sid] = session_idx
        # Store truncated session summary for session-level embedding
        full_text = " ".join(session_parts)[:2000]
        self.session_texts[session_idx] = full_text

    def _tokenize(self, text):
        return re.findall(r'\w+', text.lower())

    def _build_bm25(self):
        self.bm25_docs = [self._tokenize(s["text"]) for s in self.sentences]
        N = len(self.bm25_docs)
        if N == 0:
            return
        df = defaultdict(int)
        for doc in self.bm25_docs:
            for t in set(doc):
                df[t] += 1
        self.bm25_idf = {t: log((N - f + 0.5) / (f + 0.5) + 1) for t, f in df.items()}
        self.bm25_avgdl = sum(len(d) for d in self.bm25_docs) / N

    def finalize_ingest(self):
        if not self.sentences:
            return
        texts = [s["text"] for s in self.sentences]
        self.embeddings = EMBED_MODEL.encode(texts, show_progress_bar=False)
        self._build_bm25()
        # Build session-level embeddings
        self.session_indices = sorted(self.session_texts.keys())
        if self.session_indices:
            session_texts_ordered = [self.session_texts[i] for i in self.session_indices]
            self.session_embeddings = EMBED_MODEL.encode(session_texts_ordered, show_progress_bar=False)

    def _bm25_score(self, query_tokens, doc_idx, k1=1.5, b=0.75):
        doc = self.bm25_docs[doc_idx]
        dl = len(doc)
        tf = defaultdict(int)
        for t in doc:
            tf[t] += 1
        score = 0.0
        for qt in query_tokens:
            if qt not in self.bm25_idf:
                continue
            f = tf.get(qt, 0)
            idf = self.bm25_idf[qt]
            score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / max(self.bm25_avgdl, 1)))
        return score

    def _bm25_search(self, query, top_k=30):
        qt = self._tokenize(query)
        scores = [(self._bm25_score(qt, i), i) for i in range(len(self.sentences))]
        scores.sort(reverse=True)
        return [(s, i) for s, i in scores[:top_k] if s > 0]

    def _semantic_search(self, query, top_k=30):
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.embeddings, axis=1) + 1e-10
        q_norm = np.linalg.norm(query_emb) + 1e-10
        sims = np.dot(self.embeddings, query_emb) / (norms * q_norm)
        top_idx = np.argsort(sims)[::-1][:top_k]
        return [(sims[i], i) for i in top_idx]

    def _reciprocal_rank_fusion(self, bm25_results, semantic_results, k=60):
        """Fuse two ranked lists using RRF."""
        scores = defaultdict(float)
        for rank, (_, sid) in enumerate(bm25_results):
            scores[sid] += 1.0 / (k + rank + 1)
        for rank, (_, sid) in enumerate(semantic_results):
            scores[sid] += 1.0 / (k + rank + 1)
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        return ranked

    def _session_search(self, query, top_k=15):
        """Find top relevant sessions via session-level semantic search."""
        if self.session_embeddings is None or len(self.session_indices) == 0:
            return set(range(100))  # fallback: all sessions
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.session_embeddings, axis=1) + 1e-10
        q_norm = np.linalg.norm(query_emb) + 1e-10
        sims = np.dot(self.session_embeddings, query_emb) / (norms * q_norm)
        top_idx = np.argsort(sims)[::-1][:top_k]
        return {self.session_indices[i] for i in top_idx}

    def query(self, question, question_date=None, **kwargs):
        # Step 1: Find relevant sessions at session level
        relevant_sessions = self._session_search(question, top_k=15)
        
        # Step 2: Sentence-level hybrid search within relevant sessions
        bm25_results = self._bm25_search(question, top_k=50)
        semantic_results = self._semantic_search(question, top_k=50)
        
        # Filter to relevant sessions + boost sentences from relevant sessions
        def filter_boost(results):
            boosted = []
            for score, sid in results:
                sess = self.session_of[sid]
                if sess in relevant_sessions:
                    boosted.append((score * 1.5, sid))
                else:
                    boosted.append((score * 0.5, sid))
            boosted.sort(reverse=True)
            return boosted[:30]
        
        bm25_filtered = filter_boost(bm25_results)
        semantic_filtered = filter_boost(semantic_results)
        
        fused = self._reciprocal_rank_fusion(bm25_filtered, semantic_filtered)
        
        # Cross-session diversity
        session_counts = defaultdict(int)
        selected = []
        for sid, score in fused:
            sess = self.session_of[sid]
            if session_counts[sess] < 5:
                selected.append(sid)
                session_counts[sess] += 1
            if len(selected) >= 25:
                break
        
        context_parts = []
        total = 0
        for sid in selected:
            s = self.sentences[sid]
            entry = f"[Session {s['session_idx']}][{s['date']}][{s['role']}] {s['text']}"
            if total + len(entry) > 8000:
                break
            context_parts.append(entry)
            total += len(entry)
        
        if not context_parts:
            return "I don't have enough information."
        
        context = "\n".join(context_parts)
        prompt = f"""Based on these conversation memories, answer the question.
Be precise. If counting, count carefully across ALL sessions/conversations.
Combine information from multiple conversations when needed.
Look for related items across different sessions.

MEMORIES:
{context}

QUESTION: {question}

Answer concisely:"""
        
        return self.ollama_generate(prompt, max_tokens=300)


def main():
    print("Loading multi-session questions...")
    with open(os.path.join(DATA_DIR, "multi_session_extracted.json")) as f:
        questions = json.load(f)
    print(f"Loaded {len(questions)} multi-session questions")

    output_file = os.path.join(RESULTS_DIR, "v32-multi-answers.jsonl")
    
    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    adapter = ClawVaultV32()
    
    for qi, q in enumerate(questions):
        qid = q["question_id"]
        if qid in done_ids:
            continue
        
        adapter.setup()
        sessions = q["haystack_sessions"]
        dates = q.get("haystack_dates", [])
        
        for si, session_msgs in enumerate(sessions):
            date = dates[si] if si < len(dates) else "unknown"
            adapter.ingest_session(si, session_msgs, date)
        
        adapter.finalize_ingest()
        
        t0 = time.time()
        answer = adapter.query(q["question"], q.get("question_date"))
        elapsed = time.time() - t0
        
        result = {
            "question_id": qid,
            "question": q["question"],
            "question_type": "multi-session",
            "predicted_answer": answer,
            "gold_answer": q.get("answer", ""),
        }
        
        with open(output_file, "a") as f:
            f.write(json.dumps(result) + "\n")
        
        done = len(done_ids) + qi + 1 - len([x for x in questions[:qi] if x["question_id"] in done_ids])
        print(f"[{done}/{len(questions)}] {qid} ({elapsed:.1f}s)")

    print(f"\nResults saved to {output_file}")


if __name__ == "__main__":
    main()
