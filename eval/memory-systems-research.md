# Memory Systems Research — What We Should Steal
*Compiled 2026-02-21 for ClawVault cognition improvement*

## Executive Summary

We're at 57% on LongMemEval with hybrid BM25+semantic. The landscape has clear winners. Here's what matters:

**Key insight: We're missing the WRITE side.** Our biggest gap isn't retrieval — it's that we store raw text and retrieve raw text. The best systems (mem0, Zep) extract structured facts AT WRITE TIME, then retrieve those facts. We only do extraction at read time (via LLM answer generation). This is backwards.

---

## 1. Mem0 (mem0.ai) — The Current Leader

**What it is:** Universal memory layer. YC-backed. 26% more accurate than OpenAI Memory on LOCOMO benchmark.

**Architecture (3-step pipeline on WRITE):**
1. **Information Extraction** — LLM processes conversation, extracts key facts/preferences/decisions as structured memories
2. **Conflict Resolution** — Checks existing memories for duplicates/contradictions; latest truth wins
3. **Storage** — Vector store + optional graph store (Mem0^g variant)

**Memory Types (4 layers):**
- Conversation memory (single turn, ephemeral)
- Session memory (minutes to hours, task-scoped)
- User memory (weeks to forever, personalization)
- Organizational memory (shared across agents)

**Mem0^g (Graph variant):**
- Layers a knowledge graph ON TOP of vector memory
- Entities → nodes, relationships → edges with temporal metadata
- Enables multi-hop reasoning ("Alice works at Google → Google is in California → Alice is in California")
- This is what makes cross-session reasoning work

**Key numbers:**
- +26% accuracy vs OpenAI Memory (LOCOMO benchmark)
- 91% lower latency vs full-context
- 90% fewer tokens

**What we should steal:**
1. **Write-time fact extraction** — Extract structured memories when storing, not when retrieving
2. **Conflict resolution on write** — Deduplicate and update existing memories instead of appending
3. **Graph memory layer** — Entity-relationship graph for multi-hop cross-session reasoning
4. **Memory type separation** — Distinguish ephemeral session context from permanent user knowledge

---

## 2. MemGPT / Letta — OS-Inspired Memory Paging

**What it is:** Treats LLM context like an OS treats RAM. Pioneered by Charles Packer (2023).

**Architecture:**
- **Main context (RAM)** — LLM's active context window
- **External memory (disk)** — Searchable long-term store
- **Paging mechanism** — Swaps relevant memories in/out of context
- **Self-editing** — The LLM itself decides what to retain, discard, or retrieve

**Key innovation: The LLM is its own memory manager.**
The model has explicit tools to:
- `core_memory_append` — add to persistent memory
- `core_memory_replace` — update existing memory
- `archival_memory_insert` — store in long-term
- `archival_memory_search` — retrieve from long-term
- `conversation_search` — search chat history

**What we should steal:**
1. **Agent-controlled memory operations** — Let the LLM decide what's worth remembering (we partially do this via memory_store)
2. **Core memory vs archival memory split** — Always-loaded persona/facts vs searchable archive
3. **Memory summarization/compression** — Auto-compress old conversations into summaries

---

## 3. Zep — Temporal Knowledge Graph

**What it is:** Memory layer with temporal awareness. Focuses on facts changing over time.

**Architecture:**
- Stores conversation history + auto-extracted entities/relationships
- Temporal metadata on all facts (when was this true?)
- Knowledge graph for structured reasoning
- Summarization of old conversations to reduce storage

**Key insight: TEMPORAL REASONING.**
- "John lived in NYC in 2020, moved to London in 2023"
- Can answer "Where did John live in 2021?" correctly
- Timestamps on graph edges enable historical queries

**What we should steal:**
1. **Temporal metadata on all memories** — When was this fact established? When was it superseded?
2. **Automatic entity extraction + linking** — Build a people/places/things graph from conversations
3. **Conversation summarization** — Compress old sessions into summaries, keep full text in archive

---

## 4. Anthropic's Approach (Claude Memory)

**Philosophy (from their public writing):**
- Context window as primary "memory" — Claude uses 200K token windows
- Memory as system prompt injection — Stored facts prepended to context
- Conservative approach — Better to ask again than hallucinate from bad memory
- User control — Explicit save/delete, no hidden accumulation

**Project Memory (Claude for work):**
- Per-project persistent context
- User-curated, not auto-extracted
- Visible and editable by the user

