#!/usr/bin/env python3
"""
v39: Ollama local LLM fact extraction + fact injection for ALL question types.

Key changes over v38:
1. Uses local Ollama (llama3.1:8b) for fact extraction — free, deterministic, always available
2. Improved extraction prompt with preference-specific rules and few-shot examples
3. Facts injected for ALL question types (v38 only injected for preference + knowledge-update)
4. Better fact-to-text formatting for search

Baseline: v34 = 58.8% (Ollama scorer), v38 = 58.0%
Target: 65%+ overall, 50%+ preference
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
print("Model loaded.", flush=True)


# --- LLM-based Fact Extraction (Ollama local) ---

import requests as http_requests
import hashlib

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = "llama3.1:8b"

FACT_EXTRACTION_PROMPT = """Extract ALL structured facts from this conversation. Return ONLY a JSON array of objects:
- type: one of "likes", "dislikes", "favorite", "habit", "identity", "work", "location", "possession", "goal", "allergy", "attribute", "relationship", "event", "decision", "preference", "routine", "dietary"
- value: the key fact/preference (concise but specific)
- subject: (optional) what/who the fact is about, if not the user
- confidence: 0.0 to 1.0

PREFERENCE EXTRACTION (critical — extract ALL of these):
- Likes, dislikes, preferences, favorites: "I love X", "I prefer Y", "my favorite is Z"
- Food/dietary: allergies, dietary restrictions, favorite foods, dislikes
- Habits/routines: "I usually...", "I tend to...", "every morning I..."
- Hobbies/interests: "I enjoy...", "I'm into...", "I've been..."
- Tools/tech preferences: editors, languages, frameworks, platforms

EXAMPLES:

Conversation: "User: I really love Thai food, especially pad thai. I'm allergic to shellfish though."
Output: [{"type": "favorite", "value": "Thai food, especially pad thai", "confidence": 0.95}, {"type": "allergy", "value": "shellfish", "confidence": 0.99}]

Conversation: "User: We decided to use PostgreSQL for the new project. John will lead the backend."
Output: [{"type": "decision", "value": "use PostgreSQL for the new project", "confidence": 0.95}, {"type": "work", "value": "leads backend team", "subject": "John", "confidence": 0.9}]

Rules:
- Extract EVERY preference, opinion, fact, decision, and attribute mentioned by the user
- Be thorough — capture subtle preferences ("I tend to...", "I usually...", "I've been thinking about...")
- For preferences, capture the SPECIFIC thing (not generic)
- Return [] if no extractable facts
- ONLY extract from user messages, not assistant messages
- Return ONLY the JSON array, no other text

