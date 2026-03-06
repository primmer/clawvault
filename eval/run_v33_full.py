#!/usr/bin/env python3
"""
v33: v28 hybrid retrieval + preference-aware context expansion.
For preference questions: after RRF ranking, expand each selected sentence
to include its full surrounding conversation (same session messages).
For all other types: use v28 as-is.
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


class ClawVaultV33(MemorySystem):
    name = "ClawVault-v33"

    def setup(self):
        self.sentences = []
        self.sent_embeddings = None
        self.session_of = {}
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0
        # Keep full session texts for context expansion
        self.session_texts = {}  # session_idx -> full text

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def ingest_session(self, session_idx, messages, date):
        session_parts = []
        for msg in messages:
            content = msg.get("content", "")
            if not content: continue
            role = msg.get("role", "")
            session_parts.append(f"[{role}] {content}")
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date, "role": role,
                })
                self.session_of[sid] = session_idx
        self.session_texts[session_idx] = {"text": "\n".join(session_parts), "date": date}

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
        texts = [s["text"] for s in self.sentences]
        self.sent_embeddings = EMBED_MODEL.encode(texts, show_progress_bar=False)
        self._build_bm25()

    def _bm25_score(self, qt, i, k1=1.5, b=0.75):
        doc = self.bm25_docs[i]
        dl = len(doc)
        tf = defaultdict(int)
        for t in doc: tf[t] += 1
        s = 0.0
        for q in qt:
            if q not in self.bm25_idf: continue
            f = tf.get(q, 0)
            s += self.bm25_idf[q] * f * (k1+1) / (f + k1*(1-b+b*dl/max(self.bm25_avgdl,1)))
        return s

    def _hybrid_rrf(self, query, top_k=30):
        """v28 hybrid BM25+semantic+RRF."""
        qt = self._tokenize(query)
        bm25 = sorted([(self._bm25_score(qt, i), i) for i in range(len(self.sentences))], reverse=True)[:30]
        bm25 = [(s,i) for s,i in bm25 if s > 0]
        
        qe = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.sent_embeddings, axis=1) + 1e-10
        sims = np.dot(self.sent_embeddings, qe) / (norms * (np.linalg.norm(qe) + 1e-10))
        top_sem = np.argsort(sims)[::-1][:30]
        sem = [(sims[i], i) for i in top_sem]
        
        scores = defaultdict(float)
        for rank, (_, sid) in enumerate(bm25):
            scores[sid] += 1.0 / (60 + rank + 1)
        for rank, (_, sid) in enumerate(sem):
            scores[sid] += 1.0 / (60 + rank + 1)
        return sorted(scores.items(), key=lambda x: -x[1])

    def _build_context_sentences(self, fused, max_chars=8000):
        """Standard v28 sentence-level context."""
        session_counts = defaultdict(int)
        selected = []
        for sid, _ in fused:
            sess = self.session_of[sid]
            if session_counts[sess] < 5:
                selected.append(sid)
                session_counts[sess] += 1
            if len(selected) >= 25: break
        parts = []
        total = 0
        for sid in selected:
            s = self.sentences[sid]
            entry = f"[Session {s['session_idx']}][{s['date']}][{s['role']}] {s['text']}"
            if total + len(entry) > max_chars: break
            parts.append(entry)
            total += len(entry)
        return "\n".join(parts)

    def _build_context_preference(self, fused, max_chars=8000):
        """For preference: find top sessions from RRF, include FULL conversation."""
        # Get top sessions by aggregated RRF score
        session_scores = defaultdict(float)
        for sid, score in fused:
            session_scores[self.session_of[sid]] += score
        top_sessions = sorted(session_scores.items(), key=lambda x: -x[1])[:3]
        
        parts = []
        total = 0
        for sess_idx, _ in top_sessions:
            sess = self.session_texts.get(sess_idx, {})
            text = sess.get("text", "")
            date = sess.get("date", "unknown")
            # Truncate individual sessions if needed
            if len(text) > max_chars // 2:
                text = text[:max_chars // 2] + "..."
            entry = f"=== Conversation ({date}) ===\n{text}"
            if total + len(entry) > max_chars: break
            parts.append(entry)
            total += len(entry)
        return "\n\n".join(parts)

    def query(self, question, question_date=None, question_type=None, **kwargs):
        fused = self._hybrid_rrf(question)

        if question_type == "single-session-preference":
            context = self._build_context_preference(fused)
        else:
            context = self._build_context_sentences(fused)

        if not context:
            return "I don't have enough information."

        prompt = f"""Based on these conversation memories, answer the question.
Be precise. If counting, count carefully across ALL sessions/conversations.
Combine information from multiple conversations when needed.

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
    output_file = os.path.join(RESULTS_DIR, "v33-full-answers.jsonl")

    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    print("Streaming questions...")
    adapter = ClawVaultV33()
    done = len(done_ids)

    for q in stream_questions(data_file):
        qid = q["question_id"]
        if qid in done_ids: continue
        adapter.setup()
        for si, msgs in enumerate(q.get("haystack_sessions", [])):
            date = q["haystack_dates"][si] if si < len(q.get("haystack_dates",[])) else "unknown"
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
