#!/usr/bin/env python3
"""
v32: Type-adaptive retrieval.
- multi-session/temporal: sentence-level hybrid BM25+semantic+RRF (v28)
- preference/assistant/user/knowledge: session-level retrieval (full conversations)

Key fix: v28 regressed preference 70→36.7% because sentence-level misses preference signals.
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
import ijson

sys.path.insert(0, os.path.dirname(__file__))
from adapters.base import MemorySystem

DATA_DIR = os.path.join(os.path.dirname(__file__), "LongMemEval", "data")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

print("Loading embedding model...")
EMBED_MODEL = SentenceTransformer('all-MiniLM-L6-v2')
print("Model loaded.")


class ClawVaultV34(MemorySystem):
    name = "ClawVault-v32"

    def setup(self):
        # Sentence-level (for multi-session/temporal)
        self.sentences = []
        self.sent_embeddings = None
        self.session_of_sent = {}
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0
        # Session-level (for preference/assistant/user/knowledge)
        self.sessions = []  # {idx, text, date, summary_emb}
        self.session_embeddings = None

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def ingest_session(self, session_idx, messages, date):
        # Build full session text for session-level retrieval
        session_text_parts = []
        for msg in messages:
            content = msg.get("content", "")
            if not content:
                continue
            role = msg.get("role", "")
            session_text_parts.append(f"[{role}] {content}")
            # Also split into sentences for sentence-level
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date, "role": role,
                })
                self.session_of_sent[sid] = session_idx

        session_text = "\n".join(session_text_parts)
        # Truncate session text for embedding (max 512 tokens ~ 2000 chars)
        self.sessions.append({
            "idx": session_idx, "text": session_text,
            "date": date, "summary": session_text[:2000],
        })

    def _tokenize(self, text):
        return re.findall(r'\w+', text.lower())

    def _build_bm25(self):
        self.bm25_docs = [self._tokenize(s["text"]) for s in self.sentences]
        N = len(self.bm25_docs)
        if N == 0: return
        df = defaultdict(int)
        for doc in self.bm25_docs:
            for t in set(doc): df[t] += 1
        self.bm25_idf = {t: log((N - f + 0.5) / (f + 0.5) + 1) for t, f in df.items()}
        self.bm25_avgdl = sum(len(d) for d in self.bm25_docs) / N

    def finalize_ingest(self):
        if not self.sentences: return
        # Sentence embeddings
        sent_texts = [s["text"] for s in self.sentences]
        self.sent_embeddings = EMBED_MODEL.encode(sent_texts, show_progress_bar=False)
        self._build_bm25()
        # Session embeddings (from summaries)
        sess_texts = [s["summary"] for s in self.sessions]
        self.session_embeddings = EMBED_MODEL.encode(sess_texts, show_progress_bar=False)

    def _bm25_score(self, query_tokens, doc_idx, k1=1.5, b=0.75):
        doc = self.bm25_docs[doc_idx]
        dl = len(doc)
        tf = defaultdict(int)
        for t in doc: tf[t] += 1
        score = 0.0
        for qt in query_tokens:
            if qt not in self.bm25_idf: continue
            f = tf.get(qt, 0)
            idf = self.bm25_idf[qt]
            score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / max(self.bm25_avgdl, 1)))
        return score

    def _sentence_retrieval(self, query, top_k=25):
        """v28 hybrid BM25+semantic+RRF at sentence level."""
        # BM25
        qt = self._tokenize(query)
        bm25_scores = [(self._bm25_score(qt, i), i) for i in range(len(self.sentences))]
        bm25_scores.sort(reverse=True)
        bm25_top = [(s, i) for s, i in bm25_scores[:30] if s > 0]
        # Semantic
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.sent_embeddings, axis=1) + 1e-10
        sims = np.dot(self.sent_embeddings, query_emb) / (norms * (np.linalg.norm(query_emb) + 1e-10))
        top_idx = np.argsort(sims)[::-1][:30]
        sem_top = [(sims[i], i) for i in top_idx]
        # RRF
        scores = defaultdict(float)
        for rank, (_, sid) in enumerate(bm25_top):
            scores[sid] += 1.0 / (60 + rank + 1)
        for rank, (_, sid) in enumerate(sem_top):
            scores[sid] += 1.0 / (60 + rank + 1)
        fused = sorted(scores.items(), key=lambda x: -x[1])
        # Cross-session diversity
        session_counts = defaultdict(int)
        selected = []
        for sid, _ in fused:
            sess = self.session_of_sent[sid]
            if session_counts[sess] < 5:
                selected.append(sid)
                session_counts[sess] += 1
            if len(selected) >= top_k: break
        # Build context
        parts = []
        total = 0
        for sid in selected:
            s = self.sentences[sid]
            entry = f"[Session {s['session_idx']}][{s['date']}][{s['role']}] {s['text']}"
            if total + len(entry) > 8000: break
            parts.append(entry)
            total += len(entry)
        return "\n".join(parts)

    def _session_retrieval(self, query, top_k=3):
        """Session-level semantic search — returns full conversations."""
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.session_embeddings, axis=1) + 1e-10
        sims = np.dot(self.session_embeddings, query_emb) / (norms * (np.linalg.norm(query_emb) + 1e-10))
        top_idx = np.argsort(sims)[::-1][:top_k]
        # Build context from full session texts
        parts = []
        total = 0
        for idx in top_idx:
            sess = self.sessions[idx]
            header = f"=== Session {sess['idx']} ({sess['date']}) ==="
            text = sess["text"]
            # Truncate long sessions
            if len(text) > 3000:
                text = text[:3000] + "..."
            entry = f"{header}\n{text}"
            if total + len(entry) > 8000: break
            parts.append(entry)
            total += len(entry)
        return "\n\n".join(parts)

    def query(self, question, question_date=None, question_type=None, **kwargs):
        # Type-adaptive retrieval
        use_session = question_type in ("single-session-preference", "single-session-assistant",
                                         "single-session-user", "knowledge-update")
        
        if use_session:
            context = self._session_retrieval(question, top_k=3)
        else:
            # multi-session, temporal-reasoning
            context = self._sentence_retrieval(question, top_k=25)

        if not context:
            return "I don't have enough information."

        prompt = f"""Based on these conversation memories, answer the question.
