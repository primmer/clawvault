#!/usr/bin/env python3
"""
ClawVault LongMemEval adapter v35.

This runner extends the v34-style BM25 + semantic retrieval pipeline with:
1) ingest-time fact extraction,
2) an in-memory fact store with conflict resolution and temporal validity,
3) an entity graph with multi-hop traversal,
4) type-adaptive structured lookup for preference/entity/temporal questions,
5) RRF fusion across structured + lexical + semantic retrieval streams.

Notes:
- The repository snapshot used for this task does not include run_v34_full.py.
- To keep behavior compatible with future branches, this file attempts to import
  v34 scoring functions when present; otherwise it falls back to local scoring.
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import json
import math
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


WORD_RE = re.compile(r"[a-zA-Z0-9']+")
DATE_RE = re.compile(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b")
YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2}|21\d{2})\b")
INT_RE = re.compile(r"-?\d+")
ABSTENTION_RE = re.compile(
    r"\b("
    r"i\s+don'?t\s+know|"
    r"do\s+not\s+know|"
    r"unknown|"
    r"not\s+enough\s+information|"
    r"insufficient\s+information|"
    r"cannot\s+determine|"
    r"can't\s+determine"
    r")\b",
    flags=re.IGNORECASE,
)
ANSWER_CLAUSE_SPLIT_RE = re.compile(
    r"\b(?:because|since|which|that|who|when|while|although|though|but)\b",
    flags=re.IGNORECASE,
)
TIME_VALUE_RE = re.compile(r"\b\d{1,2}:\d{2}(?:\s*(?:am|pm))?\b|\b\d{1,2}\s*(?:am|pm)\b", flags=re.IGNORECASE)
NUMBER_VALUE_RE = re.compile(r"\b-?\d+(?:,\d{3})*(?:\.\d+)?\b")
DURATION_VALUE_RE = re.compile(r"\b-?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b", flags=re.IGNORECASE)
MONEY_OR_PERCENT_RE = re.compile(r"\$\s*-?\d+(?:,\d{3})*(?:\.\d+)?|\b-?\d+(?:,\d{3})*(?:\.\d+)?\s*%", flags=re.IGNORECASE)

FIRST_PERSON = {"i", "me", "my", "mine", "myself"}
USER_ROLE_ALIASES = {
    "user",
    "human",
    "speaker_1",
    "participant_1",
    "customer",
    "client",
    "person",
}
RELATION_ALIASES = {
    "work": "works_at",
    "works": "works_at",
    "work_at": "works_at",
    "works_at": "works_at",
    "work_for": "works_at",
    "works_for": "works_at",
    "live": "lives_in",
    "lives": "lives_in",
    "lived": "lives_in",
    "live_in": "lives_in",
    "lives_in": "lives_in",
    "from": "lives_in",
    "age": "age",
    "years_old": "age",
    "old": "age",
    "buy": "bought",
    "bought": "bought",
    "partner": "partner",
    "spouse": "partner",
    "wife": "partner",
    "husband": "partner",
    "boyfriend": "partner",
    "girlfriend": "partner",
    "favorite": "favorite",
    "likes": "likes",
    "like": "likes",
    "prefers": "prefers",
    "prefer": "prefers",
    "hates": "hates",
    "hate": "hates",
    "allergic": "allergic_to",
    "allergic_to": "allergic_to",
    "decided_to": "decided_to",
    "chose_over": "chose_over",
}
COLOR_WORDS = {
    "red",
    "blue",
    "green",
    "yellow",
    "orange",
    "purple",
    "pink",
    "black",
    "white",
    "gray",
    "grey",
    "brown",
    "beige",
    "teal",
    "navy",
    "gold",
    "silver",
    "maroon",
    "lavender",
}
COLOR_VALUE_RE = re.compile(r"\b(" + "|".join(sorted(COLOR_WORDS)) + r")\b", flags=re.IGNORECASE)
IRREGULAR_VERB_FORMS = {
    "buy": "bought",
    "go": "went",
    "get": "got",
    "make": "made",
    "take": "took",
    "choose": "chose",
    "redeem": "redeemed",
    "write": "wrote",
    "eat": "ate",
    "drink": "drank",
    "drive": "drove",
    "run": "ran",
}


def tokenize(text: str) -> List[str]:
    if not text:
        return []
    return [m.group(0).lower() for m in WORD_RE.finditer(text)]


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_key(text: str) -> str:
    toks = tokenize(text)
    if not toks:
        return normalize_space(text).lower()
    return "_".join(toks)


def normalize_relation(rel: str) -> str:
    key = normalize_key(rel).strip("_")
    return RELATION_ALIASES.get(key, key)


def coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return normalize_space(value)
    if isinstance(value, (int, float, bool)):
        return normalize_space(str(value))
    if isinstance(value, list):
        parts = [coerce_text(part) for part in value]
        return normalize_space(" ".join(part for part in parts if part))
    if isinstance(value, dict):
        if normalize_key(str(value.get("type", ""))) == "text":
            typed = coerce_text(value.get("text") or value.get("content"))
            if typed:
                return typed
        for key in ("content", "text", "value", "body", "utterance", "parts", "message"):
            if key not in value:
                continue
            extracted = coerce_text(value.get(key))
            if extracted:
                return extracted
        return ""
    return normalize_space(str(value))


def is_user_role(role: str) -> bool:
    role_key = normalize_key(role)
    if not role_key:
        return True
    if role_key in USER_ROLE_ALIASES:
        return True
    return role_key.startswith("user")


def coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        # Handle ms timestamps as well.
        ts = float(value)
        if ts > 10_000_000_000:
            ts = ts / 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # ISO
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            pass
        # YYYY-MM-DD
        m = DATE_RE.search(s)
        if m:
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except Exception:
                return None
        # Year only
        ym = YEAR_RE.search(s)
        if ym:
            try:
                return datetime(int(ym.group(1)), 1, 1, tzinfo=timezone.utc)
            except Exception:
                return None
    return None


def to_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat()


def overlap_ratio(query_tokens: Sequence[str], text_tokens: Sequence[str]) -> float:
    if not query_tokens or not text_tokens:
        return 0.0
    qset = set(query_tokens)
    tset = set(text_tokens)
    inter = len(qset & tset)
    return inter / max(1, len(qset))


def _is_structured_source(source: str) -> bool:
    return source == "graph" or source.startswith("fact")


def _pick_rrf_primary_source(best_rank_by_source: Dict[str, int]) -> str:
    if not best_rank_by_source:
        return "unknown"
    structured = {src: rank for src, rank in best_rank_by_source.items() if _is_structured_source(src)}
    if structured:
        return min(structured.items(), key=lambda kv: kv[1])[0]
    # If semantic ranks close to BM25 for the same doc, keep semantic provenance.
    if "semantic" in best_rank_by_source:
        sem_rank = best_rank_by_source["semantic"]
        bm_rank = best_rank_by_source.get("bm25")
        if bm_rank is None or sem_rank <= bm_rank + 2:
            return "semantic"
    return min(best_rank_by_source.items(), key=lambda kv: kv[1])[0]


def reciprocal_rank_fusion(rank_lists: Sequence[Sequence["RetrievalHit"]], k: int = 60) -> List["RetrievalHit"]:
    fused_scores: Dict[str, float] = defaultdict(float)
    first_seen: Dict[str, RetrievalHit] = {}
    best_rank_by_id_source: Dict[str, Dict[str, int]] = defaultdict(dict)
    best_hit_by_id_source: Dict[str, Dict[str, RetrievalHit]] = defaultdict(dict)
    for ranked in rank_lists:
        for rank, hit in enumerate(ranked):
            fused_scores[hit.id] += 1.0 / (k + rank + 1)
            if hit.id not in first_seen:
                first_seen[hit.id] = hit
            src = hit.source or "unknown"
            prev_rank = best_rank_by_id_source[hit.id].get(src)
            if prev_rank is None or rank < prev_rank:
                best_rank_by_id_source[hit.id][src] = rank
                best_hit_by_id_source[hit.id][src] = hit
    fused: List[RetrievalHit] = []
    for hit_id, score in fused_scores.items():
        source_ranks = best_rank_by_id_source.get(hit_id, {})
        primary_source = _pick_rrf_primary_source(source_ranks)
        base = best_hit_by_id_source.get(hit_id, {}).get(primary_source, first_seen[hit_id])
        merged_metadata = dict(base.metadata)
        merged_metadata["rrf_sources"] = sorted(source_ranks.keys())
        merged_metadata["rrf_best_rank_by_source"] = {
            src: rank + 1 for src, rank in sorted(source_ranks.items(), key=lambda kv: kv[0])
        }
        fused.append(
            RetrievalHit(
                id=base.id,
                source=primary_source,
                score=score,
                text=base.text,
                metadata=merged_metadata,
            )
        )
    fused.sort(key=lambda h: h.score, reverse=True)
    return fused


@dataclass
class MessageDocument:
    id: str
    session_id: str
    turn_index: int
    role: str
    content: str
    timestamp: Optional[datetime] = None


@dataclass
class ExtractedFact:
    id: str
    session_id: str
    message_id: str
    fact_type: str
    entity: str
    relation: str
    value: str
    source_text: str
    confidence: float
    valid_from: Optional[datetime]
    valid_until: Optional[datetime] = None
    active: bool = True
    superseded_by: Optional[str] = None

    def to_json(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "messageId": self.message_id,
            "type": self.fact_type,
            "entity": self.entity,
            "relation": self.relation,
            "value": self.value,
            "sourceText": self.source_text,
            "confidence": self.confidence,
            "validFrom": to_iso(self.valid_from),
            "validUntil": to_iso(self.valid_until),
            "active": self.active,
            "supersededBy": self.superseded_by,
        }


@dataclass
class GraphEdge:
    source: str
    relation: str
    target: str
    fact_id: str


@dataclass
class RetrievalHit:
    id: str
    source: str
    score: float
    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphQueryMatch:
    answer: str
    score: float
    path: List[GraphEdge]


@dataclass
class QueryResult:
    question: str
    question_type: str
    hits: List[RetrievalHit]
    structured_hits: List[RetrievalHit]
    structured_used: bool


@dataclass
class EvalExample:
    question_id: str
    question_type: str
    question: str
    answer: str
    question_date: Optional[datetime]
    haystack_sessions: List[Any]
    haystack_session_ids: List[str]
    haystack_dates: List[Optional[datetime]]


class LexicalSemanticIndex:
    """In-memory BM25 + TF-IDF cosine semantic search."""

    def __init__(self, bm25_k1: float = 1.5, bm25_b: float = 0.75) -> None:
        self.bm25_k1 = bm25_k1
        self.bm25_b = bm25_b
        self.documents: Dict[str, MessageDocument] = {}
        self.doc_tf: Dict[str, Counter[str]] = {}
        self.doc_len: Dict[str, int] = {}
        self.term_df: Counter[str] = Counter()
        self.postings: Dict[str, set[str]] = defaultdict(set)
        self._idf_cache: Dict[str, float] = {}
        self._doc_norm_cache: Dict[str, float] = {}
        self._cache_ready = False

    def _remove_document(self, doc_id: str) -> None:
        old_tf = self.doc_tf.pop(doc_id, None)
        self.documents.pop(doc_id, None)
        self.doc_len.pop(doc_id, None)
        self._doc_norm_cache.pop(doc_id, None)
        if not old_tf:
            return
        for term in old_tf:
            posting = self.postings.get(term)
            if posting:
                posting.discard(doc_id)
                if not posting:
                    self.postings.pop(term, None)
            df = self.term_df.get(term, 0)
            if df <= 1:
                self.term_df.pop(term, None)
                self._idf_cache.pop(term, None)
            else:
                self.term_df[term] = df - 1

    def add_document(self, doc: MessageDocument) -> None:
        if doc.id in self.documents:
            # Keep DF/postings consistent when a doc id is re-used.
            self._remove_document(doc.id)
        tokens = tokenize(doc.content)
        tf = Counter(tokens)
        self.documents[doc.id] = doc
        self.doc_tf[doc.id] = tf
        self.doc_len[doc.id] = len(tokens)
        for term in tf:
            self.term_df[term] += 1
            self.postings[term].add(doc.id)
        self._cache_ready = False

    def _ensure_semantic_cache(self) -> None:
        if self._cache_ready:
            return
        n_docs = max(1, len(self.documents))
        self._idf_cache = {
            term: math.log((n_docs + 1.0) / (df + 1.0)) + 1.0
            for term, df in self.term_df.items()
        }
        self._doc_norm_cache = {}
        for doc_id, tf in self.doc_tf.items():
            norm_sq = 0.0
            for term, cnt in tf.items():
                idf = self._idf_cache.get(term, 0.0)
                w = (1.0 + math.log(cnt)) * idf
                norm_sq += w * w
            self._doc_norm_cache[doc_id] = math.sqrt(norm_sq) if norm_sq > 0 else 1.0
        self._cache_ready = True

    def bm25_search(self, query: str, limit: int = 20) -> List[RetrievalHit]:
        q_terms = tokenize(query)
        if not q_terms or not self.documents:
            return []
        n_docs = len(self.documents)
        avgdl = sum(self.doc_len.values()) / max(1, n_docs)
        scores: Dict[str, float] = defaultdict(float)
        for term in q_terms:
            df = self.term_df.get(term, 0)
            if df == 0:
                continue
            idf = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
            for doc_id in self.postings.get(term, set()):
                tf = self.doc_tf[doc_id][term]
                dl = self.doc_len.get(doc_id, 0)
                denom = tf + self.bm25_k1 * (1.0 - self.bm25_b + self.bm25_b * (dl / max(1e-9, avgdl)))
                scores[doc_id] += idf * ((tf * (self.bm25_k1 + 1.0)) / max(1e-9, denom))
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        hits: List[RetrievalHit] = []
        for doc_id, score in ranked:
            doc = self.documents[doc_id]
            hits.append(
                RetrievalHit(
                    id=f"doc:{doc_id}",
                    source="bm25",
                    score=score,
                    text=doc.content,
                    metadata={
                        "doc_id": doc_id,
                        "session_id": doc.session_id,
                        "turn_index": doc.turn_index,
                        "role": doc.role,
                        "timestamp": to_iso(doc.timestamp),
                    },
                )
            )
        return hits

    def semantic_search(self, query: str, limit: int = 20) -> List[RetrievalHit]:
        q_terms = tokenize(query)
        if not q_terms or not self.documents:
            return []
        self._ensure_semantic_cache()
        q_tf = Counter(q_terms)
        q_weights: Dict[str, float] = {}
        q_norm_sq = 0.0
        for term, cnt in q_tf.items():
            if term not in self._idf_cache:
                continue
            w = (1.0 + math.log(cnt)) * self._idf_cache[term]
            q_weights[term] = w
            q_norm_sq += w * w
        if q_norm_sq <= 0:
            return []
        q_norm = math.sqrt(q_norm_sq)
        scores: List[Tuple[str, float]] = []
        for doc_id, tf in self.doc_tf.items():
            dot = 0.0
            for term, q_w in q_weights.items():
                if term not in tf:
                    continue
                d_w = (1.0 + math.log(tf[term])) * self._idf_cache[term]
                dot += q_w * d_w
            if dot <= 0:
                continue
            denom = q_norm * self._doc_norm_cache.get(doc_id, 1.0)
            scores.append((doc_id, dot / max(1e-9, denom)))
        scores.sort(key=lambda kv: kv[1], reverse=True)
        hits: List[RetrievalHit] = []
        for doc_id, score in scores[:limit]:
            doc = self.documents[doc_id]
            hits.append(
                RetrievalHit(
                    id=f"doc:{doc_id}",
                    source="semantic",
                    score=score,
                    text=doc.content,
                    metadata={
                        "doc_id": doc_id,
                        "session_id": doc.session_id,
                        "turn_index": doc.turn_index,
                        "role": doc.role,
                        "timestamp": to_iso(doc.timestamp),
                    },
                )
            )
        return hits


class FactExtractor:
    """
    Rule-based extractor reimplemented in Python from TS design patterns.
    Focused on preferences, entities, and decisions used by v35 retrieval.
    """

    _SUBJECT = r"(?P<subject>(?:I|i|my [a-z][a-z _-]{1,40}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))"

    def __init__(self) -> None:
        self.preference_patterns = [
            (re.compile(r"\bI\s+(?:really\s+)?(?:like|love|enjoy)\s+(?P<value>[^.?!;]+)", re.IGNORECASE), "likes", 0.88),
            (re.compile(r"\bI\s+(?:really\s+)?prefer\s+(?P<value>[^.?!;]+)", re.IGNORECASE), "prefers", 0.90),
            (re.compile(r"\bI\s+(?:really\s+)?(?:hate|dislike)\s+(?P<value>[^.?!;]+)", re.IGNORECASE), "hates", 0.88),
            (re.compile(r"\bI(?:'m|\s+am)\s+allergic\s+to\s+(?P<value>[^.?!;]+)", re.IGNORECASE), "allergic_to", 0.95),
            (
                re.compile(
                    r"\bmy\s+favorite\s+(?P<facet>[a-z][a-z0-9 _-]{1,30})\s+is\s+(?P<value>[^.?!;]+)",
                    re.IGNORECASE,
                ),
                "favorite",
                0.93,
            ),
        ]
        self.entity_patterns = [
            (re.compile(self._SUBJECT + r"\s+works?\s+(?:at|for|in)\s+(?P<object>[^.?!;]+)", re.IGNORECASE), "works_at", 0.86),
            (re.compile(self._SUBJECT + r"\s+lives?\s+in\s+(?P<object>[^.?!;]+)", re.IGNORECASE), "lives_in", 0.86),
            (re.compile(self._SUBJECT + r"\s+is\s+(?P<object>\d{1,3})\s+years?\s+old", re.IGNORECASE), "age", 0.92),
            (re.compile(self._SUBJECT + r"\s+bought\s+(?P<object>[^.?!;]+)", re.IGNORECASE), "bought", 0.84),
            (
                re.compile(
                    r"\bmy\s+(?P<relation>partner|spouse|wife|husband|boyfriend|girlfriend|friend|manager)\s+is\s+"
                    r"(?P<object>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
                    re.IGNORECASE,
                ),
                "relationship",
                0.92,
            ),
        ]
        self.decision_patterns = [
            (re.compile(r"\b(?:I|We)\s+decided\s+to\s+(?P<value>[^.?!]+)", re.IGNORECASE), "decided_to", 0.92),
            (
                re.compile(
                    r"\b(?:I|We)\s+chose\s+(?P<choice>[^.?!;]+?)\s+over\s+(?P<alt>[^.?!;]+)",
                    re.IGNORECASE,
                ),
                "chose_over",
                0.94,
            ),
            (re.compile(r"\b(?:I|We)\s+went\s+with\s+(?P<value>[^.?!;]+)", re.IGNORECASE), "decided_to", 0.88),
        ]

    def _resolve_entity(self, raw_subject: str, speaker_entity: str) -> str:
        subj = normalize_space(raw_subject)
        low = subj.lower()
        if low in FIRST_PERSON:
            return speaker_entity
        if low.startswith("my "):
            rel = normalize_relation(low[3:])
            return f"{speaker_entity}.{rel}"
        return self._pretty_entity(subj)

    @staticmethod
    def _pretty_entity(raw: str) -> str:
        raw = normalize_space(raw)
        if not raw:
            return raw
        if raw.lower() == "user":
            return "user"
        # Keep dotted entities lowercase to preserve relation chain semantics.
        if "." in raw:
            return raw.lower()
        # Title-case person/org labels for readability.
        return " ".join(part.capitalize() for part in raw.split(" "))

    @staticmethod
    def _clean_value(value: str) -> str:
        cleaned = normalize_space(value)
        cleaned = re.sub(r"^[\s,:-]+", "", cleaned)
        cleaned = re.sub(r"[\s,;:.-]+$", "", cleaned)
        return cleaned

    def extract_facts(
        self,
        text: str,
        *,
        session_id: str,
        message_id: str,
        speaker_entity: str,
        timestamp: Optional[datetime],
        next_fact_id: callable,
    ) -> List[ExtractedFact]:
        if not text.strip():
            return []
        seen: set[Tuple[str, str, str, str]] = set()
        facts: List[ExtractedFact] = []
        base_valid_from = timestamp

        # Preference extraction.
        for pattern, relation, confidence in self.preference_patterns:
            for match in pattern.finditer(text):
                if relation == "favorite":
                    facet = normalize_key(match.group("facet"))
                    rel = f"favorite_{facet}" if facet else "favorite"
                else:
                    rel = relation
                value = self._clean_value(match.group("value"))
                entity = speaker_entity
                if not value:
                    continue
                key = ("preference", normalize_key(entity), normalize_relation(rel), normalize_key(value))
                if key in seen:
                    continue
                seen.add(key)
                facts.append(
                    ExtractedFact(
                        id=next_fact_id(),
                        session_id=session_id,
                        message_id=message_id,
                        fact_type="preference",
                        entity=entity,
                        relation=normalize_relation(rel),
                        value=value,
                        source_text=match.group(0),
                        confidence=confidence,
                        valid_from=base_valid_from,
                    )
                )

        # Entity extraction.
        for pattern, relation, confidence in self.entity_patterns:
            for match in pattern.finditer(text):
                if relation == "relationship":
                    rel = normalize_relation(match.group("relation"))
                    entity = speaker_entity
                    value = self._clean_value(match.group("object"))
                else:
                    subject = match.group("subject")
                    entity = self._resolve_entity(subject, speaker_entity)
                    rel = normalize_relation(relation)
                    value = self._clean_value(match.group("object"))
                if not entity or not value:
                    continue
                key = ("entity", normalize_key(entity), normalize_relation(rel), normalize_key(value))
                if key in seen:
                    continue
                seen.add(key)
                facts.append(
                    ExtractedFact(
                        id=next_fact_id(),
                        session_id=session_id,
                        message_id=message_id,
                        fact_type="entity",
                        entity=entity,
                        relation=rel,
                        value=value,
                        source_text=match.group(0),
                        confidence=confidence,
                        valid_from=base_valid_from,
                    )
                )

        # Decision extraction.
        for pattern, relation, confidence in self.decision_patterns:
            for match in pattern.finditer(text):
                rel = normalize_relation(relation)
                if rel == "chose_over":
                    choice = self._clean_value(match.group("choice"))
                    alt = self._clean_value(match.group("alt"))
                    value = f"{choice} over {alt}"
                else:
                    value = self._clean_value(match.group("value"))
                if not value:
                    continue
                entity = speaker_entity
                key = ("decision", normalize_key(entity), rel, normalize_key(value))
                if key in seen:
                    continue
                seen.add(key)
                facts.append(
                    ExtractedFact(
                        id=next_fact_id(),
                        session_id=session_id,
                        message_id=message_id,
                        fact_type="decision",
                        entity=entity,
                        relation=rel,
                        value=value,
                        source_text=match.group(0),
                        confidence=confidence,
                        valid_from=base_valid_from,
                    )
                )

        return facts


class FactStore:
    """
    In-memory fact store with conflict resolution and temporal validity.

    Mirrors core TS behavior:
    - facts keyed by (entity, relation),
    - newer value supersedes older value,
    - validFrom/validUntil tracked for temporal queries.
    """

    def __init__(self, backing_path: str = ".clawvault/facts.jsonl") -> None:
        self.backing_path = backing_path
        self._facts: Dict[str, ExtractedFact] = {}
        self._active_by_key: Dict[Tuple[str, str], str] = {}
        self._entity_index: Dict[str, set[str]] = defaultdict(set)
        self._relation_index: Dict[str, set[str]] = defaultdict(set)

    @staticmethod
    def _fact_key(entity: str, relation: str) -> Tuple[str, str]:
        return normalize_key(entity), normalize_relation(relation)

    @staticmethod
    def _is_valid_at(fact: ExtractedFact, at_time: Optional[datetime]) -> bool:
        if at_time is None:
            return fact.active
        if fact.valid_from and at_time < fact.valid_from:
            return False
        if fact.valid_until and at_time > fact.valid_until:
            return False
        return True

    def get_fact(self, fact_id: str) -> Optional[ExtractedFact]:
        return self._facts.get(fact_id)

    def upsert(self, fact: ExtractedFact) -> None:
        key = self._fact_key(fact.entity, fact.relation)
        old_fact_id = self._active_by_key.get(key)
        if old_fact_id:
            old_fact = self._facts.get(old_fact_id)
            if old_fact:
                old_fact.active = False
                old_fact.valid_until = fact.valid_from
                old_fact.superseded_by = fact.id
        self._facts[fact.id] = fact
        self._active_by_key[key] = fact.id
        self._entity_index[normalize_key(fact.entity)].add(fact.id)
        self._relation_index[normalize_relation(fact.relation)].add(fact.id)

    def all_facts(self) -> List[ExtractedFact]:
        return list(self._facts.values())

    def active_facts(self) -> List[ExtractedFact]:
        return [f for f in self._facts.values() if f.active]

    def to_jsonl(self) -> str:
        lines = [json.dumps(f.to_json(), ensure_ascii=True) for f in self._facts.values()]
        return "\n".join(lines)

    def lookup(
        self,
        *,
        query: Optional[str] = None,
        entity: Optional[str] = None,
        relation: Optional[str] = None,
        fact_type: Optional[str] = None,
        at_time: Optional[datetime] = None,
        limit: int = 10,
    ) -> List[Tuple[ExtractedFact, float]]:
        candidate_ids: Optional[set[str]] = None
        if entity:
            ids = set(self._entity_index.get(normalize_key(entity), set()))
            candidate_ids = ids if candidate_ids is None else candidate_ids & ids
        if relation:
            ids = set(self._relation_index.get(normalize_relation(relation), set()))
            candidate_ids = ids if candidate_ids is None else candidate_ids & ids
        if candidate_ids is None:
            candidate_ids = set(self._facts.keys())

        q_tokens = tokenize(query or "")
        scored: List[Tuple[ExtractedFact, float]] = []
        for fact_id in candidate_ids:
            fact = self._facts[fact_id]
            if fact_type and fact.fact_type != fact_type:
                continue
            if not self._is_valid_at(fact, at_time):
                continue
            text_tokens = tokenize(f"{fact.entity} {fact.relation} {fact.value} {fact.source_text}")
            lexical = overlap_ratio(q_tokens, text_tokens)
            score = fact.confidence + 0.8 * lexical
            if entity and normalize_key(fact.entity) == normalize_key(entity):
                score += 0.15
            if relation and normalize_relation(fact.relation) == normalize_relation(relation):
                score += 0.20
            if fact_type:
                score += 0.10
            scored.append((fact, score))
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:limit]


class EntityGraph:
    """Directed graph over entity facts with multi-hop traversal."""

    def __init__(self, fact_store: FactStore) -> None:
        self.fact_store = fact_store
        self._adj: Dict[str, List[GraphEdge]] = defaultdict(list)
        self._aliases: Dict[str, str] = {}

    @staticmethod
    def _canonical_entity(raw: str) -> str:
        value = normalize_space(raw)
        low = value.lower()
        if low in FIRST_PERSON or low in {"user"}:
            return "user"
        if "." in value:
            return value.lower()
        return " ".join(part.capitalize() for part in value.split(" "))

    def _register_entity(self, raw: str) -> str:
        canon = self._canonical_entity(raw)
        low = canon.lower()
        self._aliases[low] = canon
        self._aliases[normalize_key(canon)] = canon
        return canon

    def add_fact(self, fact: ExtractedFact) -> None:
        relation = normalize_relation(fact.relation)
        # Graph-worthy relations: entity assertions and decision links with concise values.
        if fact.fact_type not in {"entity", "decision", "preference"}:
            return
        # Avoid turning very long decisions into graph nodes.
        if relation in {"decided_to", "chose_over"} and len(fact.value) > 120:
            return
        source = self._register_entity(fact.entity)
        target = self._register_entity(fact.value)
        edge = GraphEdge(source=source, relation=relation, target=target, fact_id=fact.id)
        self._adj[source].append(edge)

    def _resolve_alias(self, candidate: str) -> Optional[str]:
        if not candidate:
            return None
        norm = candidate.lower().strip()
        if norm in FIRST_PERSON:
            return "user"
        return self._aliases.get(norm) or self._aliases.get(normalize_key(candidate))

    def follow_relation(
        self,
        entity: str,
        relation: Optional[str] = None,
        *,
        at_time: Optional[datetime] = None,
    ) -> List[GraphEdge]:
        canon = self._resolve_alias(entity) or self._canonical_entity(entity)
        edges = self._adj.get(canon, [])
        out: List[GraphEdge] = []
        target_rel = normalize_relation(relation) if relation else None
        for edge in edges:
            if target_rel and normalize_relation(edge.relation) != target_rel:
                continue
            fact = self.fact_store.get_fact(edge.fact_id)
            if not fact:
                continue
            if not FactStore._is_valid_at(fact, at_time):
                continue
            out.append(edge)
        return out

    def resolve_subject_phrase(self, phrase: str, *, at_time: Optional[datetime]) -> List[str]:
        phrase = normalize_space(phrase)
        if not phrase:
            return []
        direct = self._resolve_alias(phrase)
        if direct:
            return [direct]
        low = phrase.lower()
        if low.startswith("my "):
            rel = normalize_relation(low[3:])
            first_hop = self.follow_relation("user", rel, at_time=at_time)
            if first_hop:
                return [edge.target for edge in first_hop]
            # Fallback for virtual entities like user.partner.
            virtual = f"user.{rel}"
            virtual_direct = self._resolve_alias(virtual)
            return [virtual_direct] if virtual_direct else [virtual]
        if low in FIRST_PERSON:
            return ["user"]

        # Fuzzy fallback: entities containing phrase tokens.
        phrase_tokens = set(tokenize(phrase))
        if not phrase_tokens:
            return []
        candidates: List[Tuple[str, float]] = []
        seen_entities = set(self._aliases.values())
        for entity in seen_entities:
            e_tokens = set(tokenize(entity))
            if not e_tokens:
                continue
            overlap = len(phrase_tokens & e_tokens) / max(1, len(phrase_tokens))
            if overlap > 0:
                candidates.append((entity, overlap))
        candidates.sort(key=lambda x: x[1], reverse=True)
        return [c[0] for c in candidates[:3]]

    def query(
        self,
        question: str,
        *,
        at_time: Optional[datetime] = None,
        max_hops: int = 2,
        limit: int = 5,
    ) -> List[GraphQueryMatch]:
        relation = infer_entity_relation_from_question(question)
        subject = extract_subject_from_question(question)
        if not subject:
            return []
        starts = self.resolve_subject_phrase(subject, at_time=at_time)
        if not starts:
            return []

        matches: List[GraphQueryMatch] = []
        if relation is None:
            # "Who is X?" style fallback: show top known edges for subject.
            for s in starts:
                for edge in self.follow_relation(s, None, at_time=at_time)[:limit]:
                    matches.append(
                        GraphQueryMatch(
                            answer=edge.target,
                            score=0.75,
                            path=[edge],
                        )
                    )
            return matches[:limit]

        relation = normalize_relation(relation)
        visited: set[Tuple[str, int]] = set()
        queue: deque[Tuple[str, List[GraphEdge]]] = deque()
        for s in starts:
            queue.append((s, []))
            visited.add((s, 0))

        while queue and len(matches) < limit:
            node, path = queue.popleft()
            depth = len(path)
            for edge in self.follow_relation(node, None, at_time=at_time):
                new_path = [*path, edge]
                if normalize_relation(edge.relation) == relation:
                    score = 1.0 / max(1, len(new_path))
                    # Slight bonus for direct edges.
                    if len(new_path) == 1:
                        score += 0.30
                    matches.append(GraphQueryMatch(answer=edge.target, score=score, path=new_path))
                    if len(matches) >= limit:
                        break
                if depth + 1 < max_hops:
                    state = (edge.target, depth + 1)
                    if state in visited:
                        continue
                    visited.add(state)
                    queue.append((edge.target, new_path))

        matches.sort(key=lambda m: m.score, reverse=True)
        return matches[:limit]


def infer_entity_relation_from_question(question: str) -> Optional[str]:
    q = normalize_space(question).lower()
    patterns = [
        (r"\bwhere\s+does\s+.+\s+work\b", "works_at"),
        (r"\bwhere\s+does\s+.+\s+live\b", "lives_in"),
        (r"\bwhere\s+is\s+.+\s+from\b", "lives_in"),
        (r"\bhow\s+old\s+is\s+.+\b", "age"),
        (r"\bwhat\s+did\s+.+\s+buy\b", "bought"),
        (r"\bwho\s+is\s+.+\s+(?:partner|spouse|wife|husband|boyfriend|girlfriend)\b", "partner"),
        (r"\bwhat\s+does\s+.+\s+prefer\b", "prefers"),
        (r"\bwhat\s+does\s+.+\s+like\b", "likes"),
        (r"\bwhat\s+does\s+.+\s+hate\b", "hates"),
    ]
    for pattern, relation in patterns:
        if re.search(pattern, q):
            return relation
    if re.search(r"\bwho\s+is\s+.+\b", q):
        return None
    return None


def extract_subject_from_question(question: str) -> Optional[str]:
    q = normalize_space(question)
    candidates = [
        re.search(r"where\s+does\s+(.+?)\s+work\??$", q, flags=re.IGNORECASE),
        re.search(r"where\s+does\s+(.+?)\s+live\??$", q, flags=re.IGNORECASE),
        re.search(r"where\s+is\s+(.+?)\s+from\??$", q, flags=re.IGNORECASE),
        re.search(r"how\s+old\s+is\s+(.+?)\??$", q, flags=re.IGNORECASE),
        re.search(r"what\s+did\s+(.+?)\s+buy\??$", q, flags=re.IGNORECASE),
        re.search(r"what\s+does\s+(.+?)\s+(?:prefer|like|hate)\??$", q, flags=re.IGNORECASE),
        re.search(r"who\s+is\s+(.+?)\??$", q, flags=re.IGNORECASE),
    ]
    for match in candidates:
        if match:
            return normalize_space(match.group(1))
    return None


def infer_preference_relation_from_question(question: str) -> Optional[str]:
    q = question.lower()
    fav = re.search(r"favorite\s+([a-z][a-z0-9_-]{1,30})", q)
    if fav:
        return f"favorite_{normalize_key(fav.group(1))}"
    if "allergic" in q:
        return "allergic_to"
    if "prefer" in q:
        return "prefers"
    if "like" in q:
        return "likes"
    if "hate" in q or "dislike" in q:
        return "hates"
    return None


def infer_question_type(question: str, provided: Optional[str] = None) -> str:
    if provided:
        return provided
    q = question.lower()
    if re.search(r"\b(prefer|favorite|allergic|like|dislike|hate)\b", q):
        return "single-session-preference"
    if re.search(r"\b(when|date|time|before|after|during|how long|ago|earlier|later)\b", q):
        return "temporal-reasoning"
    if re.search(r"\b(who|where|works at|lives in|years old|bought)\b", q):
        return "entity"
    if re.search(r"\b(decide|chose|choose|decision|went with)\b", q):
        return "decision"
    return "unknown"


def extract_temporal_reference(question: str, fallback: Optional[datetime]) -> Optional[datetime]:
    explicit = coerce_datetime(question)
    if explicit:
        return explicit
    m = YEAR_RE.search(question)
    if m:
        try:
            return datetime(int(m.group(1)), 1, 1, tzinfo=timezone.utc)
        except Exception:
            return fallback
    return fallback


class ClawVaultV35:
    """
    LongMemEval benchmark adapter v35.

    Requirements implemented:
    - ingest_session keeps BM25/semantic index and also extracts structured facts
      into an in-memory FactStore + EntityGraph.
    - query performs type-adaptive retrieval with structured-first checks for
      preference/entity/temporal queries, then fuses structured + bm25 + semantic
      lists with RRF.
    """

    def __init__(self, *, top_k: int = 20, rrf_k: int = 60) -> None:
        self.top_k = top_k
        self.rrf_k = rrf_k
        self.index = LexicalSemanticIndex()
        self.extractor = FactExtractor()
        self.fact_store = FactStore()
        self.entity_graph = EntityGraph(self.fact_store)
        self._fact_counter = 0

    def _next_fact_id(self) -> str:
        self._fact_counter += 1
        return f"fact_{self._fact_counter}"

    @staticmethod
    def _speaker_entity(role: str) -> str:
        if is_user_role(role):
            return "user"
        role = (role or "").strip().lower()
        if role:
            return role
        return "user"

    @staticmethod
    def _coerce_message(message: Any, turn_index: int) -> Tuple[str, str, Optional[datetime]]:
        if isinstance(message, str):
            text = normalize_space(message)
            if not text:
                return "user", "", None
            line_style = re.match(r"^(user|assistant|system|tool)\s*:?\s*(.+)$", text, flags=re.IGNORECASE)
            if line_style:
                return line_style.group(1).lower(), normalize_space(line_style.group(2)), None
            return "user", text, None
        if isinstance(message, (list, tuple)):
            if len(message) >= 2 and isinstance(message[0], str):
                role = message[0]
                content = coerce_text(message[1])
                ts = coerce_datetime(message[2]) if len(message) > 2 else None
                return role, content, ts
            return "user", coerce_text(message), None
        if not isinstance(message, dict):
            return "user", normalize_space(str(message)), None

        payload: Dict[str, Any] = dict(message)
        nested = payload.get("message")
        if isinstance(nested, dict):
            merged = dict(nested)
            for key in ("role", "speaker", "author", "sender", "timestamp", "time", "created_at", "createdAt", "date"):
                if key in payload and key not in merged:
                    merged[key] = payload[key]
            payload = merged

        role = str(
            payload.get("role")
            or payload.get("speaker")
            or payload.get("author")
            or payload.get("sender")
            or payload.get("participant")
            or "user"
        )
        content_payload: Any = None
        for key in ("content", "text", "value", "body", "utterance", "message"):
            if key in payload and payload.get(key) is not None:
                content_payload = payload.get(key)
                break
        content = coerce_text(content_payload)
        if not content:
            content = coerce_text(payload)

        ts = coerce_datetime(
            payload.get("timestamp")
            or payload.get("time")
            or payload.get("created_at")
            or payload.get("createdAt")
            or payload.get("date")
            or message.get("timestamp")
            or message.get("time")
            or message.get("created_at")
            or message.get("createdAt")
            or message.get("date")
        )
        return role, content, coerce_datetime(ts)

    def ingest_session(
        self,
        session_id: str,
        messages: Sequence[Any],
        *,
        session_timestamp: Optional[Any] = None,
    ) -> None:
        base_ts = coerce_datetime(session_timestamp)
        for idx, msg in enumerate(messages):
            role, content, msg_ts = self._coerce_message(msg, idx)
            if not content:
                continue
            ts = msg_ts or base_ts
            doc_id = f"{session_id}_{idx + 1}"
            doc = MessageDocument(
                id=doc_id,
                session_id=session_id,
                turn_index=idx + 1,
                role=role,
                content=content,
                timestamp=ts,
            )
            self.index.add_document(doc)

            # Requirement: extract structured facts from USER turns during ingest.
            if not is_user_role(role):
                continue
            speaker = "user"
            facts = self.extractor.extract_facts(
                content,
                session_id=session_id,
                message_id=doc_id,
                speaker_entity=speaker,
                timestamp=ts,
                next_fact_id=self._next_fact_id,
            )
            for fact in facts:
                self.fact_store.upsert(fact)
                self.entity_graph.add_fact(fact)

    @staticmethod
    def _finalize_hypothesis(raw: str) -> str:
        text = normalize_space(raw)
        if not text or text == "?":
            return "I do not have enough information to answer that."
        return raw.strip()

    def _fact_hit(self, fact: ExtractedFact, score: float, source: str = "fact") -> RetrievalHit:
        text = f"{fact.entity} {fact.relation} {fact.value}"
        return RetrievalHit(
            id=f"fact:{fact.id}",
            source=source,
            score=score,
            text=text,
            metadata={
                "fact_id": fact.id,
                "fact_type": fact.fact_type,
                "entity": fact.entity,
                "relation": fact.relation,
                "value": fact.value,
                "answer": fact.value,
                "valid_from": to_iso(fact.valid_from),
                "valid_until": to_iso(fact.valid_until),
                "active": fact.active,
                "session_id": fact.session_id,
                "message_id": fact.message_id,
            },
        )

    def _graph_hit(self, graph_match: GraphQueryMatch) -> RetrievalHit:
        path_repr = " -> ".join(f"{edge.source}.{edge.relation}:{edge.target}" for edge in graph_match.path)
        metadata = {
            "answer": graph_match.answer,
            "path": [
                {
                    "source": edge.source,
                    "relation": edge.relation,
                    "target": edge.target,
                    "fact_id": edge.fact_id,
                }
                for edge in graph_match.path
            ],
        }
        return RetrievalHit(
            id=f"graph:{normalize_key(path_repr)}",
            source="graph",
            score=graph_match.score,
            text=path_repr,
            metadata=metadata,
        )

    def _structured_preference_hits(self, question: str, at_time: Optional[datetime], limit: int) -> List[RetrievalHit]:
        relation = infer_preference_relation_from_question(question)
        candidates: List[Tuple[ExtractedFact, float]] = []
        if relation:
            candidates.extend(
                self.fact_store.lookup(
                    query=question,
                    entity="user",
                    relation=relation,
                    fact_type="preference",
                    at_time=at_time,
                    limit=limit,
                )
            )
        if not candidates:
            candidates.extend(
                self.fact_store.lookup(
                    query=question,
                    entity="user",
                    fact_type="preference",
                    at_time=at_time,
                    limit=limit,
                )
            )
        q_tokens = tokenize(question)
        scored_hits: List[RetrievalHit] = []
        for fact, score in candidates:
            lexical = overlap_ratio(
                q_tokens,
                tokenize(f"{fact.entity} {fact.relation} {fact.value} {fact.source_text}"),
            )
            # Preference questions in LongMemEval are often implicit ("recommend ..."),
            # so skip unrelated preference facts that do not overlap the request.
            if relation is None and lexical < 0.10:
                continue
            scored_hits.append(self._fact_hit(fact, score + 0.35 * lexical, source="fact-preference"))
        scored_hits.sort(key=lambda hit: hit.score, reverse=True)
        return scored_hits[:limit]

    def _structured_entity_hits(self, question: str, at_time: Optional[datetime], limit: int) -> List[RetrievalHit]:
        graph_matches = self.entity_graph.query(question, at_time=at_time, max_hops=2, limit=limit)
        return [self._graph_hit(m) for m in graph_matches]

    def _structured_temporal_hits(self, question: str, at_time: Optional[datetime], limit: int) -> List[RetrievalHit]:
        candidates = self.fact_store.lookup(query=question, at_time=at_time, limit=limit)
        return [self._fact_hit(fact, score, source="fact-temporal") for fact, score in candidates]

    def _structured_decision_hits(self, question: str, at_time: Optional[datetime], limit: int) -> List[RetrievalHit]:
        candidates = self.fact_store.lookup(query=question, fact_type="decision", at_time=at_time, limit=limit)
        return [self._fact_hit(fact, score, source="fact-decision") for fact, score in candidates]

    @staticmethod
    def _query_overlap(question: str, hit: RetrievalHit) -> float:
        answer_text = str(hit.metadata.get("answer", "")) if hit.metadata else ""
        return overlap_ratio(tokenize(question), tokenize(f"{hit.text} {answer_text}"))

    def query(
        self,
        question: str,
        *,
        question_type: Optional[str] = None,
        question_timestamp: Optional[datetime] = None,
        top_k: Optional[int] = None,
    ) -> QueryResult:
        k = top_k or self.top_k
        inferred_qtype = infer_question_type(question, question_type)
        temporal_ref = extract_temporal_reference(question, question_timestamp)

        # Type-adaptive structured retrieval (first checks by requirement).
        structured_hits: List[RetrievalHit] = []
        qlow = inferred_qtype.lower()

        if "preference" in qlow or re.search(r"\b(prefer|favorite|allergic|like|hate|dislike)\b", question, re.IGNORECASE):
            structured_hits.extend(self._structured_preference_hits(question, temporal_ref, k))

        if (
            "entity" in qlow
            or re.search(r"\b(who|where|works at|lives in|years old|bought)\b", question, re.IGNORECASE)
            or qlow in {"single-session-user", "single-session-assistant", "multi-session"}
        ):
            structured_hits.extend(self._structured_entity_hits(question, temporal_ref, k))

        if "temporal" in qlow or re.search(r"\b(when|before|after|during|date|time|ago)\b", question, re.IGNORECASE):
            structured_hits.extend(self._structured_temporal_hits(question, temporal_ref, k))

        if "decision" in qlow or re.search(r"\b(decid(?:e|ed|ing|ion)|chose|choose|went with)\b", question, re.IGNORECASE):
            structured_hits.extend(self._structured_decision_hits(question, temporal_ref, k))

        # Baseline BM25 + semantic retrieval.
        bm25_hits = self.index.bm25_search(question, limit=max(k * 2, k + 5))
        semantic_hits = self.index.semantic_search(question, limit=max(k * 2, k + 5))

        # Merge with RRF. Structured list is provided first to preserve source precedence.
        rank_lists: List[List[RetrievalHit]] = []
        if structured_hits:
            # Keep only strongest instance per id before fusion.
            dedup: Dict[str, RetrievalHit] = {}
            for hit in structured_hits:
                if hit.id not in dedup or hit.score > dedup[hit.id].score:
                    dedup[hit.id] = hit
            structured_ranked = sorted(dedup.values(), key=lambda h: h.score, reverse=True)[: max(k * 2, k + 5)]
            rank_lists.append(structured_ranked)
            # Bias toward structured retrieval while still using RRF with lexical/semantic.
            rank_lists.append(structured_ranked)
        rank_lists.append(bm25_hits)
        rank_lists.append(semantic_hits)

        fused = reciprocal_rank_fusion(rank_lists, k=self.rrf_k)[:k]
        return QueryResult(
            question=question,
            question_type=inferred_qtype,
            hits=fused,
            structured_hits=structured_hits,
            structured_used=bool(structured_hits),
        )

    @staticmethod
    def _best_sentence(question: str, text: str) -> str:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        if not sentences:
            return normalize_space(text)[:280]
        q_tokens = tokenize(question)
        scored: List[Tuple[str, float]] = []
        for sent in sentences:
            scored.append((sent, overlap_ratio(q_tokens, tokenize(sent))))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[0][0]

    @staticmethod
    def _trim_answer_span(raw: str, *, max_tokens: int = 12) -> str:
        text = normalize_space(raw)
        if not text:
            return ""
        text = text.strip(" \"'`*_")
        text = re.sub(r"^[\s,;:.\-]+", "", text)
        text = re.sub(r"[\s,;:.\-]+$", "", text)
        text = ANSWER_CLAUSE_SPLIT_RE.split(text, maxsplit=1)[0].strip()
        text = re.split(r",\s*(?:and|but)\s+", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        text = re.split(r"\s+-\s+", text, maxsplit=1)[0].strip()
        tokens = text.split()
        if len(tokens) > max_tokens:
            text = " ".join(tokens[:max_tokens])
        return text.strip(" \"'`*_")

    @staticmethod
    def _extract_short_answer_from_sentence(question: str, sentence: str) -> str:
        q = normalize_space(question).lower()
        sent = normalize_space(sentence)
        if not sent:
            return ""

        if re.search(r"\bhow\s+long\b", q):
            duration = DURATION_VALUE_RE.search(sent)
            if duration:
                return ClawVaultV35._trim_answer_span(duration.group(0), max_tokens=6)

        if re.search(r"\bhow\s+(many|much)\b", q):
            money = MONEY_OR_PERCENT_RE.search(sent)
            if money:
                return ClawVaultV35._trim_answer_span(money.group(0), max_tokens=5)
            number = NUMBER_VALUE_RE.search(sent)
            if number:
                return ClawVaultV35._trim_answer_span(number.group(0), max_tokens=4)

        if re.search(r"\b(discount|rate|percentage|percent)\b", q):
            money = MONEY_OR_PERCENT_RE.search(sent)
            if money:
                return ClawVaultV35._trim_answer_span(money.group(0), max_tokens=5)

        if re.search(r"\b(when|what\s+time)\b", q):
            at_time = TIME_VALUE_RE.search(sent)
            if at_time:
                return ClawVaultV35._trim_answer_span(at_time.group(0), max_tokens=4)
            exact_date = DATE_RE.search(sent)
            if exact_date:
                return f"{exact_date.group(1)}-{int(exact_date.group(2)):02d}-{int(exact_date.group(3)):02d}"
            year = YEAR_RE.search(sent)
            if year:
                return year.group(0)

        if "what color" in q:
            color = COLOR_VALUE_RE.search(sent)
            if color:
                color_value = color.group(0)
                around = re.search(
                    rf"(?:shade|tone)\s+of\s+({re.escape(color_value)})",
                    sent,
                    flags=re.IGNORECASE,
                )
                if around:
                    return ClawVaultV35._trim_answer_span(around.group(0), max_tokens=4)
                return ClawVaultV35._trim_answer_span(color_value, max_tokens=3)

        if re.search(r"\bwhat\s+is\s+the\s+name\b|\bcalled\b|\bnamed\b", q):
            for pattern in (
                r"\bcalled\s+['\"]?([^\"'.,;!?]+)",
                r"\bnamed\s+['\"]?([^\"'.,;!?]+)",
                r"\btitled\s+['\"]?([^\"'.,;!?]+)",
            ):
                match = re.search(pattern, sent, flags=re.IGNORECASE)
                if match:
                    return ClawVaultV35._trim_answer_span(match.group(1), max_tokens=8)

        if re.search(r"\bwhere\b", q):
            for pattern in (
                r"\b(?:at|in|on|to|from)\s+([A-Z][A-Za-z0-9&'./-]*(?:\s+[A-Z][A-Za-z0-9&'./-]*){0,5})",
                r"\b(?:at|in|on|to|from)\s+([^,.!?;]+)",
            ):
                match = re.search(pattern, sent, flags=re.IGNORECASE)
                if not match:
                    continue
                candidate = ClawVaultV35._trim_answer_span(match.group(1), max_tokens=8)
                if candidate and candidate.lower() not in {"home", "there", "here"}:
                    return candidate

        if re.search(r"\bwho\b", q):
            for pattern in (
                r"\b(?:with|to|from|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})",
                r"\b(?:is|was)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b",
            ):
                match = re.search(pattern, sent)
                if match:
                    return ClawVaultV35._trim_answer_span(match.group(1), max_tokens=6)

        # Generic "what did I <verb>" extraction for short object phrases.
        verb_match = re.search(r"\bwhat\s+did\s+i\s+([a-z']+)\b", q)
        if verb_match:
            base_verb = verb_match.group(1)
            forms = [
                base_verb,
                IRREGULAR_VERB_FORMS.get(base_verb, ""),
                f"{base_verb}ed",
                f"{base_verb}ing",
                f"{base_verb}s",
            ]
            forms = [form for form in dict.fromkeys(forms) if form]
            if forms:
                pattern = r"\b(?:%s)\b\s+([^,.!?;]+)" % "|".join(re.escape(form) for form in forms)
                match = re.search(pattern, sent, flags=re.IGNORECASE)
                if match:
                    return ClawVaultV35._trim_answer_span(match.group(1), max_tokens=10)

        if "previous" in q:
            used_to_be = re.search(r"\bused\s+to\s+be\s+([^,.!?;]+)", sent, flags=re.IGNORECASE)
            if used_to_be:
                return ClawVaultV35._trim_answer_span(used_to_be.group(1), max_tokens=10)

        return ""

    def _best_unstructured_hypothesis(self, question: str, hits: Sequence[RetrievalHit]) -> str:
        lexical_hits = [hit for hit in hits if hit.source in {"bm25", "semantic"}]
        fallback_sentence = ""
        for hit in lexical_hits[:5]:
            sentence = self._best_sentence(question, hit.text)
            if not fallback_sentence:
                fallback_sentence = sentence
            extracted = self._extract_short_answer_from_sentence(question, sentence)
            if extracted:
                return extracted
        if fallback_sentence:
            return fallback_sentence
        if hits:
            return normalize_space(hits[0].text)[:280]
        return ""

    def answer(
        self,
        question: str,
        *,
        question_type: Optional[str] = None,
        question_timestamp: Optional[datetime] = None,
        top_k: Optional[int] = None,
    ) -> Tuple[str, QueryResult]:
        result = self.query(
            question,
            question_type=question_type,
            question_timestamp=question_timestamp,
            top_k=top_k,
        )
        if not result.hits:
            return "I do not have enough information to answer that.", result
        qtype = result.question_type.lower()
        prefers_structured = bool(
            result.structured_hits
            and (
                "preference" in qtype
                or "temporal" in qtype
                or "decision" in qtype
                or qtype in {"single-session-user", "single-session-assistant", "multi-session"}
                or re.search(r"\b(who|where|works at|lives in|years old|bought|prefer|favorite|allergic)\b", question, re.IGNORECASE)
            )
        )
        if prefers_structured:
            top_structured = sorted(result.structured_hits, key=lambda h: h.score, reverse=True)[0]
            # Guardrail: if a preference fact is weakly related to the prompt,
            # trust fused retrieval (v34-style lexical/semantic) instead.
            if top_structured.source == "fact-preference":
                structured_overlap = self._query_overlap(question, top_structured)
                top_fused = result.hits[0]
                fused_overlap = self._query_overlap(question, top_fused)
                if structured_overlap < 0.08 and fused_overlap > structured_overlap:
                    if "answer" in top_fused.metadata and normalize_space(str(top_fused.metadata["answer"])):
                        return self._finalize_hypothesis(str(top_fused.metadata["answer"])), result
                    if top_fused.source in {"bm25", "semantic"}:
                        return self._finalize_hypothesis(self._best_unstructured_hypothesis(question, result.hits)), result
                    return self._finalize_hypothesis(normalize_space(top_fused.text)[:280]), result
            if "answer" in top_structured.metadata and normalize_space(str(top_structured.metadata["answer"])):
                answer = str(top_structured.metadata["answer"])
                return self._finalize_hypothesis(answer), result
            return self._finalize_hypothesis(normalize_space(top_structured.text)[:280]), result
        top = result.hits[0]
        if "answer" in top.metadata and normalize_space(str(top.metadata["answer"])):
            return self._finalize_hypothesis(str(top.metadata["answer"])), result
        if top.source in {"bm25", "semantic"}:
            return self._finalize_hypothesis(self._best_unstructured_hypothesis(question, result.hits)), result
        return self._finalize_hypothesis(normalize_space(top.text)[:280]), result


def normalize_answer(text: str) -> str:
    text = (text or "").lower()
    text = re.sub(r"\b(a|an|the)\b", " ", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return normalize_space(text)


def token_f1(prediction: str, ground_truth: str) -> float:
    p_tokens = tokenize(prediction)
    g_tokens = tokenize(ground_truth)
    if not p_tokens and not g_tokens:
        return 1.0
    if not p_tokens or not g_tokens:
        return 0.0
    common = Counter(p_tokens) & Counter(g_tokens)
    overlap = sum(common.values())
    if overlap == 0:
        return 0.0
    precision = overlap / len(p_tokens)
    recall = overlap / len(g_tokens)
    return (2 * precision * recall) / max(1e-9, precision + recall)


def temporal_off_by_one(prediction: str, ground_truth: str) -> bool:
    p = INT_RE.search(prediction or "")
    g = INT_RE.search(ground_truth or "")
    if not p or not g:
        return False
    return abs(int(p.group(0)) - int(g.group(0))) <= 1


def coerce_gold_answers(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = normalize_space(value)
        return [text] if text else []
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        out: List[str] = []
        for item in value:
            out.extend(coerce_gold_answers(item))
        deduped: List[str] = []
        seen: set[str] = set()
        for candidate in out:
            key = normalize_answer(candidate)
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(candidate)
        return deduped
    if isinstance(value, dict):
        for key in ("answers", "answer", "gold", "ground_truth", "expected", "expected_answer", "text", "value"):
            if key not in value:
                continue
            found = coerce_gold_answers(value.get(key))
            if found:
                return found
        return []
    text = normalize_space(str(value))
    return [text] if text else []


def is_correct(prediction: Dict[str, Any]) -> bool:
    pred = str(prediction.get("hypothesis", ""))
    gold_candidates = coerce_gold_answers(prediction.get("answer", ""))
    if not gold_candidates:
        gold_candidates = [str(prediction.get("answer", ""))]
    qid = str(prediction.get("question_id", ""))
    qtype = str(prediction.get("question_type", "")).lower()

    if "_abs" in qid:
        return bool(ABSTENTION_RE.search(pred))

    pred_norm = normalize_answer(pred)
    best_f1 = 0.0
    for gold in gold_candidates:
        gold_norm = normalize_answer(gold)
        if pred_norm == gold_norm:
            return True
        if gold_norm and gold_norm in pred_norm and len(gold_norm) > 3:
            return True
        if pred_norm and pred_norm in gold_norm and len(pred_norm) > 3:
            return True
        if "temporal" in qtype and temporal_off_by_one(pred, gold):
            return True
        best_f1 = max(best_f1, token_f1(pred, gold))

    if "single-session-preference" in qtype:
        return best_f1 >= 0.35
    if "knowledge-update" in qtype:
        return best_f1 >= 0.50
    return best_f1 >= 0.60


def evaluate_predictions_local(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not predictions:
        return {"overall_accuracy": 0.0, "count": 0, "by_type": {}}
    by_type: Dict[str, List[int]] = defaultdict(list)
    labels: List[int] = []
    for pred in predictions:
        label = 1 if is_correct(pred) else 0
        pred["autoeval_label"] = {"model": "heuristic-v35", "label": bool(label)}
        labels.append(label)
        qtype = str(pred.get("question_type", "unknown"))
        by_type[qtype].append(label)
    overall = sum(labels) / len(labels)
    per_type = {
        qtype: {"accuracy": sum(vals) / len(vals), "count": len(vals)}
        for qtype, vals in sorted(by_type.items(), key=lambda kv: kv[0])
    }
    return {
        "overall_accuracy": overall,
        "count": len(predictions),
        "by_type": per_type,
    }


def evaluate_predictions_with_v34_if_available(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Reuse v34 scoring when available; otherwise fallback to local scorer.
    """
    try:
        mod = importlib.import_module("eval.run_v34_full")
    except Exception:
        return evaluate_predictions_local(predictions)

    candidate_fn_names = (
        "evaluate_predictions",
        "score_predictions",
        "compute_scores",
    )
    for name in candidate_fn_names:
        fn = getattr(mod, name, None)
        if not callable(fn):
            continue
        try:
            sig = inspect.signature(fn)
            required_params = [
                p
                for p in sig.parameters.values()
                if p.default is inspect._empty
                and p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
            ]
            if len(required_params) == 1:
                out = fn(predictions)
            elif len(required_params) == 2:
                out = fn(predictions, predictions)
            else:
                continue
            if isinstance(out, dict):
                return out
        except Exception:
            continue

    return evaluate_predictions_local(predictions)


