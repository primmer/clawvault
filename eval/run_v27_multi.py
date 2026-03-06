#!/usr/bin/env python3
"""
v27: Semantic embedding retrieval for multi-session questions.
Uses Gemini embedding API for cross-session similarity.
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

# Load model once
print("Loading embedding model...")
EMBED_MODEL = SentenceTransformer('all-MiniLM-L6-v2')
print("Model loaded.")


class ClawVaultV27(MemorySystem):
    name = "ClawVault-v27"

    def setup(self):
        self.sentences = []  # {id, session_idx, text, date, role}
        self.embeddings = []  # parallel to sentences
        self.session_of = {}

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

    def finalize_ingest(self):
        """Embed all sentences."""
        if not self.sentences:
            return
        texts = [s["text"] for s in self.sentences]
        self.embeddings = EMBED_MODEL.encode(texts, show_progress_bar=False)

    def _semantic_search(self, query, top_k=30):
        """Search by cosine similarity to query embedding."""
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        
        # Vectorized cosine similarity
        norms = np.linalg.norm(self.embeddings, axis=1) + 1e-10
        q_norm = np.linalg.norm(query_emb) + 1e-10
        sims = np.dot(self.embeddings, query_emb) / (norms * q_norm)
        
        top_idx = np.argsort(sims)[::-1][:top_k]
        return [(sims[i], i) for i in top_idx]

    def query(self, question, question_date=None, **kwargs):
        results = self._semantic_search(question, top_k=30)
        
        # Ensure cross-session diversity: pick top from each session
        session_counts = defaultdict(int)
        selected = []
        for score, sid in results:
            sess = self.session_of[sid]
            if session_counts[sess] < 5:  # max 5 sentences per session
                selected.append(sid)
                session_counts[sess] += 1
            if len(selected) >= 20:
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

    output_file = os.path.join(RESULTS_DIR, "v27-multi-answers.jsonl")
    
    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    adapter = ClawVaultV27()
    
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