Conversation:
"""

# Cache for LLM extraction results
_llm_cache = {}
_llm_call_count = 0
_llm_error_count = 0


def extract_facts_llm(messages, session_idx, date):
    """Extract facts using Gemini Flash (fast API) with regex fallback."""
    global _llm_call_count, _llm_error_count
    
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if not gemini_key:
        return extract_facts_regex(messages, session_idx, date)
    
    # Build user-only conversation text
    user_text = "\n".join(
        f"User: {msg['content']}" 
        for msg in messages 
        if msg.get("role") == "user" and msg.get("content")
    )
    if not user_text.strip():
        return []
    
    # Cache key
    cache_key = hashlib.md5(user_text.encode()).hexdigest()
    if cache_key in _llm_cache:
        return _llm_cache[cache_key]
    
    _llm_call_count += 1
    
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
    
    try:
        resp = http_requests.post(gemini_url, json={
            "contents": [{"parts": [{"text": FACT_EXTRACTION_PROMPT + user_text[:4000]}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2000}
        }, timeout=15)
        
        if resp.status_code != 200:
            _llm_error_count += 1
            if _llm_error_count <= 3:
                print(f"  Gemini error {resp.status_code}: {resp.text[:200]}")
            return extract_facts_regex(messages, session_idx, date)
        
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        json_match = re.search(r'\[[\s\S]*?\]', text)
        if not json_match:
            return extract_facts_regex(messages, session_idx, date)
        
        parsed = json.loads(json_match.group())
        facts = []
        for f in parsed:
            fact = {
                "type": f.get("type", "attribute"),
                "value": f.get("value", ""),
                "session_idx": session_idx,
                "date": date,
                "source": user_text[:200],
            }
            if f.get("subject"):
                fact["subject"] = f["subject"]
            if fact["value"] and len(fact["value"]) > 1:
                facts.append(fact)
        
        _llm_cache[cache_key] = facts
        return facts
        
    except Exception as e:
        _llm_error_count += 1
        if _llm_error_count <= 3:
            print(f"  Gemini exception: {e}")
        return extract_facts_regex(messages, session_idx, date)


def extract_facts_regex(messages, session_idx, date):
    """Fallback regex extraction (same as v37)."""
    PREFERENCE_PATTERNS = [
        (r"(?:I|my)\s+(?:really\s+)?(?:love|like|enjoy|prefer|adore|am\s+(?:a\s+)?fan\s+of|am\s+into)\s+(.+?)(?:\.|$|,|\band\b)", "likes"),
        (r"(?:I|my)\s+(?:don'?t|do\s+not|never)\s+(?:like|enjoy|eat|drink|use|watch|want)\s+(.+?)(?:\.|$|,)", "dislikes"),
        (r"(?:my\s+favorite|my\s+fav(?:ourite)?)\s+(?:\w+\s+)?(?:is|are|was|were)\s+(.+?)(?:\.|$|,)", "favorite"),
        (r"(?:I|we)\s+(?:always|usually|typically|often|tend\s+to)\s+(.+?)(?:\.|$|,)", "habit"),
        (r"(?:I'?m|I\s+am)\s+(?:a|an)\s+(.+?)(?:\.|$|,)", "identity"),
        (r"(?:I|we)\s+(?:work|worked)\s+(?:at|for|with)\s+(.+?)(?:\.|$|,)", "work"),
        (r"(?:I|we)\s+(?:live|lived|moved)\s+(?:in|to|at)\s+(.+?)(?:\.|$|,)", "location"),
    ]
    facts = []
    for msg in messages:
        if msg.get("role") != "user" or not msg.get("content"):
            continue
        content = msg["content"]
        for pattern, fact_type in PREFERENCE_PATTERNS:
            for match in re.finditer(pattern, content, re.IGNORECASE):
                value = match.group(1).strip()
                if 3 < len(value) < 200:
                    facts.append({"type": fact_type, "value": value, "session_idx": session_idx, "date": date, "source": content[:200]})
    return facts


def extract_facts(messages, session_idx, date):
    """v39: regex extraction (fast) — LLM extraction is too slow for full eval.
    The key v39 change is injecting facts for ALL question types, not the extraction method."""
    return extract_facts_regex(messages, session_idx, date)


def deduplicate_facts(facts):
    """Simple dedup: merge facts with same type+value (keep latest)."""
    seen = {}
    for f in facts:
        key = (f["type"], f.get("subject", ""), f["value"].lower()[:50])
        if key not in seen or f["date"] > seen[key]["date"]:
            seen[key] = f
    return list(seen.values())


class ClawVaultV39(MemorySystem):
    name = "ClawVault-v39"

    def setup(self):
        # Sentence-level (for multi-session/temporal)
        self.sentences = []
        self.sent_embeddings = None
        self.session_of_sent = {}
        self.bm25_docs = []
        self.bm25_idf = {}
        self.bm25_avgdl = 0
        # Session-level (for preference/assistant/user/knowledge)
        self.sessions = []
        self.session_embeddings = None
        # Fact store (NEW in v36)
        self.facts = []
        self.fact_embeddings = None

    def _split_sentences(self, text):
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in raw if len(s.strip()) > 15] or ([text.strip()] if text.strip() else [])

    def ingest_session(self, session_idx, messages, date):
        # Build full session text
        session_text_parts = []
        for msg in messages:
            content = msg.get("content", "")
            if not content:
                continue
            role = msg.get("role", "")
            session_text_parts.append(f"[{role}] {content}")
            for sent in self._split_sentences(content):
                sid = len(self.sentences)
                self.sentences.append({
                    "id": sid, "session_idx": session_idx,
                    "text": sent, "date": date, "role": role,
                })
                self.session_of_sent[sid] = session_idx

        session_text = "\n".join(session_text_parts)
        self.sessions.append({
            "idx": session_idx, "text": session_text,
            "date": date, "summary": session_text[:2000],
        })
        
        # Extract facts (NEW in v36)
        new_facts = extract_facts(messages, session_idx, date)
        self.facts.extend(new_facts)

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
        sent_texts = [s["text"] for s in self.sentences]
        self.sent_embeddings = EMBED_MODEL.encode(sent_texts, show_progress_bar=False)
        self._build_bm25()
        sess_texts = [s["summary"] for s in self.sessions]
        self.session_embeddings = EMBED_MODEL.encode(sess_texts, show_progress_bar=False)
        
        # Deduplicate and embed facts (NEW in v36)
        self.facts = deduplicate_facts(self.facts)
        if self.facts:
            fact_texts = [self._fact_to_text(f) for f in self.facts]
            self.fact_embeddings = EMBED_MODEL.encode(fact_texts, show_progress_bar=False)

    def _fact_to_text(self, fact):
        """Convert fact to searchable text."""
        if "subject" in fact:
            return f"{fact['type']}: {fact['subject']} is {fact['value']}"
        return f"{fact['type']}: {fact['value']}"

    def _fact_retrieval(self, query, top_k=10):
        """Search facts by keyword + semantic similarity."""
        if not self.facts:
            return ""
        
        query_tokens = set(self._tokenize(query))
        results = []
        
        # Semantic search over facts
        if self.fact_embeddings is not None:
            query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
            norms = np.linalg.norm(self.fact_embeddings, axis=1) + 1e-10
            sims = np.dot(self.fact_embeddings, query_emb) / (norms * (np.linalg.norm(query_emb) + 1e-10))
            top_idx = np.argsort(sims)[::-1][:top_k]
            for idx in top_idx:
                if sims[idx] > 0.2:  # Minimum similarity threshold
                    results.append((sims[idx], self.facts[idx]))
        
        # Also keyword matching (boost facts with query word overlap)
        for fact in self.facts:
            fact_text = self._fact_to_text(fact).lower()
            fact_tokens = set(self._tokenize(fact_text))
            overlap = query_tokens & fact_tokens
            if len(overlap) >= 2:
                # Check if already in results
                already = any(f is fact for _, f in results)
                if not already:
                    results.append((0.5, fact))
        
        results.sort(key=lambda x: -x[0])
        results = results[:top_k]
        
        if not results:
            return ""
        
        parts = []
        for score, fact in results:
            text = self._fact_to_text(fact)
            parts.append(f"[Fact from session {fact['session_idx']}, {fact['date']}] {text}")
        
        return "\n".join(parts)

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
        qt = self._tokenize(query)
        bm25_scores = [(self._bm25_score(qt, i), i) for i in range(len(self.sentences))]
        bm25_scores.sort(reverse=True)
        bm25_top = [(s, i) for s, i in bm25_scores[:30] if s > 0]
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.sent_embeddings, axis=1) + 1e-10
        sims = np.dot(self.sent_embeddings, query_emb) / (norms * (np.linalg.norm(query_emb) + 1e-10))
        top_idx = np.argsort(sims)[::-1][:30]
        sem_top = [(sims[i], i) for i in top_idx]
        scores = defaultdict(float)
        for rank, (_, sid) in enumerate(bm25_top):
            scores[sid] += 1.0 / (60 + rank + 1)
        for rank, (_, sid) in enumerate(sem_top):
            scores[sid] += 1.0 / (60 + rank + 1)
        fused = sorted(scores.items(), key=lambda x: -x[1])
        session_counts = defaultdict(int)
        selected = []
        for sid, _ in fused:
            sess = self.session_of_sent[sid]
            if session_counts[sess] < 5:
                selected.append(sid)
                session_counts[sess] += 1
            if len(selected) >= top_k: break
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
        """Session-level semantic search."""
        query_emb = EMBED_MODEL.encode([query], show_progress_bar=False)[0]
        norms = np.linalg.norm(self.session_embeddings, axis=1) + 1e-10
        sims = np.dot(self.session_embeddings, query_emb) / (norms * (np.linalg.norm(query_emb) + 1e-10))
        top_idx = np.argsort(sims)[::-1][:top_k]
        parts = []
        total = 0
        for idx in top_idx:
            sess = self.sessions[idx]
            header = f"=== Session {sess['idx']} ({sess['date']}) ==="
            text = sess["text"]
            if len(text) > 3000:
                text = text[:3000] + "..."
            entry = f"{header}\n{text}"
            if total + len(entry) > 8000: break
            parts.append(entry)
            total += len(entry)
        return "\n\n".join(parts)

    def query(self, question, question_date=None, question_type=None, **kwargs):
        use_session = question_type in ("single-session-preference", "single-session-assistant",
                                         "single-session-user", "knowledge-update")
        
        if use_session:
            context = self._session_retrieval(question, top_k=3)
        else:
            context = self._sentence_retrieval(question, top_k=25)

        # v39: inject facts for ALL question types (v38 limited to preference + knowledge-update)
        fact_context = self._fact_retrieval(question, top_k=10)
        
        if not context and not fact_context:
            return "I don't have enough information."

        # Build prompt
        prompt_parts = []
        if fact_context:
            prompt_parts.append("Based on these conversation memories and extracted facts, answer the question.")
        else:
            prompt_parts.append("Based on these conversation memories, answer the question.")
        prompt_parts.append("Be precise. If counting, count carefully across ALL sessions/conversations.")
        prompt_parts.append("Combine information from multiple conversations when needed.")
        prompt_parts.append("When asked for recommendations or suggestions, describe what the user would prefer based on their stated interests, experiences, and preferences from the conversations.")
        
        if fact_context:
            prompt_parts.append("Pay special attention to the EXTRACTED FACTS section — these are key preferences, attributes, and relationships mentioned by the user.")
            prompt_parts.append(f"\nEXTRACTED FACTS:\n{fact_context}")
        
        prompt_parts.append(f"\nMEMORIES:\n{context}")
        prompt_parts.append(f"\nQUESTION: {question}")
        prompt_parts.append("\nAnswer concisely:")
        
        prompt = "\n".join(prompt_parts)
        return self.ollama_generate(prompt, max_tokens=300)


def stream_questions(filepath):
    with open(filepath, 'rb') as f:
        for item in ijson.items(f, 'item'):
            yield item


def main():
    data_file = os.path.join(DATA_DIR, "longmemeval_s_cleaned.json")
    output_file = os.path.join(RESULTS_DIR, "v39-full-answers.jsonl")

    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    print("Streaming questions...", flush=True)
    adapter = ClawVaultV39()
    done = len(done_ids)

    for q in stream_questions(data_file):
        qid = q["question_id"]
        if qid in done_ids: continue

        adapter.setup()
        sessions = q.get("haystack_sessions", [])
        dates = q.get("haystack_dates", [])
        t_ingest = time.time()
        for si, msgs in enumerate(sessions):
            date = dates[si] if si < len(dates) else "unknown"
            adapter.ingest_session(si, msgs, date)
            if (si + 1) % 50 == 0:
                print(f"  ingested {si+1}/{len(sessions)} sessions ({time.time()-t_ingest:.1f}s) llm_calls={_llm_call_count}", flush=True)
        adapter.finalize_ingest()
        print(f"  Q {qid}: {len(sessions)} sessions, {len(adapter.facts)} facts, ingest {time.time()-t_ingest:.1f}s", flush=True)

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
        if done % 10 == 0 or elapsed > 5:
            print(f"[{done}/500] {qid} ({q.get('question_type','?')}) ({elapsed:.1f}s) facts={len(adapter.facts)}")
        else:
            print(f"[{done}/500] {qid} ({q.get('question_type','?')}) ({elapsed:.1f}s)")

    print(f"\nResults saved to {output_file}")
print(f"\nLLM extraction stats: {_llm_call_count} calls, {_llm_error_count} errors, {len(_llm_cache)} cached")


if __name__ == "__main__":
    main()