def read_json_or_jsonl(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    stripped = raw.lstrip()
    if stripped.startswith("[") or stripped.startswith("{"):
        return json.loads(raw)
    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def build_session_lookup(payload: Dict[str, Any]) -> Dict[str, Any]:
    lookup: Dict[str, Any] = {}
    sessions = payload.get("sessions") or payload.get("haystack_sessions") or []
    if isinstance(sessions, dict):
        for sid, sess in sessions.items():
            lookup[str(sid)] = sess
        return lookup
    if isinstance(sessions, list):
        for idx, sess in enumerate(sessions):
            if isinstance(sess, dict):
                sid = (
                    sess.get("session_id")
                    or sess.get("id")
                    or sess.get("sessionId")
                    or sess.get("name")
                    or f"session_{idx + 1}"
                )
                turns = sess.get("messages") or sess.get("turns") or sess.get("session") or sess
                lookup[str(sid)] = turns
            else:
                lookup[f"session_{idx + 1}"] = sess
    return lookup


def coerce_eval_example(entry: Dict[str, Any], session_lookup: Optional[Dict[str, Any]] = None) -> EvalExample:
    qid = str(entry.get("question_id") or entry.get("id") or entry.get("qid") or "unknown")
    qtype = str(entry.get("question_type") or entry.get("type") or "unknown")
    question = coerce_text(entry.get("question") or entry.get("query") or entry.get("prompt"))
    answer_candidates = coerce_gold_answers(
        entry.get("answer")
        or entry.get("gold")
        or entry.get("answers")
        or entry.get("ground_truth")
        or entry.get("expected")
        or entry.get("expected_answer")
    )
    answer = answer_candidates[0] if answer_candidates else ""
    qdate = coerce_datetime(entry.get("question_date") or entry.get("date"))

    haystack_sessions = entry.get("haystack_sessions") or entry.get("sessions") or []
    haystack_ids_raw = entry.get("haystack_session_ids") or []
    haystack_dates_raw = entry.get("haystack_dates") or []

    if isinstance(haystack_ids_raw, list):
        haystack_ids = [str(v) for v in haystack_ids_raw]
    elif haystack_ids_raw:
        haystack_ids = [str(haystack_ids_raw)]
    else:
        haystack_ids = []

    if isinstance(haystack_sessions, dict):
        dict_sessions = {str(k): v for k, v in haystack_sessions.items()}
        if not haystack_ids:
            haystack_ids = list(dict_sessions.keys())
        haystack_sessions = [dict_sessions.get(sid, []) for sid in haystack_ids]

    if not haystack_sessions and session_lookup and haystack_ids:
        haystack_sessions = [session_lookup.get(str(sid), []) for sid in haystack_ids]

    if not haystack_ids:
        haystack_ids = [f"session_{i + 1}" for i in range(len(haystack_sessions))]
    if not haystack_dates_raw:
        haystack_dates_raw = [None] * len(haystack_sessions)

    haystack_dates = [coerce_datetime(v) for v in haystack_dates_raw]
    if len(haystack_dates) < len(haystack_sessions):
        haystack_dates.extend([None] * (len(haystack_sessions) - len(haystack_dates)))

    return EvalExample(
        question_id=qid,
        question_type=qtype,
        question=question,
        answer=answer,
        question_date=qdate,
        haystack_sessions=list(haystack_sessions),
        haystack_session_ids=[str(x) for x in haystack_ids],
        haystack_dates=haystack_dates,
    )


def iter_eval_examples(payload: Any) -> Iterator[EvalExample]:
    if isinstance(payload, list):
        for entry in payload:
            if isinstance(entry, dict):
                yield coerce_eval_example(entry)
        return
    if isinstance(payload, dict):
        session_lookup = build_session_lookup(payload)
        if "questions" in payload and isinstance(payload["questions"], list):
            for question_entry in payload["questions"]:
                if isinstance(question_entry, dict):
                    yield coerce_eval_example(question_entry, session_lookup=session_lookup)
            return
        # Single object that itself looks like one example.
        if "question" in payload:
            yield coerce_eval_example(payload, session_lookup=session_lookup)
            return
    raise ValueError("Unsupported dataset format. Expected list, dict with questions, or jsonl rows.")


def coerce_turns(session_blob: Any) -> List[Any]:
    if isinstance(session_blob, list):
        return session_blob
    if isinstance(session_blob, dict):
        if "messages" in session_blob and isinstance(session_blob["messages"], list):
            return session_blob["messages"]
        if "turns" in session_blob and isinstance(session_blob["turns"], list):
            return session_blob["turns"]
        if "session" in session_blob and isinstance(session_blob["session"], list):
            return session_blob["session"]
    if session_blob is None:
        return []
    return [session_blob]


def run_benchmark(
    examples: Iterable[EvalExample],
    *,
    top_k: int,
    rrf_k: int,
    max_questions: Optional[int] = None,
) -> List[Dict[str, Any]]:
    predictions: List[Dict[str, Any]] = []
    for idx, ex in enumerate(examples):
        if max_questions is not None and idx >= max_questions:
            break
        adapter = ClawVaultV35(top_k=top_k, rrf_k=rrf_k)
        for sess_idx, session_blob in enumerate(ex.haystack_sessions):
            sid = ex.haystack_session_ids[sess_idx] if sess_idx < len(ex.haystack_session_ids) else f"session_{sess_idx + 1}"
            sdate = ex.haystack_dates[sess_idx] if sess_idx < len(ex.haystack_dates) else None
            turns = coerce_turns(session_blob)
            adapter.ingest_session(sid, turns, session_timestamp=sdate)

        hypothesis, result = adapter.answer(
            ex.question,
            question_type=ex.question_type,
            question_timestamp=ex.question_date,
            top_k=top_k,
        )
        safe_hypothesis = ClawVaultV35._finalize_hypothesis(hypothesis)
        facts_ingested = len(adapter.fact_store.all_facts())
        graph_edges = sum(len(edges) for edges in adapter.entity_graph._adj.values())
        predictions.append(
            {
                "question_id": ex.question_id,
                "question_type": ex.question_type,
                "question": ex.question,
                "answer": ex.answer,
                "hypothesis": safe_hypothesis,
                "structured_used": result.structured_used,
                "facts_ingested": facts_ingested,
                "graph_edges": graph_edges,
                "retrieved": [
                    {
                        "id": hit.id,
                        "source": hit.source,
                        "score": hit.score,
                        "text": hit.text,
                        "metadata": hit.metadata,
                    }
                    for hit in result.hits
                ],
                "structured_retrieved": [
                    {
                        "id": hit.id,
                        "source": hit.source,
                        "score": hit.score,
                        "text": hit.text,
                        "metadata": hit.metadata,
                    }
                    for hit in result.structured_hits[:top_k]
                ],
            }
        )
    return predictions


def write_jsonl(path: Path, rows: Sequence[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True))
            f.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ClawVault LongMemEval benchmark adapter v35.")
    parser.add_argument("--in-file", required=True, help="Input LongMemEval file (json/jsonl).")
    parser.add_argument(
        "--out-file",
        default="eval/run_v35_full.predictions.jsonl",
        help="Where to write predictions jsonl.",
    )
    parser.add_argument(
        "--metrics-file",
        default="eval/run_v35_full.metrics.json",
        help="Where to write metrics json.",
    )
    parser.add_argument("--top-k", type=int, default=20, help="Top-k fused retrieval results.")
    parser.add_argument("--rrf-k", type=int, default=60, help="RRF k parameter.")
    parser.add_argument("--max-questions", type=int, default=None, help="Optional cap for quick runs.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    in_path = Path(args.in_file)
    out_path = Path(args.out_file)
    metrics_path = Path(args.metrics_file)

    payload = read_json_or_jsonl(in_path)
    examples = list(iter_eval_examples(payload))
    predictions = run_benchmark(
        examples,
        top_k=args.top_k,
        rrf_k=args.rrf_k,
        max_questions=args.max_questions,
    )
    metrics = evaluate_predictions_with_v34_if_available(predictions)

    write_jsonl(out_path, predictions)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=True), encoding="utf-8")

    print(json.dumps(metrics, indent=2))
    print(f"Saved predictions to {out_path}")
    print(f"Saved metrics to {metrics_path}")


if __name__ == "__main__":
    main()
