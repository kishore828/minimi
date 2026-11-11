# Memento Evaluation Report

Generated: 2026-11-11T08:00:28.960Z by `npm run eval`.

## Methodology

All ten scenarios from the challenge brief are executed end-to-end through the
real orchestrator, database, memory retrieval, research pipeline and citation
validation — with the OpenAI client and the Tavily provider replaced by
deterministic fakes (scripted, context-aware responses). This isolates the
orchestration logic for repeatable measurement.

**Honest labeling:** the latencies below measure *orchestration overhead only*
(SQLite I/O, retrieval, ranking, validation, event streaming). Real-world
latency is dominated by LLM and search-provider network time, which cannot be
meaningfully measured without API keys.

## Scenario results

| Scenario | Name | Result | Searches | LLM calls | Citations | Comparisons | Latency | Notes |
|---|---|---|---|---|---|---|---|---|
| TEST 1 | Historical retrieval | ✅ pass | 0 | 5 | 0 | 0 | 6 ms | Exact list retrieved from memory, zero web searches |
| TEST 2 | Historical accuracy re-check | ✅ pass | 1 | 8 | 1 | 1 | 6 ms | Claim extracted, re-verified, change cited |
| TEST 3 | Pricing changes since last Tuesday | ✅ pass | 2 | 8 | 2 | 2 | 3 ms | Both providers queried individually and compared |
| TEST 4 | Multi-entity comparison | ✅ pass | 5 | 8 | 5 | 5 | 5 ms | 5 distinct queries, 5 compared entities, 5 citations |
| TEST 5 | No unnecessary search | ✅ pass | 0 | 5 | 0 | 0 | 2 ms | Stable knowledge answered with zero searches |
| TEST 6 | Missing history | ✅ pass | 0 | 5 | 0 | 0 | 2 ms | Honestly reported missing history, no fabrication |
| TEST 7 | Contradictory sources | ✅ pass | 1 | 8 | 2 | 1 | 2 ms | Official source prioritized, conflict flagged INCONCLUSIVE |
| TEST 8 | Failed search provider | ✅ pass | 0 | 6 | 0 | 0 | 2 ms | Graceful degradation, no fabricated citations |
| TEST 9 | Follow-up continuity | ✅ pass | 1 | 4 | 1 | 0 | 1 ms | 'their' resolved from conversation context |
| TEST 10 | Date resolution (deterministic) | ✅ pass | 0 | 0 | 0 | 0 | 0 ms | 5/5 expressions exact (Asia/Kolkata) |

## Aggregate metrics

| Metric | Value |
|---|---|
| Scenarios passed | 10/10 |
| Historical retrieval accuracy (TEST 1, 6, 9) | 3/3 |
| Temporal comparison accuracy (TEST 2, 3, 4, 7) | 4/4 |
| Unnecessary-search rate (memory/stable scenarios) | 0% (target 0%) |
| Invalid-citation rate (research scenarios) | 0% (target 0%) |
| Total provider search calls across suite | 10 |
| Total LLM calls across suite | 57 |
| Mean orchestration latency (mocked providers) | 3 ms |

## Interpretation

- **Unnecessary-search rate 0%** — pure memory lookups (TEST 1, 6) and stable
  knowledge questions (TEST 5) never touch the search provider; the planner
  classification plus deterministic guardrails enforce this.
- **Citation validity** — every `[n]` marker that survives validation points
  at a numbered entry in the evidence ledger; out-of-range markers are
  stripped server-side and never rendered.
- **Comparison discipline** — change classifications (TEST 2, 3) carry valid
  evidence citations; contradictions (TEST 7) surface as INCONCLUSIVE with
  both sources cited; unverifiable claims (TEST 8) are marked
  NO_LONGER_VERIFIABLE rather than guessed.
- **Deterministic dates** — TEST 10 verifies exact UTC ranges for temporal
  expressions in Asia/Kolkata, including timezone-boundary cases, with zero
  LLM involvement.