**What we should steal:**
1. **User-visible, auditable memory** — We do this (vault is files). Keep it.
2. **Conservative memory policy** — Don't over-remember. Quality > quantity.
3. **Project-scoped memory** — Different contexts for different projects (we could do this with vault subdirectories)

---

## 5. Comparison Matrix

| System | Storage | Retrieval | Write-time Extraction | Conflict Resolution | Graph | Temporal | Open Source |
|--------|---------|-----------|----------------------|--------------------:|-------|----------|-------------|
| **ClawVault** | Markdown files | BM25 + semantic embeddings + RRF | No (raw text) | No | No | Partial (dates in filenames) | Yes |
| **Mem0** | Vector + Graph DB | Semantic + reranking | Yes (LLM extraction) | Yes (dedup + update) | Yes (Mem0^g) | Yes | Yes (core) |
| **MemGPT/Letta** | Tiered (core + archival) | Agent-directed search | Agent decides | Agent manages | No | No | Yes |
| **Zep** | PostgreSQL + Graph | Semantic + graph traversal | Yes (auto-extraction) | Yes (temporal) | Yes | Yes (first-class) | Partial |
| **Claude** | System prompt | Exact retrieval | User-curated | N/A | No | No | No |

---

## 6. Recommendations for ClawVault (Ranked by Expected Impact)

### HIGH IMPACT (do these first)

**1. Write-time fact extraction** (+15-20pp estimated)
- When `memory_store` is called, run LLM extraction to produce structured facts
- Store both the raw text AND extracted (entity, relation, value, timestamp) tuples
- This is what mem0 does and it's their #1 advantage
- **Implementation:** Add a post-write hook that extracts entities/relations using Gemini Flash

**2. Conflict resolution / memory deduplication** (+5-10pp)
- Before storing a new memory, search for existing memories about the same topic
- UPDATE existing memory instead of creating duplicates
- "User likes pizza" + "User prefers Italian food" → merge into one fact
- **Implementation:** Semantic similarity check on write, merge if >0.85 similarity

**3. Graph memory layer for cross-session reasoning** (+10-15pp)
- Build entity → relationship → entity triples from stored memories
- When querying, traverse the graph for multi-hop answers
- "How many restaurants has the user mentioned?" → scan all entity nodes of type restaurant
- **This directly addresses our weakest category (multi-session counting)**

### MEDIUM IMPACT

**4. Memory type separation**
- Tag memories as: preference, fact, episodic, entity
- Weight preferences higher for preference queries, episodes for temporal queries
- We partially do this (categories) but don't use it in retrieval

**5. Conversation summarization**
- Auto-summarize old sessions into 2-3 sentence summaries
- Keep full text searchable but use summaries for context assembly
- Reduces noise in retrieval results

**6. Temporal metadata first-class**
- Every memory gets a `valid_from` and optionally `valid_until` timestamp
- Enables "What was X at time Y?" queries
- Our temporal reasoning score (47%) would benefit most

### LOWER IMPACT (nice to have)

**7. Core memory concept (from MemGPT)**
- Small set of always-loaded facts (user profile, key preferences)
- Injected into every prompt, never needs retrieval
- We do this with USER.md/SOUL.md — already implemented

**8. Reranking on retrieval**
- After initial retrieval, rerank results with a cross-encoder
- Mem0 uses this in v1.0. Small but consistent improvement.

---

## 7. Proposed Experiment Order

1. **v35: Write-time extraction** — Extract facts from existing vault memories, build structured index
2. **v36: Graph layer** — Entity extraction → Neo4j-lite (in-memory graph) → graph-augmented retrieval
3. **v37: Conflict resolution** — Dedup pipeline on write
4. **v38: Temporal first-class** — Add valid_from/valid_until, temporal-aware retrieval
5. **v39: Hybrid everything** — Best of all above

Target: 70%+ overall on LongMemEval with v39.

---

## Sources
- mem0.ai docs: https://docs.mem0.ai
- mem0 research: https://mem0.ai/research (LOCOMO benchmark)
- mem0 GitHub: https://github.com/mem0ai/mem0 (40K+ stars)
- MemGPT paper: Packer et al., 2023
- Zep: https://www.getzep.com
- Claude memory: Anthropic product docs

## Note on "A Cortex"
Could not find a specific system called "a cortex" or "acortex" in AI memory literature. The closest concepts are:
- Numenta's Hierarchical Temporal Memory (HTM) — cortex-inspired but not an agent memory system
- General cortical-inspired architectures — academic, not production systems
- May have been a misremembering of "Zep Cortex" or similar. Worth clarifying what Pedro had in mind.