Be precise. If counting, count carefully across ALL sessions/conversations.
Combine information from multiple conversations when needed.
When asked for recommendations or suggestions, describe what the user would prefer based on their stated interests, experiences, and preferences from the conversations.

MEMORIES:
{context}

QUESTION: {question}

Answer concisely:"""
        return self.ollama_generate(prompt, max_tokens=300)


def stream_questions(filepath):
    with open(filepath, 'rb') as f:
        for item in ijson.items(f, 'item'):
            yield item


def main():
    data_file = os.path.join(DATA_DIR, "longmemeval_s_cleaned.json")
    output_file = os.path.join(RESULTS_DIR, "v34-ollama-gen-answers.jsonl")

    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    print("Streaming questions...")
    adapter = ClawVaultV34()
    done = len(done_ids)

    for q in stream_questions(data_file):
        qid = q["question_id"]
        if qid in done_ids: continue

        adapter.setup()
        sessions = q.get("haystack_sessions", [])
        dates = q.get("haystack_dates", [])
        for si, msgs in enumerate(sessions):
            date = dates[si] if si < len(dates) else "unknown"
            adapter.ingest_session(si, msgs, date)
        adapter.finalize_ingest()

        t0 = time.time()
        answer = adapter.query(q["question"], q.get("question_date"), q.get("question_type"))
        elapsed = time.time() - t0

        result = {
            "question_id": qid, "question": q["question"],
            "question_type": q.get("question_type", ""),
            "predicted_answer": answer, "gold_answer": q.get("answer", ""),
        }
        with open(output_file, "a") as f:
            f.write(json.dumps(result) + "\n")

        done += 1
        print(f"[{done}/500] {qid} ({q.get('question_type','?')}) ({elapsed:.1f}s)")

    print(f"\nResults saved to {output_file}")


if __name__ == "__main__":
    main()
