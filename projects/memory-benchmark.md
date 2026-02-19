---
title: Memory Benchmark
aliases: [memory-benchmark, longmemeval]
tags: [project, benchmark, memory]
status: active
---

# [[projects/memory-benchmark|Memory Benchmark]] (LongMemEval)

Tracking ClawVault's performance on the LongMemEval benchmark.

## Current Scores (v11, local ollama)
- Overall: 62.8%
- SSU: 82.9%
- KU: 73.1%
- Temporal: 63.9%
- SSA: 66.1%
- Pref: 60.0%
- Multi-session: 44.4% (bottleneck — retrieval ceiling)

## Target
- Local: 70%+ overall, 60%+ multi-session
- API: 85%+ overall

## Key Finding
Retrieval is the ceiling, not model quality. v11+Gemini only gained +4.5pp on multi-session.

## Related
- [[cognition/current-focus]]
- [[cognition/lessons]]
