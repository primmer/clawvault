#!/usr/bin/env python3
"""
v30: v28 hybrid BM25+semantic + query expansion via LLM.
Generate 3 query variants, search each, fuse all results.
Keep v28's proven 8K context + concise prompt.
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


class ClawVaultV30(MemorySystem):
    name = "ClawVault-v30"

    def setup(self):
        self.sentences = []
        self.embeddings = None
        self.session_of = {}
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def ingest_session(self, session_idx, messages, date):
        for msg in messages:
            content = msg.get("content", "")
            if not content:
                continue
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date,
                    "role": msg.get("role", ""),
                })
                self.session_of[sid] = session_idx

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

    def _reciprocal_rank_fusion(self, *ranked_lists, k=60):
        """Fuse multiple ranked lists using RRF."""
        scores = defaultdict(float)
        for ranked in ranked_lists:
            for rank, (_, sid) in enumerate(ranked):
                scores[sid] += 1.0 / (k + rank + 1)
        return sorted(scores.items(), key=lambda x: -x[1])

    def _expand_query(self, question):
        """Generate query variants using LLM."""
        prompt = f"""Given this question about past conversations, generate 2 alternative search queries that would help find the relevant information. Output ONLY the queries, one per line. No numbering, no explanation.

Question: {question}

Alternative queries:"""
        result = self.ollama_generate(prompt, max_tokens=100)
        variants = [q.strip().strip('-').strip('•').strip() for q in result.strip().split('\n') if q.strip() and len(q.strip()) > 10]
        return variants[:2]

    def query(self, question, question_date=None, **kwargs):
        # Get query variants
        variants = self._expand_query(question)
        all_queries = [question] + variants

        # Search with each query and collect all ranked lists
        all_bm25 = []
        all_semantic = []
        for q in all_queries:
            all_bm25.append(self._bm25_search(q, top_k=30))
            all_semantic.append(self._semantic_search(q, top_k=30))

        # Fuse all ranked lists together
        fused = self._reciprocal_rank_fusion(*(all_bm25 + all_semantic))

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

    output_file = os.path.join(RESULTS_DIR, "v30-multi-answers.jsonl")

    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    adapter = ClawVaultV30()

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
