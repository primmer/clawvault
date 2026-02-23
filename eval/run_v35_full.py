#!/usr/bin/env python3
"""
LongMemEval v35 full evaluation runner.

v35 extends the v34-style hybrid BM25 + semantic retrieval by adding:
1) Write-time fact extraction over user messages
2) FactStore with conflict resolution and temporal querying
3) EntityGraph with one-hop and multi-hop traversal
4) RRF fusion of fact/graph candidates with hybrid retrieval results

The script is intentionally robust to small schema differences in JSON/JSONL
input files under eval/LongMemEval/data.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def sanitize_edge_punctuation(value: str) -> str:
    value = re.sub(r"^[^a-zA-Z0-9]+", "", value)
    value = re.sub(r"[^a-zA-Z0-9)\]\'\"`]+$", "", value)
    return value.strip()


def normalize_lookup(value: str) -> str:
    return normalize_whitespace(value).lower()


def stable_id(parts: Sequence[str], prefix: str) -> str:
    payload = "|".join(parts)
    digest = sha1(payload.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def datetime_to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def split_into_sentences(text: str) -> list[str]:
    compact = normalize_whitespace(text)
    if not compact:
        return []
    matches = re.findall(r"[^.!?\n]+[.!?]?", compact)
    if not matches:
        return [compact]
    return [m.strip() for m in matches if m.strip()]


TOKEN_RE = re.compile(r"[a-zA-Z0-9]+")


def tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in TOKEN_RE.finditer(text or "")]


def extract_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        for key in ("text", "content", "value", "message"):
            if key in content:
                return extract_text(content[key])
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if "text" in item:
                    parts.append(extract_text(item.get("text")))
                elif "content" in item:
                    parts.append(extract_text(item.get("content")))
                elif "value" in item:
                    parts.append(extract_text(item.get("value")))
        return normalize_whitespace(" ".join(parts))
    return str(content)


def normalize_category_label(value: str | None) -> str:
    if not value:
        return "unknown"
    lowered = re.sub(r"[\s_]+", "-", value.strip().lower())
    lowered = re.sub(r"-+", "-", lowered)
    return lowered


@dataclass(slots=True)
class Message:
    role: str
    content: str
    timestamp: str | None = None


@dataclass(slots=True)
class SessionRecord:
    session_id: str
    messages: list[Message]
    started_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class QuestionRecord:
    question_id: str
    question: str
    answers: list[str]
    category: str
    session_ids: list[str] = field(default_factory=list)
    timestamp: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RetrievalDocument:
    doc_id: str
    text: str
    kind: str
    session_id: str | None = None
    timestamp: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ExtractedFact:
    subject: str
    predicate: str
    object: str
    confidence: float
    source_text: str
    extracted_at: str
    category: str
    session_id: str | None = None
    message_index: int | None = None
    message_timestamp: str | None = None


@dataclass(slots=True)
class StoredFact(ExtractedFact):
    fact_id: str = ""
    valid_from: str = ""
    valid_to: str | None = None
    active: bool = True
    superseded_by: str | None = None
    dedup_key: str = ""


@dataclass(slots=True)
class GraphNode:
    node_id: str
    name: str
    mentions: int
    first_seen: str
    last_seen: str


@dataclass(slots=True)
class GraphEdge:
    edge_id: str
    source: str
    target: str
    relation: str
    weight: int
    first_seen: str
    last_seen: str
    evidence: list[str]


@dataclass(slots=True)
class GraphQueryResult:
    seed_entity_ids: list[str]
    hops: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@dataclass(slots=True)
class PredictionRecord:
    question_id: str
    question: str
    category: str
    predicted_answer: str
    gold_answers: list[str]
    correct: bool
    retrieval_mode: str
    top_context_ids: list[str]
    top_context_kinds: list[str]
    fact_hits: int
    graph_hits: int


@dataclass(frozen=True)
class FactPattern:
    regex: re.Pattern[str]
    default_predicate: str
    confidence: float
    subject_group: int
    object_group: int
    predicate_group: int | None = None


PRONOUN_ENTITY_MAP: dict[str, str] = {
    "i": "user",
    "me": "user",
    "my": "user",
    "mine": "user",
    "we": "user",
    "us": "user",
    "our": "user",
    "ours": "user",
}

STOP_ENTITIES = {"it", "that", "this", "there", "something", "anything"}

SUBJECT_CAPTURE = r"([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)"
OBJECT_CAPTURE = r"([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})"


def compile_patterns() -> list[FactPattern]:
    return [
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(is|are|was|were)\s+(?!based in\b|located in\b){OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="is",
            confidence=0.72,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(?:is|are)\s+(based in|located in)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="lives_in",
            confidence=0.84,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(work at|work for|works at|works for|employed by)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="works_at",
            confidence=0.85,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(likes|loves|enjoys|prefers|hates|dislikes)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="likes",
            confidence=0.75,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(live in|lives in|based in|located in)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="lives_in",
            confidence=0.84,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(created|built|founded|started)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="created",
            confidence=0.80,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(use|uses|used|using)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="uses",
            confidence=0.73,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(has|have|had)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="has",
            confidence=0.67,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(owns|owned)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="owns",
            confidence=0.72,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(studies at|study at|studied at)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="studies_at",
            confidence=0.76,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(born in)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="born_in",
            confidence=0.78,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(married to)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="married_to",
            confidence=0.79,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(favorite|favourite)\s+([a-zA-Z][a-zA-Z0-9\s'._-]{{0,50}}?)\s+(is|are)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="likes",
            confidence=0.82,
            subject_group=1,
            object_group=5,
            predicate_group=None,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(birthday is|born on)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="born_on",
            confidence=0.76,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
        FactPattern(
            regex=re.compile(
                rf"\b{SUBJECT_CAPTURE}\s+(nickname is|called)\s+{OBJECT_CAPTURE}",
                flags=re.IGNORECASE,
            ),
            default_predicate="nickname",
            confidence=0.70,
            subject_group=1,
            object_group=3,
            predicate_group=2,
        ),
    ]


FACT_PATTERNS = compile_patterns()


class FactExtractor:
    def __init__(self) -> None:
        self.patterns = FACT_PATTERNS

    @staticmethod
    def _normalize_entity(raw: str) -> str:
        trimmed = sanitize_edge_punctuation(normalize_whitespace(raw))
        if not trimmed:
            return ""
        lower = trimmed.lower()
        if lower in PRONOUN_ENTITY_MAP:
            return PRONOUN_ENTITY_MAP[lower]
        return re.sub(r"^(?:the|a|an)\s+", "", trimmed, flags=re.IGNORECASE).strip()

    @staticmethod
    def _normalize_predicate(raw: str) -> str:
        value = normalize_whitespace(raw).lower()
        if value in {"is", "are", "was", "were"}:
            return "is"
        if value in {"work at", "work for", "works at", "works for", "employed by"}:
            return "works_at"
        if value in {"likes", "loves", "enjoys", "prefers"}:
            return "likes"
        if value in {"hates", "dislikes"}:
            return "dislikes"
        if value in {"live in", "lives in", "based in", "located in"}:
            return "lives_in"
        if value in {"created", "built", "founded", "started"}:
            return "created"
        if value in {"use", "uses", "used", "using"}:
            return "uses"
        if value in {"born in"}:
            return "born_in"
        if value in {"born on", "birthday is"}:
            return "born_on"
        if value in {"studies at", "study at", "studied at"}:
            return "studies_at"
        if value in {"married to"}:
            return "married_to"
        if value in {"nickname is", "called"}:
            return "nickname"
        return value.replace(" ", "_")

    @staticmethod
    def _is_informative_entity(value: str) -> bool:
        if not value:
            return False
        lower = value.lower()
        if lower in STOP_ENTITIES:
            return False
        return len(value) > 1

    @staticmethod
    def _infer_category(predicate: str, source_text: str) -> str:
        lower_source = source_text.lower()
        if predicate in {"likes", "dislikes"} or "favorite" in lower_source or "favourite" in lower_source:
            return "preference"
        if predicate in {"lives_in", "works_at", "studies_at", "born_in", "born_on", "married_to", "nickname"}:
            return "profile"
        if predicate in {"uses", "created", "owns", "has"}:
            return "knowledge"
        return "factual"

    @staticmethod
    def _fact_key(subject: str, predicate: str, object_: str) -> str:
        return f"{subject.lower()}|{predicate.lower()}|{object_.lower()}"

    def extract(
        self,
        text: str,
        *,
        session_id: str | None = None,
        message_index: int | None = None,
        message_timestamp: str | None = None,
    ) -> list[ExtractedFact]:
        facts: list[ExtractedFact] = []
        seen: set[str] = set()
        extracted_at = message_timestamp or now_iso()

        for sentence in split_into_sentences(text):
            for pattern in self.patterns:
                for match in pattern.regex.finditer(sentence):
                    subject_raw = match.group(pattern.subject_group) if pattern.subject_group <= len(match.groups()) else ""
                    object_raw = match.group(pattern.object_group) if pattern.object_group <= len(match.groups()) else ""
                    if pattern.predicate_group is not None and pattern.predicate_group <= len(match.groups()):
                        predicate_raw = match.group(pattern.predicate_group) or pattern.default_predicate
                    else:
                        predicate_raw = pattern.default_predicate

                    subject = self._normalize_entity(subject_raw)
                    object_ = self._normalize_entity(object_raw)
                    predicate = self._normalize_predicate(predicate_raw)

                    if not self._is_informative_entity(subject) or not self._is_informative_entity(object_) or not predicate:
                        continue

                    key = self._fact_key(subject, predicate, object_)
                    if key in seen:
                        continue
                    seen.add(key)

                    facts.append(
                        ExtractedFact(
                            subject=subject,
                            predicate=predicate,
                            object=object_,
                            confidence=pattern.confidence,
                            source_text=sentence,
                            extracted_at=extracted_at,
                            category=self._infer_category(predicate, sentence),
                            session_id=session_id,
                            message_index=message_index,
                            message_timestamp=message_timestamp,
                        )
                    )

            # Special-case comparative preference pattern:
            # "I prefer tea over coffee" => likes(tea), dislikes(coffee)
            pref_match = re.search(
                r"\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+prefer(?:s)?\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})\s+over\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})",
                sentence,
                flags=re.IGNORECASE,
            )
            if pref_match:
                subject = self._normalize_entity(pref_match.group(1))
                liked = self._normalize_entity(pref_match.group(2))
                disliked = self._normalize_entity(pref_match.group(3))
                for predicate, obj in (("likes", liked), ("dislikes", disliked)):
                    key = self._fact_key(subject, predicate, obj)
                    if key in seen:
                        continue
                    if not self._is_informative_entity(subject) or not self._is_informative_entity(obj):
                        continue
                    seen.add(key)
                    facts.append(
                        ExtractedFact(
                            subject=subject,
                            predicate=predicate,
                            object=obj,
                            confidence=0.81,
                            source_text=sentence,
                            extracted_at=extracted_at,
                            category="preference",
                            session_id=session_id,
                            message_index=message_index,
                            message_timestamp=message_timestamp,
                        )
                    )

        return facts


EXCLUSIVE_RELATIONS = {
    "lives_in",
    "works_at",
    "studies_at",
    "born_in",
    "born_on",
    "married_to",
    "nickname",
}


class FactStore:
    def __init__(self) -> None:
        self._facts: list[StoredFact] = []
        self._facts_by_id: dict[str, StoredFact] = {}
        self._dedup: set[str] = set()
        self._active_subject_predicate: dict[tuple[str, str], set[str]] = defaultdict(set)

    @staticmethod
    def _entity_key(value: str) -> str:
        return normalize_lookup(value)

    @staticmethod
    def _spo_key(subject: str, predicate: str, object_: str) -> str:
        return f"{normalize_lookup(subject)}|{normalize_lookup(predicate)}|{normalize_lookup(object_)}"

    @staticmethod
    def _dedup_key(fact: ExtractedFact) -> str:
        return (
            f"{normalize_lookup(fact.subject)}|{normalize_lookup(fact.predicate)}|{normalize_lookup(fact.object)}|"
            f"{normalize_lookup(fact.source_text)}"
        )

    def _fact_id(self, fact: ExtractedFact) -> str:
        return stable_id(
            [
                fact.subject,
                fact.predicate,
                fact.object,
                fact.source_text,
                fact.extracted_at,
                fact.session_id or "",
                str(fact.message_index or ""),
            ],
            prefix="fact",
        )

    def add_fact(self, fact: ExtractedFact) -> StoredFact | None:
        dedup_key = self._dedup_key(fact)
        if dedup_key in self._dedup:
            return None

        fact_id = self._fact_id(fact)
        stored = StoredFact(
            **asdict(fact),
            fact_id=fact_id,
            valid_from=fact.extracted_at,
            valid_to=None,
            active=True,
            superseded_by=None,
            dedup_key=dedup_key,
        )

        subject_key = self._entity_key(stored.subject)
        predicate_key = normalize_lookup(stored.predicate)
        exclusive_key = (subject_key, predicate_key)
        active_set = self._active_subject_predicate[exclusive_key]

        if stored.predicate in EXCLUSIVE_RELATIONS:
            for old_id in list(active_set):
                old_fact = self._facts_by_id.get(old_id)
                if old_fact is None:
                    active_set.discard(old_id)
                    continue
                if normalize_lookup(old_fact.object) == normalize_lookup(stored.object):
                    continue
                old_fact.active = False
                old_fact.valid_to = stored.valid_from
                old_fact.superseded_by = stored.fact_id
                active_set.discard(old_id)

        self._facts.append(stored)
        self._facts_by_id[stored.fact_id] = stored
        self._dedup.add(dedup_key)
        active_set.add(stored.fact_id)
        return stored

    def add_facts(self, facts: Iterable[ExtractedFact]) -> list[StoredFact]:
        added: list[StoredFact] = []
        for fact in facts:
            stored = self.add_fact(fact)
            if stored is not None:
                added.append(stored)
        return added

    def _iter_visible_facts(
        self,
        *,
        include_inactive: bool = False,
        at: datetime | None = None,
    ) -> Iterator[StoredFact]:
        for fact in self._facts:
            if not include_inactive and not fact.active and at is None:
                continue
            if at is None:
                yield fact
                continue

            start_dt = parse_datetime(fact.valid_from) or parse_datetime(fact.extracted_at)
            if start_dt and start_dt > at:
                continue
            end_dt = parse_datetime(fact.valid_to)
            if end_dt and end_dt <= at:
                continue
            yield fact

    def latest_timestamp(self) -> str | None:
        latest: datetime | None = None
        for fact in self._facts:
            dt = parse_datetime(fact.extracted_at)
            if dt and (latest is None or dt > latest):
                latest = dt
        return datetime_to_iso(latest)

    def get_all_facts(self, limit: int | None = None, include_inactive: bool = False) -> list[StoredFact]:
        facts = sorted(
            self._iter_visible_facts(include_inactive=include_inactive),
            key=lambda f: f.extracted_at,
            reverse=True,
        )
        if limit is None or limit < 0:
            return facts
        return facts[:limit]

    def get_facts_for_entity(
        self,
        entity: str,
        limit: int = 50,
        *,
        include_inactive: bool = False,
        at: datetime | None = None,
    ) -> list[StoredFact]:
        needle = normalize_lookup(entity)
        if not needle:
            return []

        matches = []
        for fact in self._iter_visible_facts(include_inactive=include_inactive, at=at):
            subject = normalize_lookup(fact.subject)
            object_ = normalize_lookup(fact.object)
            if subject == needle or object_ == needle or needle in subject or needle in object_:
                matches.append(fact)
        matches.sort(key=lambda f: f.extracted_at, reverse=True)
        return matches[:limit]

    def get_facts_by_category(
        self,
        category: str,
        limit: int = 50,
        *,
        include_inactive: bool = False,
        at: datetime | None = None,
    ) -> list[StoredFact]:
        category_key = normalize_lookup(category)
        matches = [
            fact
            for fact in self._iter_visible_facts(include_inactive=include_inactive, at=at)
            if normalize_lookup(fact.category) == category_key
        ]
        matches.sort(key=lambda f: f.extracted_at, reverse=True)
        return matches[:limit]

    def query(
        self,
        query: str,
        limit: int = 20,
        *,
        include_inactive: bool = False,
        at: datetime | None = None,
    ) -> list[StoredFact]:
        tokens = [token.strip().lower() for token in query.split() if token.strip()]
        if not tokens:
            return []

        scored: list[tuple[StoredFact, float]] = []
        for fact in self._iter_visible_facts(include_inactive=include_inactive, at=at):
            score = 0.0
            subject = fact.subject.lower()
            predicate = fact.predicate.lower()
            object_ = fact.object.lower()
            source = fact.source_text.lower()
            for token in tokens:
                if token in subject:
                    score += 2.0
                if token in object_:
                    score += 2.0
                if token in predicate:
                    score += 1.5
                if token in source:
                    score += 0.5
            if score > 0:
                scored.append((fact, score))

        scored.sort(key=lambda item: (item[1], item[0].extracted_at), reverse=True)
        return [fact for fact, _ in scored[:limit]]

    def get_facts_at(self, when: datetime | str, *, entity: str | None = None, limit: int = 50) -> list[StoredFact]:
        at = when if isinstance(when, datetime) else parse_datetime(when)
        if at is None:
            return []
        candidates = list(self._iter_visible_facts(include_inactive=True, at=at))
        if entity:
            needle = normalize_lookup(entity)
            candidates = [
                fact
                for fact in candidates
                if needle in normalize_lookup(fact.subject) or needle in normalize_lookup(fact.object)
            ]
        candidates.sort(key=lambda f: f.valid_from or f.extracted_at, reverse=True)
        return candidates[:limit]

    def save_jsonl(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            for fact in self._facts:
                handle.write(json.dumps(asdict(fact), ensure_ascii=True) + "\n")

    @classmethod
    def load_jsonl(cls, path: Path) -> "FactStore":
        store = cls()
        if not path.exists():
            return store
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                try:
                    fact = StoredFact(**payload)
                except TypeError:
                    continue
                store._facts.append(fact)
                store._facts_by_id[fact.fact_id] = fact
                store._dedup.add(fact.dedup_key or store._dedup_key(fact))
                key = (normalize_lookup(fact.subject), normalize_lookup(fact.predicate))
                if fact.active:
                    store._active_subject_predicate[key].add(fact.fact_id)
        return store


class EntityGraph:
    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: dict[str, GraphEdge] = {}
        self.adjacency: dict[str, set[str]] = defaultdict(set)

    @staticmethod
    def _node_id(name: str) -> str:
        return normalize_lookup(name)

    @staticmethod
    def _edge_id(source: str, relation: str, target: str) -> str:
        return f"{source}|{relation}|{target}"

    def _upsert_node(self, name: str, observed_at: str) -> str:
        node_id = self._node_id(name)
        existing = self.nodes.get(node_id)
        if existing is None:
            node = GraphNode(
                node_id=node_id,
                name=name.strip(),
                mentions=1,
                first_seen=observed_at,
                last_seen=observed_at,
            )
            self.nodes[node_id] = node
            self.adjacency.setdefault(node_id, set())
            return node_id

        existing.mentions += 1
        existing.last_seen = observed_at
        if len(name.strip()) > len(existing.name):
            existing.name = name.strip()
        self.nodes[node_id] = existing
        return node_id

    def add_fact(self, fact: StoredFact | ExtractedFact) -> None:
        subject_name = normalize_whitespace(fact.subject)
        object_name = normalize_whitespace(fact.object)
        relation = normalize_lookup(fact.predicate)
        if not subject_name or not object_name or not relation:
            return

        observed_at = fact.extracted_at or now_iso()
        source_id = self._upsert_node(subject_name, observed_at)
        target_id = self._upsert_node(object_name, observed_at)
        edge_id = self._edge_id(source_id, relation, target_id)

        edge = self.edges.get(edge_id)
        if edge is None:
            edge = GraphEdge(
                edge_id=edge_id,
                source=source_id,
                target=target_id,
                relation=relation,
                weight=1,
                first_seen=observed_at,
                last_seen=observed_at,
                evidence=[fact.source_text] if fact.source_text else [],
            )
            self.edges[edge_id] = edge
            self.adjacency[source_id].add(target_id)
            self.adjacency[target_id].add(source_id)
            return

        edge.weight += 1
        edge.last_seen = observed_at
        if fact.source_text:
            edge.evidence = [fact.source_text] + [e for e in edge.evidence if e != fact.source_text]
            edge.evidence = edge.evidence[:8]
        self.edges[edge_id] = edge

    def _matching_entity_ids(self, entity: str) -> list[str]:
        needle = normalize_lookup(entity)
        if not needle:
            return []
        if needle in self.nodes:
            return [needle]
        matches = [
            node_id
            for node_id, node in self.nodes.items()
            if needle in node_id or needle in normalize_lookup(node.name)
        ]
        return matches[:8]

    def _sorted_nodes(self, node_ids: set[str]) -> list[GraphNode]:
        nodes = [self.nodes[node_id] for node_id in node_ids if node_id in self.nodes]
        nodes.sort(key=lambda node: (node.mentions, node.name.lower()), reverse=True)
        return nodes

    def query(self, entity: str, limit: int = 30) -> GraphQueryResult:
        seed_ids = self._matching_entity_ids(entity)
        if not seed_ids:
            return GraphQueryResult(seed_entity_ids=[], hops=1, nodes=[], edges=[])

        candidate_edges = [
            edge for edge in self.edges.values() if edge.source in seed_ids or edge.target in seed_ids
        ]
        candidate_edges.sort(key=lambda edge: (edge.weight, edge.last_seen), reverse=True)
        top_edges = candidate_edges[:limit]

        node_ids = set(seed_ids)
        for edge in top_edges:
            node_ids.add(edge.source)
            node_ids.add(edge.target)

        return GraphQueryResult(
            seed_entity_ids=seed_ids,
            hops=1,
            nodes=self._sorted_nodes(node_ids),
            edges=top_edges,
        )

    def query_multi_hop(self, entity: str, max_hops: int = 2, edge_limit: int = 60) -> GraphQueryResult:
        seed_ids = self._matching_entity_ids(entity)
        if not seed_ids:
            return GraphQueryResult(seed_entity_ids=[], hops=max_hops, nodes=[], edges=[])

        visited = set(seed_ids)
        queue: deque[tuple[str, int]] = deque((node_id, 0) for node_id in seed_ids)
        while queue:
            node_id, depth = queue.popleft()
            if depth >= max_hops:
                continue
            for neighbor in self.adjacency.get(node_id, set()):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                queue.append((neighbor, depth + 1))

        candidate_edges = [
            edge for edge in self.edges.values() if edge.source in visited and edge.target in visited
        ]
        candidate_edges.sort(key=lambda edge: (edge.weight, edge.last_seen), reverse=True)
        edges = candidate_edges[:edge_limit]

        node_ids = set(seed_ids)
        for edge in edges:
            node_ids.add(edge.source)
            node_ids.add(edge.target)

        return GraphQueryResult(
            seed_entity_ids=seed_ids,
            hops=max_hops,
            nodes=self._sorted_nodes(node_ids),
            edges=edges,
        )

    def format_for_context(self, result: GraphQueryResult, max_lines: int = 14) -> str:
        if not result.nodes or not result.edges:
            return "No entity graph matches found."
        name_by_id = {node.node_id: node.name for node in result.nodes}
        lines = [f"Entity graph ({result.hops}-hop):"]
        for edge in result.edges[:max_lines]:
            source = name_by_id.get(edge.source, edge.source)
            target = name_by_id.get(edge.target, edge.target)
            lines.append(f"- {source} --{edge.relation}--> {target} (weight {edge.weight})")
        return "\n".join(lines)

    def save_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        snapshot = {
            "schemaVersion": 1,
            "updatedAt": now_iso(),
            "nodes": [asdict(node) for node in sorted(self.nodes.values(), key=lambda n: n.node_id)],
            "edges": [asdict(edge) for edge in sorted(self.edges.values(), key=lambda e: e.edge_id)],
        }
        path.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2), encoding="utf-8")


class BM25Index:
    def __init__(self, documents: Sequence[RetrievalDocument], k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.doc_ids = [doc.doc_id for doc in documents]
        self.doc_lengths: list[int] = []
        self.term_freqs: list[dict[str, int]] = []
        self.doc_freqs: Counter[str] = Counter()
        self.inverted: dict[str, list[tuple[int, int]]] = defaultdict(list)

        for doc_index, doc in enumerate(documents):
            tokens = tokenize(doc.text)
            tf = Counter(tokens)
            self.term_freqs.append(dict(tf))
            self.doc_lengths.append(len(tokens))
            for term, freq in tf.items():
                self.doc_freqs[term] += 1
                self.inverted[term].append((doc_index, freq))

        self.num_docs = len(documents)
        self.avg_doc_len = (sum(self.doc_lengths) / self.num_docs) if self.num_docs else 0.0
        self.idf: dict[str, float] = {}
        for term, df in self.doc_freqs.items():
            self.idf[term] = math.log(1 + (self.num_docs - df + 0.5) / (df + 0.5)) if self.num_docs else 0.0

    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        if not self.num_docs:
            return []
        query_terms = tokenize(query)
        if not query_terms:
            return []

        scores: dict[int, float] = defaultdict(float)
        for term in query_terms:
            postings = self.inverted.get(term)
            if not postings:
                continue
            idf = self.idf.get(term, 0.0)
            for doc_index, tf in postings:
                doc_len = self.doc_lengths[doc_index]
                denom = tf + self.k1 * (1 - self.b + self.b * (doc_len / (self.avg_doc_len or 1.0)))
                score = idf * (tf * (self.k1 + 1) / (denom or 1.0))
                scores[doc_index] += score

        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [(self.doc_ids[idx], score) for idx, score in ranked[:top_k]]


class SemanticIndex:
    def __init__(
        self,
        documents: Sequence[RetrievalDocument],
        *,
        backend: str = "auto",
        model_name: str = "all-MiniLM-L6-v2",
        batch_size: int = 64,
    ) -> None:
        self.doc_ids = [doc.doc_id for doc in documents]
        self.texts = [doc.text for doc in documents]
        self.backend = "hash"
        self.model_name = model_name
        self.batch_size = batch_size
        self._dense_vectors: list[list[float]] | None = None
        self._sparse_vectors: list[dict[int, float]] | None = None
        self._model: Any = None
        self.dim = 768

        if backend in {"auto", "sentence-transformers"}:
            loaded = self._try_load_sentence_transformers()
            if loaded:
                self.backend = "sentence-transformers"
                return
            if backend == "sentence-transformers":
                raise RuntimeError("Requested sentence-transformers backend, but it could not be loaded.")

        self.backend = "hash"
        self._build_sparse_vectors()

    def _try_load_sentence_transformers(self) -> bool:
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except Exception:
            return False

        try:
            self._model = SentenceTransformer(self.model_name)
            dense = self._model.encode(
                self.texts,
                batch_size=self.batch_size,
                show_progress_bar=False,
                normalize_embeddings=True,
            )
        except Exception:
            self._model = None
            return False

        vectors: list[list[float]] = []
        for row in dense:
            if hasattr(row, "tolist"):
                vectors.append([float(value) for value in row.tolist()])
            else:
                vectors.append([float(value) for value in row])
        self._dense_vectors = vectors
        return True

    def _hash_vector(self, text: str) -> dict[int, float]:
        counts: Counter[int] = Counter()
        for token in tokenize(text):
            digest = sha1(token.encode("utf-8")).hexdigest()
            index = int(digest[:8], 16) % self.dim
            sign = 1 if int(digest[8:10], 16) % 2 == 0 else -1
            counts[index] += sign
        norm = math.sqrt(sum(value * value for value in counts.values())) or 1.0
        return {idx: value / norm for idx, value in counts.items()}

    def _build_sparse_vectors(self) -> None:
        self._sparse_vectors = [self._hash_vector(text) for text in self.texts]

    @staticmethod
    def _dot_dense(a: Sequence[float], b: Sequence[float]) -> float:
        return float(sum(x * y for x, y in zip(a, b)))

    @staticmethod
    def _dot_sparse(a: dict[int, float], b: dict[int, float]) -> float:
        if len(a) > len(b):
            a, b = b, a
        return float(sum(value * b.get(index, 0.0) for index, value in a.items()))

    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        if not self.doc_ids:
            return []

        scores: list[tuple[str, float]] = []
        if self.backend == "sentence-transformers" and self._model is not None and self._dense_vectors is not None:
            query_emb = self._model.encode(query, normalize_embeddings=True, show_progress_bar=False)
            if hasattr(query_emb, "tolist"):
                query_vec = [float(value) for value in query_emb.tolist()]
            else:
                query_vec = [float(value) for value in query_emb]
            for doc_id, doc_vec in zip(self.doc_ids, self._dense_vectors):
                scores.append((doc_id, self._dot_dense(query_vec, doc_vec)))
        else:
            if self._sparse_vectors is None:
                self._build_sparse_vectors()
            query_vec = self._hash_vector(query)
            assert self._sparse_vectors is not None
            for doc_id, doc_vec in zip(self.doc_ids, self._sparse_vectors):
                scores.append((doc_id, self._dot_sparse(query_vec, doc_vec)))

        scores.sort(key=lambda item: item[1], reverse=True)
        return scores[:top_k]


def reciprocal_rank_fusion(rank_lists: Sequence[Sequence[str]], k: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = defaultdict(float)
    for ranking in rank_lists:
        for rank, doc_id in enumerate(ranking):
            scores[doc_id] += 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)


class HybridRetriever:
    def __init__(
        self,
        documents: Sequence[RetrievalDocument],
        *,
        semantic_backend: str = "auto",
        semantic_model: str = "all-MiniLM-L6-v2",
        semantic_batch_size: int = 64,
    ) -> None:
        self.documents = list(documents)
        self.doc_lookup = {doc.doc_id: doc for doc in self.documents}
        self.bm25 = BM25Index(self.documents)
        self.semantic = SemanticIndex(
            self.documents,
            backend=semantic_backend,
            model_name=semantic_model,
            batch_size=semantic_batch_size,
        )

    def search(self, query: str, *, top_k: int = 20, rrf_k: int = 60) -> list[tuple[str, float]]:
        bm25_ranked = self.bm25.search(query, top_k=max(top_k * 4, 20))
        semantic_ranked = self.semantic.search(query, top_k=max(top_k * 4, 20))
        fused = reciprocal_rank_fusion(
            [[doc_id for doc_id, _ in bm25_ranked], [doc_id for doc_id, _ in semantic_ranked]],
            k=rrf_k,
        )
        return fused[: max(top_k * 4, top_k)]


def likely_question_record(record: dict[str, Any]) -> bool:
    return any(key in record for key in ("question", "query", "prompt"))


def likely_session_record(record: dict[str, Any]) -> bool:
    if "messages" in record and isinstance(record["messages"], list):
        return True
    for key in ("conversation", "turns", "dialogue"):
        if key in record and isinstance(record[key], list):
            return True
    return False


def parse_message(raw: Any) -> Message | None:
    if isinstance(raw, str):
        text = normalize_whitespace(raw)
        if not text:
            return None
        m = re.match(r"^(user|assistant|system|tool)\s*:?\s*(.+)$", text, flags=re.IGNORECASE)
        if m:
            return Message(role=m.group(1).lower(), content=m.group(2).strip(), timestamp=None)
        return Message(role="user", content=text, timestamp=None)

    if not isinstance(raw, dict):
        return None

    if "message" in raw and isinstance(raw["message"], dict):
        raw = raw["message"]

    role = str(raw.get("role") or raw.get("speaker") or raw.get("author") or "user").lower().strip()
    content = extract_text(raw.get("content") if "content" in raw else raw.get("text") if "text" in raw else raw)
    timestamp = raw.get("timestamp") or raw.get("time") or raw.get("datetime") or raw.get("created_at")
    timestamp_text = str(timestamp) if timestamp is not None else None
    content = normalize_whitespace(content)
    if not content:
        return None
    return Message(role=role, content=content, timestamp=timestamp_text)


def parse_session(raw: dict[str, Any], *, source_name: str, fallback_index: int) -> SessionRecord | None:
    message_list = None
    for key in ("messages", "conversation", "turns", "dialogue", "chat"):
        value = raw.get(key)
        if isinstance(value, list):
            message_list = value
            break
    if message_list is None:
        return None

    messages = [msg for item in message_list if (msg := parse_message(item)) is not None]
    if not messages:
        return None

    session_id = str(
        raw.get("session_id")
        or raw.get("sessionId")
        or raw.get("id")
        or raw.get("chat_id")
        or f"{source_name}:{fallback_index}"
    )
    started_at = raw.get("timestamp") or raw.get("started_at") or raw.get("date") or raw.get("created_at")
    started_at_text = str(started_at) if started_at is not None else None

    metadata = {
        key: value
        for key, value in raw.items()
        if key not in {"messages", "conversation", "turns", "dialogue", "chat"}
    }
    return SessionRecord(session_id=session_id, messages=messages, started_at=started_at_text, metadata=metadata)


def parse_answers(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        parts = [text]
        if "|" in text:
            parts = [p.strip() for p in text.split("|")]
        elif ";" in text:
            parts = [p.strip() for p in text.split(";")]
        return [p for p in parts if p]
    if isinstance(raw, (int, float)):
        return [str(raw)]
    if isinstance(raw, dict):
        for key in ("answers", "answer", "text", "value"):
            if key in raw:
                return parse_answers(raw[key])
        return []
    if isinstance(raw, list):
        values: list[str] = []
        for item in raw:
            values.extend(parse_answers(item))
        deduped: list[str] = []
        seen: set[str] = set()
        for value in values:
            key = normalize_lookup(value)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(value)
        return deduped
    return []


def parse_question(raw: dict[str, Any], *, source_name: str, fallback_index: int) -> QuestionRecord | None:
    question_text = extract_text(raw.get("question") or raw.get("query") or raw.get("prompt"))
    question_text = normalize_whitespace(question_text)
    if not question_text:
        return None

    answers = []
    for key in ("answers", "answer", "gold", "ground_truth", "expected", "expected_answer"):
        if key in raw:
            answers = parse_answers(raw.get(key))
            if answers:
                break

    category = normalize_category_label(
        str(raw.get("category") or raw.get("type") or raw.get("question_type") or raw.get("qa_type") or "unknown")
    )

    session_ids_raw = raw.get("session_ids") or raw.get("sessions_ids") or raw.get("session_id")
    session_ids: list[str] = []
    if isinstance(session_ids_raw, list):
        session_ids = [str(item) for item in session_ids_raw if item is not None]
    elif session_ids_raw is not None:
        session_ids = [str(session_ids_raw)]

    question_id = str(raw.get("question_id") or raw.get("qid") or raw.get("id") or f"{source_name}:{fallback_index}")
    timestamp = raw.get("timestamp") or raw.get("time") or raw.get("date")
    timestamp_text = str(timestamp) if timestamp is not None else None

    metadata = {
        key: value
        for key, value in raw.items()
        if key not in {"question", "query", "prompt", "answers", "answer", "gold", "ground_truth"}
    }

    return QuestionRecord(
        question_id=question_id,
        question=question_text,
        answers=answers,
        category=category,
        session_ids=session_ids,
        timestamp=timestamp_text,
        metadata=metadata,
    )


def extract_embedded_sessions(raw: dict[str, Any], *, source_name: str, seed_index: int) -> list[SessionRecord]:
    candidates: list[Any] = []
    for key in ("sessions", "history", "chat_history", "conversation_history"):
        value = raw.get(key)
        if isinstance(value, list):
            candidates.extend(value)
        elif isinstance(value, dict):
            candidates.append(value)

    embedded: list[SessionRecord] = []
    for idx, candidate in enumerate(candidates, start=seed_index):
        if isinstance(candidate, dict):
            session = parse_session(candidate, source_name=source_name, fallback_index=idx)
            if session:
                embedded.append(session)
    return embedded


def read_json_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if path.suffix.lower() == ".jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    records.append(payload)
    elif path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            records.extend([entry for entry in payload if isinstance(entry, dict)])
        elif isinstance(payload, dict):
            if "data" in payload and isinstance(payload["data"], list):
                records.extend([entry for entry in payload["data"] if isinstance(entry, dict)])
            else:
                for key in ("questions", "sessions", "items"):
                    if key in payload and isinstance(payload[key], list):
                        records.extend([entry for entry in payload[key] if isinstance(entry, dict)])
                if not records:
                    records.append(payload)
    return records


def load_dataset(
    data_dir: Path,
    *,
    sessions_file: str | None = None,
    questions_file: str | None = None,
) -> tuple[dict[str, SessionRecord], list[QuestionRecord]]:
    if not data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    files: list[Path] = []
    if sessions_file:
        files.append(data_dir / sessions_file)
    if questions_file:
        files.append(data_dir / questions_file)
    if not files:
        files = sorted([*data_dir.glob("*.jsonl"), *data_dir.glob("*.json")], key=lambda p: p.name)

    sessions: dict[str, SessionRecord] = {}
    questions: list[QuestionRecord] = []
    record_index = 0

    for file_path in files:
        if not file_path.exists():
            continue
        records = read_json_records(file_path)
        source_name = file_path.stem
        for record in records:
            record_index += 1

            if likely_question_record(record):
                question = parse_question(record, source_name=source_name, fallback_index=record_index)
                if question is not None:
                    questions.append(question)
                for embedded in extract_embedded_sessions(record, source_name=source_name, seed_index=record_index * 10):
                    current = sessions.get(embedded.session_id)
                    if current is None or len(embedded.messages) > len(current.messages):
                        sessions[embedded.session_id] = embedded

            if likely_session_record(record):
                session = parse_session(record, source_name=source_name, fallback_index=record_index)
                if session is not None:
                    current = sessions.get(session.session_id)
                    if current is None or len(session.messages) > len(current.messages):
                        sessions[session.session_id] = session

    if not questions:
        raise RuntimeError(
            f"No question records found in {data_dir}. "
            "Expected JSON/JSONL records with a question/query/prompt field."
        )
    if not sessions:
        raise RuntimeError(
            f"No session records found in {data_dir}. "
            "Expected JSON/JSONL records with messages/conversation/turns."
        )

    questions.sort(key=lambda q: q.question_id)
    return sessions, questions


def build_retrieval_documents(sessions: dict[str, SessionRecord]) -> tuple[list[RetrievalDocument], list[RetrievalDocument]]:
    session_docs: list[RetrievalDocument] = []
    sentence_docs: list[RetrievalDocument] = []
    for session_id in sorted(sessions.keys()):
        session = sessions[session_id]
        lines = [f"{msg.role}: {msg.content}" for msg in session.messages]
        session_text = normalize_whitespace("\n".join(lines))
        session_docs.append(
            RetrievalDocument(
                doc_id=f"session:{session_id}",
                text=session_text,
                kind="session",
                session_id=session_id,
                timestamp=session.started_at,
                metadata={"message_count": len(session.messages)},
            )
        )

        for msg_idx, message in enumerate(session.messages):
            for sent_idx, sentence in enumerate(split_into_sentences(message.content)):
                sentence_docs.append(
                    RetrievalDocument(
                        doc_id=f"sentence:{session_id}:{msg_idx}:{sent_idx}",
                        text=f"{message.role}: {sentence}",
                        kind="sentence",
                        session_id=session_id,
                        timestamp=message.timestamp or session.started_at,
                        metadata={"message_index": msg_idx, "sentence_index": sent_idx},
                    )
                )

    return session_docs, sentence_docs


PREFERENCE_PATTERNS = [
    re.compile(r"(?:do|does|did)\s+(?:i|you|we|they)\s+(?:like|prefer|enjoy|want|hate|dislike)", flags=re.IGNORECASE),
    re.compile(r"(?:what|which)\s+(?:do|does|did)\s+(?:i|you|we)\s+(?:like|prefer|enjoy)", flags=re.IGNORECASE),
    re.compile(r"(?:my|your|our)\s+(?:favorite|preferred|favourite)", flags=re.IGNORECASE),
]

TEMPORAL_PATTERNS = [
    re.compile(r"(?:when|what\s+time|what\s+date|which\s+day)", flags=re.IGNORECASE),
    re.compile(r"(?:yesterday|today|tomorrow|last\s+week|next\s+week|earlier|later|before|after)", flags=re.IGNORECASE),
    re.compile(
        r"(?:january|february|march|april|may|june|july|august|september|october|november|december)",
        flags=re.IGNORECASE,
    ),
    re.compile(r"\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}", flags=re.IGNORECASE),
    re.compile(r"\d{4}-\d{2}-\d{2}", flags=re.IGNORECASE),
]

ENTITY_PATTERNS = [
    re.compile(r"(?:who|what)\s+(?:is|are)\s+([a-z0-9][a-z0-9\s._-]{1,80})", flags=re.IGNORECASE),
    re.compile(r"(?:related to|connected to|about|relationship between)\s+([a-z0-9][a-z0-9\s._-]{1,80})", flags=re.IGNORECASE),
]

MULTI_HOP_PATTERNS = [
    re.compile(r"\b(multi[\s-]?hop|2[\s-]?hop|3[\s-]?hop|relationship|connected|path|between)\b", flags=re.IGNORECASE),
]


@dataclass(slots=True)
class QuestionAnalysis:
    is_preference: bool
    is_temporal: bool
    is_entity: bool
    is_multi_hop: bool
    entity_target: str | None
    hop_count: int
    retrieval_mode: str
    temporal_anchor: datetime | None


def extract_entity_target(question: str) -> str | None:
    quoted = re.search(r'"([^"]+)"', question)
    if quoted and quoted.group(1).strip():
        return quoted.group(1).strip()
    for pattern in ENTITY_PATTERNS:
        match = pattern.search(question)
        if match and match.group(1):
            return re.sub(r"[?.!,]+$", "", match.group(1)).strip()
    words = [word for word in re.sub(r"[?.!,]+", " ", question).split() if word]
    if not words:
        return None
    return " ".join(words[-3:])


def extract_hop_count(question: str, default: int = 2) -> int:
    match = re.search(r"(\d+)\s*-?\s*hop", question, flags=re.IGNORECASE)
    if not match:
        return default
    try:
        hops = int(match.group(1))
    except ValueError:
        return default
    return min(max(hops, 1), 4)


MONTH_REGEX = re.compile(
    r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?",
    flags=re.IGNORECASE,
)


def extract_temporal_anchor(question: str, reference: datetime | None = None) -> datetime | None:
    reference = reference or datetime.now(timezone.utc)
    m_iso = re.search(r"(\d{4}-\d{2}-\d{2})", question)
    if m_iso:
        parsed = parse_datetime(m_iso.group(1))
        if parsed:
            return parsed

    m_slash = re.search(r"(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})", question)
    if m_slash:
        parsed = parse_datetime(m_slash.group(1))
        if parsed:
            return parsed

    month_match = MONTH_REGEX.search(question)
    if month_match:
        month_str = month_match.group(1)
        day = int(month_match.group(2))
        year = int(month_match.group(3)) if month_match.group(3) else reference.year
        try:
            return datetime.strptime(f"{month_str} {day} {year}", "%B %d %Y").replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    lower = question.lower()
    if "today" in lower:
        return reference
    if "yesterday" in lower:
        return reference - timedelta(days=1)
    if "tomorrow" in lower:
        return reference + timedelta(days=1)
    if "last week" in lower:
        return reference - timedelta(days=7)
    if "next week" in lower:
        return reference + timedelta(days=7)
    return None


def analyze_question(question: QuestionRecord, fact_store: FactStore) -> QuestionAnalysis:
    text = question.question
    category = normalize_category_label(question.category)
    lower = text.lower()

    is_preference = "preference" in category or any(pattern.search(lower) for pattern in PREFERENCE_PATTERNS)
    is_temporal = "temporal" in category or any(pattern.search(lower) for pattern in TEMPORAL_PATTERNS)
    is_entity = any(pattern.search(text) for pattern in ENTITY_PATTERNS) or "entity" in category
    is_multi_hop = "multi-session" in category or any(pattern.search(lower) for pattern in MULTI_HOP_PATTERNS)
    entity_target = extract_entity_target(text) if (is_entity or is_multi_hop) else None
    hop_count = extract_hop_count(text, default=2 if is_multi_hop else 1)

    retrieval_mode = "session"
    if "multi-session" in category or is_temporal:
        retrieval_mode = "sentence"

    ref_dt = parse_datetime(fact_store.latest_timestamp()) if fact_store.latest_timestamp() else None
    temporal_anchor = extract_temporal_anchor(text, reference=ref_dt)
    return QuestionAnalysis(
        is_preference=is_preference,
        is_temporal=is_temporal,
        is_entity=is_entity,
        is_multi_hop=is_multi_hop,
        entity_target=entity_target,
        hop_count=hop_count,
        retrieval_mode=retrieval_mode,
        temporal_anchor=temporal_anchor,
    )


def score_fact_relevance(fact: StoredFact, query: str) -> float:
    q_tokens = set(tokenize(query))
    if not q_tokens:
        return 0.0
    text = f"{fact.subject} {fact.predicate} {fact.object} {fact.source_text}".lower()
    score = 0.0
    for token in q_tokens:
        if token in fact.subject.lower():
            score += 2.0
        if token in fact.object.lower():
            score += 2.0
        if token in fact.predicate.lower():
            score += 1.5
        if token in text:
            score += 0.25
    return score


def build_fact_doc(fact: StoredFact) -> RetrievalDocument:
    text = f"{fact.subject} {fact.predicate.replace('_', ' ')} {fact.object}. Source: {fact.source_text}"
    return RetrievalDocument(
        doc_id=f"fact:{fact.fact_id}",
        text=text,
        kind="fact",
        session_id=fact.session_id,
        timestamp=fact.extracted_at,
        metadata={
            "fact_id": fact.fact_id,
            "subject": fact.subject,
            "predicate": fact.predicate,
            "object": fact.object,
            "category": fact.category,
            "valid_from": fact.valid_from,
            "valid_to": fact.valid_to,
            "active": fact.active,
        },
    )


def build_graph_docs(graph: EntityGraph, entity_target: str, result: GraphQueryResult, edge_limit: int) -> list[RetrievalDocument]:
    docs: list[RetrievalDocument] = []
    summary_doc = RetrievalDocument(
        doc_id=f"graph:summary:{stable_id([entity_target, str(result.hops)], 'graph')}",
        text=graph.format_for_context(result),
        kind="graph-summary",
        metadata={"entity": entity_target, "hops": result.hops, "nodes": len(result.nodes), "edges": len(result.edges)},
    )
    docs.append(summary_doc)

    node_name = {node.node_id: node.name for node in result.nodes}
    for edge in result.edges[:edge_limit]:
        source = node_name.get(edge.source, edge.source)
        target = node_name.get(edge.target, edge.target)
        evidence = edge.evidence[0] if edge.evidence else ""
        text = f"{source} --{edge.relation}--> {target}. Evidence: {evidence}"
        docs.append(
            RetrievalDocument(
                doc_id=f"graph-edge:{stable_id([edge.edge_id], 'gedge')}",
                text=text,
                kind="graph-edge",
                metadata={
                    "edge_id": edge.edge_id,
                    "source": source,
                    "target": target,
                    "relation": edge.relation,
                    "weight": edge.weight,
                    "last_seen": edge.last_seen,
                },
            )
        )
    return docs


def rank_dynamic_candidates(
    question: QuestionRecord,
    analysis: QuestionAnalysis,
    fact_store: FactStore,
    entity_graph: EntityGraph,
    top_k: int,
) -> tuple[dict[str, RetrievalDocument], list[str], list[str]]:
    dynamic_docs: dict[str, RetrievalDocument] = {}
    fact_rank: list[str] = []
    graph_rank: list[str] = []

    # FACT STORE FIRST
    candidate_facts: list[StoredFact]
    if analysis.is_preference:
        candidate_facts = fact_store.get_facts_by_category("preference", limit=max(top_k * 6, 20))
        if not candidate_facts:
            candidate_facts = fact_store.query(question.question, limit=max(top_k * 6, 20))
    elif analysis.is_temporal:
        anchor = analysis.temporal_anchor
        if anchor is None:
            latest = parse_datetime(fact_store.latest_timestamp()) if fact_store.latest_timestamp() else None
            anchor = latest or datetime.now(timezone.utc)
        candidate_facts = fact_store.get_facts_at(anchor, limit=max(top_k * 8, 30))
        candidate_facts.sort(key=lambda fact: score_fact_relevance(fact, question.question), reverse=True)
    else:
        candidate_facts = fact_store.query(question.question, limit=max(top_k * 6, 20))

    for fact in candidate_facts[: max(top_k * 4, 12)]:
        doc = build_fact_doc(fact)
        dynamic_docs[doc.doc_id] = doc
        fact_rank.append(doc.doc_id)

    # ENTITY GRAPH
    if analysis.entity_target:
        if analysis.is_multi_hop:
            graph_result = entity_graph.query_multi_hop(
                analysis.entity_target,
                max_hops=max(2, analysis.hop_count),
                edge_limit=max(top_k * 6, 30),
            )
        else:
            graph_result = entity_graph.query(analysis.entity_target, limit=max(top_k * 6, 20))

        if graph_result.edges:
            graph_docs = build_graph_docs(entity_graph, analysis.entity_target, graph_result, edge_limit=max(top_k * 3, 12))
            for doc in graph_docs:
                dynamic_docs[doc.doc_id] = doc
                graph_rank.append(doc.doc_id)

    return dynamic_docs, fact_rank, graph_rank


def infer_wh_word(question: str) -> str:
    lower = question.lower().strip()
    for wh in ("who", "where", "when", "what", "which", "how"):
        if lower.startswith(wh + " ") or f" {wh} " in lower:
            return wh
    return ""


def infer_answer(question: str, contexts: Sequence[RetrievalDocument], analysis: QuestionAnalysis) -> str:
    if not contexts:
        return ""

    wh = infer_wh_word(question)
    for doc in contexts:
        if doc.kind == "fact":
            predicate = str(doc.metadata.get("predicate", ""))
            subject = str(doc.metadata.get("subject", ""))
            object_ = str(doc.metadata.get("object", ""))
            if wh == "where" and predicate in {"lives_in", "works_at", "born_in", "studies_at"}:
                return object_
            if wh == "who":
                target = analysis.entity_target
                if target:
                    t_key = normalize_lookup(target)
                    if normalize_lookup(subject) == t_key:
                        return object_
                    if normalize_lookup(object_) == t_key:
                        return subject
                return object_ if subject == "user" else subject
            if wh == "when":
                valid_from = str(doc.metadata.get("valid_from") or "")
                if valid_from:
                    return valid_from[:10]
            return object_ or subject

        if doc.kind == "graph-edge":
            source = str(doc.metadata.get("source", ""))
            relation = str(doc.metadata.get("relation", ""))
            target = str(doc.metadata.get("target", ""))
            if wh == "who":
                return source or target
            if wh == "where" and relation in {"lives_in", "born_in", "located_in", "works_at"}:
                return target
            return f"{source} {relation} {target}".strip()

    # Fallback extractive answer from top context
    top = contexts[0]
    sentence = split_into_sentences(top.text)
    if sentence:
        return sentence[0][:200]
    return top.text[:200]


def normalize_for_eval(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def token_f1(pred: str, gold: str) -> float:
    pred_tokens = tokenize(pred)
    gold_tokens = tokenize(gold)
    if not pred_tokens or not gold_tokens:
        return 0.0
    pred_counter = Counter(pred_tokens)
    gold_counter = Counter(gold_tokens)
    overlap = sum(min(pred_counter[token], gold_counter[token]) for token in pred_counter.keys() & gold_counter.keys())
    if overlap == 0:
        return 0.0
    precision = overlap / len(pred_tokens)
    recall = overlap / len(gold_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def is_correct_prediction(predicted: str, gold_answers: Sequence[str]) -> bool:
    if not gold_answers:
        return False
    norm_pred = normalize_for_eval(predicted)
    if not norm_pred:
        return False

    for gold in gold_answers:
        norm_gold = normalize_for_eval(gold)
        if not norm_gold:
            continue
        if norm_pred == norm_gold:
            return True
        if norm_pred in norm_gold or norm_gold in norm_pred:
            return True
        if token_f1(norm_pred, norm_gold) >= 0.67:
            return True
    return False


def evaluate(
    *,
    sessions: dict[str, SessionRecord],
    questions: list[QuestionRecord],
    max_questions: int | None,
    top_k: int,
    rrf_k: int,
    semantic_backend: str,
    semantic_model: str,
    semantic_batch_size: int,
    verbose: bool,
) -> tuple[list[PredictionRecord], dict[str, Any], FactStore, EntityGraph]:
    extractor = FactExtractor()
    fact_store = FactStore()
    entity_graph = EntityGraph()

    # Write-time ingest: extract user-message facts for every session.
    for session in sessions.values():
        for msg_idx, message in enumerate(session.messages):
            if normalize_lookup(message.role) != "user":
                continue
            extracted = extractor.extract(
                message.content,
                session_id=session.session_id,
                message_index=msg_idx,
                message_timestamp=message.timestamp or session.started_at or now_iso(),
            )
            added = fact_store.add_facts(extracted)
            for fact in added:
                entity_graph.add_fact(fact)

    session_docs, sentence_docs = build_retrieval_documents(sessions)
    all_docs = {doc.doc_id: doc for doc in [*session_docs, *sentence_docs]}

    session_retriever = HybridRetriever(
        session_docs,
        semantic_backend=semantic_backend,
        semantic_model=semantic_model,
        semantic_batch_size=semantic_batch_size,
    )
    sentence_retriever = HybridRetriever(
        sentence_docs,
        semantic_backend=semantic_backend,
        semantic_model=semantic_model,
        semantic_batch_size=semantic_batch_size,
    )

    questions_to_run = questions[:max_questions] if max_questions is not None else questions
    predictions: list[PredictionRecord] = []

    for idx, question in enumerate(questions_to_run, start=1):
        analysis = analyze_question(question, fact_store)
        dynamic_docs, fact_rank, graph_rank = rank_dynamic_candidates(
            question, analysis, fact_store, entity_graph, top_k=top_k
        )

        retriever = sentence_retriever if analysis.retrieval_mode == "sentence" else session_retriever
        hybrid_rank = [doc_id for doc_id, _ in retriever.search(question.question, top_k=max(top_k * 6, 24), rrf_k=rrf_k)]

        fused = reciprocal_rank_fusion([fact_rank, graph_rank, hybrid_rank], k=rrf_k)
        ranked_ids = [doc_id for doc_id, _ in fused]

        merged_lookup = dict(all_docs)
        merged_lookup.update(dynamic_docs)

        contexts: list[RetrievalDocument] = []
        for doc_id in ranked_ids:
            doc = merged_lookup.get(doc_id)
            if doc is None:
                continue
            contexts.append(doc)
            if len(contexts) >= top_k:
                break

        predicted_answer = infer_answer(question.question, contexts, analysis)
        correct = is_correct_prediction(predicted_answer, question.answers)

        pred = PredictionRecord(
            question_id=question.question_id,
            question=question.question,
            category=question.category,
            predicted_answer=predicted_answer,
            gold_answers=question.answers,
            correct=correct,
            retrieval_mode=analysis.retrieval_mode,
            top_context_ids=[doc.doc_id for doc in contexts],
            top_context_kinds=[doc.kind for doc in contexts],
            fact_hits=sum(1 for doc in contexts if doc.kind == "fact"),
            graph_hits=sum(1 for doc in contexts if doc.kind.startswith("graph")),
        )
        predictions.append(pred)

        if verbose and (idx % 25 == 0 or idx == len(questions_to_run)):
            running_acc = 100.0 * sum(1 for p in predictions if p.correct) / max(len(predictions), 1)
            print(f"[v35] processed {idx}/{len(questions_to_run)} questions | running accuracy: {running_acc:.2f}%")

    overall_correct = sum(1 for p in predictions if p.correct)
    overall_total = len(predictions)
    per_category: dict[str, dict[str, Any]] = {}
    for pred in predictions:
        bucket = per_category.setdefault(pred.category, {"correct": 0, "total": 0})
        bucket["total"] += 1
        bucket["correct"] += 1 if pred.correct else 0
    for bucket in per_category.values():
        bucket["accuracy"] = 100.0 * bucket["correct"] / max(bucket["total"], 1)

    metrics = {
        "overall": {
            "correct": overall_correct,
            "total": overall_total,
            "accuracy": 100.0 * overall_correct / max(overall_total, 1),
        },
        "per_category": dict(sorted(per_category.items(), key=lambda item: item[0])),
        "fact_store_size": len(fact_store.get_all_facts(include_inactive=True)),
        "active_facts": len(fact_store.get_all_facts()),
        "entity_nodes": len(entity_graph.nodes),
        "entity_edges": len(entity_graph.edges),
        "questions_with_fact_context": sum(1 for p in predictions if p.fact_hits > 0),
        "questions_with_graph_context": sum(1 for p in predictions if p.graph_hits > 0),
    }
    return predictions, metrics, fact_store, entity_graph


def save_predictions(path: Path, predictions: Sequence[PredictionRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for prediction in predictions:
            handle.write(json.dumps(asdict(prediction), ensure_ascii=True) + "\n")


def save_metrics(path: Path, metrics: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metrics, ensure_ascii=True, indent=2), encoding="utf-8")


def print_summary(metrics: dict[str, Any]) -> None:
    overall = metrics["overall"]
    print("\n=== LongMemEval v35 Full Evaluation ===")
    print(f"Overall: {overall['accuracy']:.2f}% ({overall['correct']}/{overall['total']})")
    print(
        "Facts / Graph: "
        f"{metrics['active_facts']} active facts ({metrics['fact_store_size']} total), "
        f"{metrics['entity_nodes']} nodes, {metrics['entity_edges']} edges"
    )
    print(
        "Context usage: "
        f"{metrics['questions_with_fact_context']} questions with fact hits, "
        f"{metrics['questions_with_graph_context']} with graph hits"
    )
    print("\nCategory breakdown:")
    for category, bucket in metrics["per_category"].items():
        print(f"  - {category:28s} {bucket['accuracy']:6.2f}% ({bucket['correct']}/{bucket['total']})")
    print()


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run LongMemEval v35 with fact extraction + entity graph fused into hybrid retrieval."
    )
    script_dir = Path(__file__).resolve().parent
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=script_dir / "LongMemEval" / "data",
        help="Path containing LongMemEval JSON/JSONL files (default: eval/LongMemEval/data).",
    )
    parser.add_argument("--sessions-file", type=str, default=None, help="Optional sessions filename inside data-dir.")
    parser.add_argument("--questions-file", type=str, default=None, help="Optional questions filename inside data-dir.")
    parser.add_argument("--max-questions", type=int, default=None, help="Optional cap for number of questions.")
    parser.add_argument("--top-k", type=int, default=10, help="Final number of fused context docs per question.")
    parser.add_argument("--rrf-k", type=int, default=60, help="RRF k constant.")
    parser.add_argument(
        "--semantic-backend",
        type=str,
        choices=("auto", "sentence-transformers", "hash"),
        default="auto",
        help="Semantic backend. auto uses sentence-transformers if available, else hash vectors.",
    )
    parser.add_argument(
        "--semantic-model",
        type=str,
        default="all-MiniLM-L6-v2",
        help="Sentence-transformers model when semantic backend supports it.",
    )
    parser.add_argument("--semantic-batch-size", type=int, default=64, help="Embedding batch size.")
    parser.add_argument(
        "--predictions-out",
        type=Path,
        default=script_dir / "LongMemEval" / "results" / "v35_predictions.jsonl",
        help="Output JSONL path for per-question predictions.",
    )
    parser.add_argument(
        "--metrics-out",
        type=Path,
        default=script_dir / "LongMemEval" / "results" / "v35_metrics.json",
        help="Output JSON path for summary metrics.",
    )
    parser.add_argument(
        "--facts-out",
        type=Path,
        default=script_dir / "LongMemEval" / "artifacts" / "v35_facts.jsonl",
        help="Persisted fact store JSONL path.",
    )
    parser.add_argument(
        "--graph-out",
        type=Path,
        default=script_dir / "LongMemEval" / "artifacts" / "v35_entity_graph.json",
        help="Persisted entity graph JSON path.",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose progress logs.")
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    try:
        sessions, questions = load_dataset(
            args.data_dir,
            sessions_file=args.sessions_file,
            questions_file=args.questions_file,
        )
    except Exception as exc:
        print(f"[error] failed to load dataset: {exc}", file=sys.stderr)
        return 1

    if args.verbose:
        print(f"[v35] loaded {len(sessions)} sessions and {len(questions)} questions from {args.data_dir}")

    predictions, metrics, fact_store, entity_graph = evaluate(
        sessions=sessions,
        questions=questions,
        max_questions=args.max_questions,
        top_k=args.top_k,
        rrf_k=args.rrf_k,
        semantic_backend=args.semantic_backend,
        semantic_model=args.semantic_model,
        semantic_batch_size=args.semantic_batch_size,
        verbose=args.verbose,
    )

    save_predictions(args.predictions_out, predictions)
    save_metrics(args.metrics_out, metrics)
    fact_store.save_jsonl(args.facts_out)
    entity_graph.save_json(args.graph_out)
    print_summary(metrics)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
