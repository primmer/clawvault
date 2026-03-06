"""
ClawVault v26 Eval Adapter — Entity-Graph Multi-Session Retrieval

Key insight: Multi-session questions (28.6% on v25) fail because retrieval
treats each memory independently. v26 adds entity-based cross-session linking:

1. During ingest: extract entities (people, places, objects, activities) per sentence
2. Build entity→sentence_id index
3. During query: extract query entities, expand retrieval with entity-linked sentences
4. Feed expanded context to Gemini Flash for answer generation

This targets the 28.6% multi-session score specifically.
"""

import json
import os
import re
import time
from collections import defaultdict
from math import log
from adapters.base import MemorySystem

class ClawVaultV26(MemorySystem):
    name = "ClawVault-v26"

    def setup(self):
        self.sentences = []       # list of {id, session_id, text, date, entities}
        self.entity_index = defaultdict(set)  # entity -> set of sentence ids
        self.session_index = defaultdict(list)  # session_id -> [sentence_ids]
        self.bm25_docs = []       # tokenized sentences for BM25
        self.bm25_idf = {}
        self.bm25_avgdl = 0
        self.bm25_N = 0
        self.next_id = 0

    def _split_sentences(self, text):
        """Split text into sentences, keeping meaningful chunks."""
        # Split on sentence boundaries but keep context
        raw = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        sentences = []
        for s in raw:
            s = s.strip()
            if len(s) > 20:  # skip tiny fragments
                sentences.append(s)
        # If no good splits, use the whole text
        if not sentences and text.strip():
            sentences = [text.strip()]
        return sentences

    def _extract_entities(self, text):
        """Extract entities from text using simple NER patterns.
        For eval speed, use regex. In production, use LLM.
        """
        entities = set()
        text_lower = text.lower()
        
        # Proper nouns (capitalized words not at sentence start)
        words = text.split()
        for i, w in enumerate(words):
            if i > 0 and w[0:1].isupper() and len(w) > 1 and w.isalpha():
                entities.add(w.lower())
            # Multi-word proper nouns
            if i > 0 and i < len(words) - 1:
                if w[0:1].isupper() and words[i+1][0:1].isupper():
                    entities.add(f"{w.lower()} {words[i+1].lower()}")

        # Numbers with units (quantities matter for multi-session aggregation)
        for m in re.finditer(r'(\d+)\s*(days?|weeks?|hours?|items?|times?|dollars?|miles?|pounds?|kits?|trips?|movies?|books?|songs?|projects?)', text_lower):
            entities.add(m.group(0))

        # Quoted terms
        for m in re.finditer(r'"([^"]+)"', text):
            entities.add(m.group(1).lower())

        # Key nouns (activities, objects) - extract via simple patterns
        activity_patterns = [
            r'\b(camping|hiking|cooking|reading|watching|playing|working|building|running|swimming|traveling|shopping)\b',
            r'\b(movie|book|song|game|project|trip|model|kit|recipe|restaurant|store|clothing|jacket|dress|shirt)\b',
        ]
        for pat in activity_patterns:
            for m in re.finditer(pat, text_lower):
                entities.add(m.group(1))

        return entities

    def ingest_session(self, session_id, messages, date):
        """Ingest a session by splitting into sentences and indexing entities."""
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not content:
                continue
            
            sentences = self._split_sentences(content)
            for sent in sentences:
                sid = self.next_id
                self.next_id += 1
                entities = self._extract_entities(sent)
                
                doc = {
                    "id": sid,
                    "session_id": session_id,
                    "text": sent,
                    "date": date,
                    "role": role,
                    "entities": entities,
                }
                self.sentences.append(doc)
                self.session_index[session_id].append(sid)
                
                # Index entities
                for ent in entities:
                    self.entity_index[ent].add(sid)

    def finalize_ingest(self):
        """Build BM25 index over all sentences."""
        self._build_bm25()
        print(f"[{self.name}] {len(self.sentences)} docs, {len(self.entity_index)} entities, {sum(len(v) for v in self.entity_index.values())} entity-links")

    def _tokenize(self, text):
        return re.findall(r'\w+', text.lower())

    def _build_bm25(self):
        """Build BM25 index."""
        self.bm25_docs = [self._tokenize(s["text"]) for s in self.sentences]
        self.bm25_N = len(self.bm25_docs)
        if self.bm25_N == 0:
            return
        
        # Calculate IDF
        df = defaultdict(int)
        for doc in self.bm25_docs:
            seen = set(doc)
            for term in seen:
                df[term] += 1
        
        self.bm25_idf = {}
        for term, freq in df.items():
            self.bm25_idf[term] = log((self.bm25_N - freq + 0.5) / (freq + 0.5) + 1)
        
        self.bm25_avgdl = sum(len(d) for d in self.bm25_docs) / self.bm25_N

    def _bm25_score(self, query_tokens, doc_idx, k1=1.5, b=0.75):
        """Score a single document against query."""
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
            num = f * (k1 + 1)
            den = f + k1 * (1 - b + b * dl / max(self.bm25_avgdl, 1))
            score += idf * num / den
        return score

    def _bm25_search(self, query, top_k=20):
        """BM25 search, return top_k (score, sentence_id) pairs."""
        query_tokens = self._tokenize(query)
        scores = []
        for i in range(self.bm25_N):
            s = self._bm25_score(query_tokens, i)
            if s > 0:
                scores.append((s, i))
        scores.sort(reverse=True)
        return scores[:top_k]

    def _entity_expand(self, query, bm25_ids, max_expand=30):
        """Expand retrieval using entity graph.
        
        1. Extract entities from query
        2. Find sentences sharing entities with query
        3. Prioritize sentences from DIFFERENT sessions than BM25 hits
           (this is key for multi-session questions)
        """
        query_entities = self._extract_entities(query)
        # Also add query keywords as pseudo-entities
        for word in self._tokenize(query):
            if len(word) > 3:
                query_entities.add(word)
        
        bm25_sessions = set()
        bm25_id_set = set(bm25_ids)
        for sid in bm25_ids:
            bm25_sessions.add(self.sentences[sid]["session_id"])
        
        # Find entity-linked sentences
        candidates = defaultdict(float)  # sentence_id -> entity overlap score
        for ent in query_entities:
            linked = self.entity_index.get(ent, set())
            for sid in linked:
                if sid not in bm25_id_set:
                    # Bonus for sentences from different sessions (cross-session signal)
                    session_bonus = 1.5 if self.sentences[sid]["session_id"] not in bm25_sessions else 1.0
                    candidates[sid] += session_bonus
        
        # Sort by entity overlap score
        ranked = sorted(candidates.items(), key=lambda x: -x[1])
        return [sid for sid, _ in ranked[:max_expand]]

    def query(self, question, question_date=None, haystack_session_ids=None):
        """Answer a question using BM25 + entity-graph expansion + Gemini."""
        # Step 1: BM25 retrieval
        bm25_results = self._bm25_search(question, top_k=15)
        bm25_ids = [sid for _, sid in bm25_results]
        
        # Step 2: Entity-graph expansion (key v26 innovation)
        expanded_ids = self._entity_expand(question, bm25_ids, max_expand=20)
        
        # Step 3: Combine and deduplicate, maintaining order
        all_ids = []
        seen = set()
        for sid in bm25_ids + expanded_ids:
            if sid not in seen:
                seen.add(sid)
                all_ids.append(sid)
        
        # Step 4: Build context (limit to ~6000 chars for Gemini context)
        context_parts = []
        total_chars = 0
        for sid in all_ids:
            sent = self.sentences[sid]
            entry = f"[{sent['date']}] [{sent['role']}] {sent['text']}"
            if total_chars + len(entry) > 6000:
                break
            context_parts.append(entry)
            total_chars += len(entry)
        
        if not context_parts:
            return "I don't have enough information to answer that question."
        
        context = "\n".join(context_parts)
        
        # Step 5: Generate answer with Gemini
        prompt = f"""Based on the following conversation memories, answer the user's question.
Be specific and precise. If the question asks for a count, count carefully across ALL memories.
If the answer requires combining information from multiple conversations, do so.

MEMORIES:
{context}

QUESTION: {question}

Answer concisely and directly:"""
        
        return self.ollama_generate(prompt, max_tokens=300)


