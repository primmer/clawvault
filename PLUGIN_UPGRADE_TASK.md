# ClawVault Plugin Upgrade — Surpass memory-lancedb-pro

## Context
Our OpenClaw memory plugin source is in `src/plugin/`. Bundled output goes to `packages/plugin/dist/index.js`.
Competitor reference: github.com/win4r/memory-lancedb-pro — feature-rich LanceDB-based memory plugin.

## Our Advantages (keep these)
- Markdown-native vault (human-readable, git-friendly files)
- Template-driven typed primitives (person, decision, task, project, lesson, memory_event)
- Auto-linker (wiki-links between entries)
- Write-time fact extraction
- Observer/session parser for auto-capture
- qmd integration for local BM25 search
- Proven 67.6% LongMemEval score

## What to Add (in-process TypeScript, not shell-outs)

### 1. In-Process Hybrid Retrieval (PRIORITY)
Currently we shell out to qmd for BM25 and run separate semantic-rerank.mjs. Port retrieval into the plugin as proper TypeScript:
- BM25 in-process (reuse from src/lib/hybrid-search.ts)
- Semantic search via @huggingface/transformers (already in src/lib/hybrid-search.ts)
- RRF fusion (already implemented)
- Fall back to qmd only if in-process fails

### 2. Cross-Encoder Rerank (optional, API-based)
- Support Jina/SiliconFlow/Voyage/Pinecone reranker APIs
- Config: retrieval.rerankApiKey, rerankModel, rerankEndpoint, rerankProvider
- Graceful degradation: skip if no key or API fails
- 60% reranker + 40% fused score

### 3. Recency Boost + Time Decay
- Recency: additive bonus, configurable half-life (14d default), weight (0.10)
- Time decay: multiplicative penalty. score *= 0.5 + 0.5 * exp(-ageDays / halfLife). Default 60d.
- Both disableable (set 0)

### 4. Noise Filtering
- Filter refusals, meta-questions, greetings, low-quality on both write and read
- src/plugin/noise-filter.ts

### 5. Adaptive Retrieval
- Skip memory retrieval for greetings, slash commands, confirmations, emoji-only
- src/plugin/adaptive-retrieval.ts

### 6. Length Normalization
- score *= 1 / (1 + log2(charLen / anchor)), anchor = 500

### 7. MMR Diversity
- Maximal Marginal Relevance post-scoring to diversify results

### 8. Management CLI
- clawvault memory stats/export/import/reembed

### 9. openclaw.plugin.json
- Full JSON Schema config for all retrieval, noise, adaptive, recency/decay settings

### 10. Multi-Scope
- Scopes: global, agent:<id>, project:<name>, user:<id>
- Tag at write, filter at search. Default: global.

## Constraints
- Work with existing markdown vault structure
- Local-first (reranker is optional)
- Tests for all new modules (vitest)
- TypeScript strict mode
- Study existing code in src/plugin/ and src/lib/ before writing
