#!/usr/bin/env python3
"""
Run v26 eval on multi-session questions only.
Usage: python3 run_v26_multi.py
"""
import json
import os
import sys
import re
import time
from collections import defaultdict
from math import log

sys.path.insert(0, os.path.dirname(__file__))
from adapters.base import MemorySystem

DATA_DIR = os.path.join(os.path.dirname(__file__), "LongMemEval", "data")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)


class ClawVaultV26(MemorySystem):
    name = "ClawVault-v26"

    def setup(self):
        self.sentences = []
        self.entity_index = defaultdict(set)  # entity -> set of sentence ids
        self.session_of = {}  # sentence_id -> session_idx
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def _extract_entities(self, text):
        entities = set()
        text_lower = text.lower()
        words = text.split()
        
        # Proper nouns (not at sentence start)
        for i, w in enumerate(words):
            clean = re.sub(r'[^\w]', '', w)
            if i > 0 and clean and clean[0].isupper() and len(clean) > 1 and clean.isalpha():
                entities.add(clean.lower())
        
        # Numbers with units
        for m in re.finditer(r'(\d+)\s*(days?|weeks?|hours?|items?|times?|dollars?|miles?|pounds?|kits?|trips?|movies?|books?|songs?|projects?|pieces?|pairs?|sets?)', text_lower):
            entities.add(m.group(0))

        # Key nouns
        noun_pat = r'\b(camping|hiking|cooking|reading|watching|playing|working|building|running|swimming|traveling|shopping|clothing|jacket|dress|shirt|pants|shoes|coat|sweater|return|pick up|store|mall|model|kit|movie|book|trip|project|recipe|restaurant)\b'
        for m in re.finditer(noun_pat, text_lower):
            entities.add(m.group(1))

        return entities

    def ingest_session(self, session_idx, messages, date):
        for msg in messages:
            content = msg.get("content", "")
            if not content:
                continue
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                entities = self._extract_entities(sent)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date,
                    "role": msg.get("role", ""), "entities": entities,
                })
                self.session_of[sid] = session_idx
                for ent in entities:
                    self.entity_index[ent].add(sid)

    def finalize_ingest(self):
        self._build_bm25()

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

    def _bm25_search(self, query, top_k=20):
        qt = self._tokenize(query)
        scores = [(self._bm25_score(qt, i), i) for i in range(len(self.sentences))]
        scores.sort(reverse=True)
        return [(s, i) for s, i in scores[:top_k] if s > 0]

    def _entity_expand(self, query, bm25_ids, max_expand=25):
        """Expand retrieval using entity graph — prioritize cross-session hits."""
        query_entities = self._extract_entities(query)
        # Add query keywords as pseudo-entities
        for w in self._tokenize(query):
            if len(w) > 3:
                query_entities.add(w)

        bm25_sessions = {self.session_of[sid] for sid in bm25_ids}
        bm25_set = set(bm25_ids)

        candidates = defaultdict(float)
        for ent in query_entities:
            for sid in self.entity_index.get(ent, set()):
                if sid not in bm25_set:
                    # Cross-session bonus
                    bonus = 2.0 if self.session_of[sid] not in bm25_sessions else 1.0
                    candidates[sid] += bonus

        ranked = sorted(candidates.items(), key=lambda x: -x[1])
        return [sid for sid, _ in ranked[:max_expand]]

    def query(self, question, question_date=None, **kwargs):
        bm25_results = self._bm25_search(question, top_k=15)
        bm25_ids = [sid for _, sid in bm25_results]
        expanded_ids = self._entity_expand(question, bm25_ids)
        
        all_ids = list(dict.fromkeys(bm25_ids + expanded_ids))  # deduplicate preserving order
        
        context_parts = []
        total = 0
        for sid in all_ids:
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

    output_file = os.path.join(RESULTS_DIR, "v26-multi-answers.jsonl")
    
    # Resume from existing results
    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    adapter = ClawVaultV26()
    
    for qi, q in enumerate(questions):
        qid = q["question_id"]
        if qid in done_ids:
            continue
        
        adapter.setup()
        
        # Ingest all haystack sessions
        sessions = q["haystack_sessions"]
        dates = q.get("haystack_dates", [])
        session_ids = q.get("haystack_session_ids", [])
        
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