# ---- Eval harness integration ----

def load_questions(path):
    with open(path) as f:
        return json.load(f)

def load_haystack(data_dir):
    """Load all session haystacks."""
    haystack_dir = os.path.join(data_dir, "custom_history")
    sessions = {}
    for fname in os.listdir(haystack_dir):
        if fname.endswith(".json"):
            with open(os.path.join(haystack_dir, fname)) as f:
                sessions[fname.replace(".json", "")] = json.load(f)
    return sessions

def run_eval(questions_file, data_dir, output_file, category=None):
    """Run the full eval pipeline."""
    questions = load_questions(questions_file)
    
    if category:
        questions = [q for q in questions if q.get("question_type") == category]
    
    print(f"Running v26 eval on {len(questions)} questions...")
    
    adapter = ClawVaultV26()
    results = []
    
    for qi, q in enumerate(questions):
        # Setup fresh adapter per question (simulates fresh vault)
        adapter.setup()
        
        # Ingest haystack sessions for this question
        haystack_dir = os.path.join(data_dir, "custom_history")
        for session_id_entry in q.get("haystack_dates", []):
            # Sessions are referenced by haystack_session_ids or we load all
            pass
        
        # Load the session files referenced in the question
        sessions_loaded = set()
        for hdate in q.get("haystack_dates", []):
            # Each question has pre-built haystack files
            pass
        
        # Actually: LongMemEval provides session data inline or via files
        # Let's use the longmemeval_m_cleaned.json which has full sessions
        if qi == 0:
            # Load full dataset once
            full_data_path = os.path.join(data_dir, "longmemeval_m_cleaned.json")
            if os.path.exists(full_data_path):
                with open(full_data_path) as f:
                    full_data = json.load(f)
        
        # Find this question in full data and get its haystack
        qid = q["question_id"]
        for entry in full_data:
            if entry.get("question_id") == qid:
                # Ingest haystack sessions
                for session in entry.get("haystack_sessions", []):
                    sid = session.get("session_id", f"s{len(sessions_loaded)}")
                    date = session.get("date", "unknown")
                    messages = session.get("messages", [])
                    adapter.ingest_session(sid, messages, date)
                    sessions_loaded.add(sid)
                break
        
        adapter.finalize_ingest()
        
        # Query
        answer = adapter.query(q["question"], q.get("question_date"))
        
        results.append({
            "question_id": qid,
            "question": q["question"],
            "question_type": q.get("question_type", ""),
            "predicted_answer": answer,
            "gold_answer": q.get("answer", ""),
        })
        
        elapsed = (qi + 1)
        print(f"[{elapsed}/{len(questions)}] {qid} ({q.get('question_type', '?')}) ~{elapsed}q done")
    
    # Save results
    with open(output_file, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    
    print(f"Results saved to {output_file}")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", default=None, help="Filter by question type (e.g. multi-session)")
    parser.add_argument("--output", default="results/v26-answers.jsonl")
    args = parser.parse_args()
    
    data_dir = os.path.join(os.path.dirname(__file__), "..", "LongMemEval", "data")
    questions_file = os.path.join(data_dir, "multi_session_extracted.json")
    
    if args.category == "all":
        # Use the full question set
        questions_file = os.path.join(data_dir, "longmemeval_s_cleaned.json")
    
    run_eval(questions_file, data_dir, args.output, args.category)
