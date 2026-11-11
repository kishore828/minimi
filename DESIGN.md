# Memento — Design Notes

*Your conversations have a history. The internet keeps changing. Memento connects both.*

## 1. Problem interpretation

The brief is not "build a chatbot with search". It is: **time is a first-class dimension of a conversation**. Users reference what was said days ago ("what did we shortlist on Monday?"), and the world those statements described has moved since. A research agent that answers only from *now* (web search) or only from *then* (chat history) is answering half the question. Memento's job is to hold both halves and diff them honestly.

From that reading, three hard requirements fall out: memory must survive restarts and be *retrievable by date and topic*; "what changed since X" must be *comparable claim-by-claim, not vibes*; and every factual statement must be *traceable to a source the system actually saw*.

## 2. Core architecture

One orchestrated pipeline, explicitly staged, with the LLM used for judgment at specific points — never as the controller:

```
message → temporal resolution (deterministic) → memory retrieval (SQLite: recency+FTS+dates+summaries)
        → planning (LLM classification, schema-validated, guardrailed)
        → [if needed] claim extraction (LLM) → bounded multi-query search (cache, concurrency, caps)
        → ranking → balanced evidence ledger → [if comparing] classification w/ citations (LLM, validated)
        → streamed response (citations sanitized) → atomic persistence & parallel wrap-up
```

Each stage emits a real SSE event; the UI's research panel renders only those events. There are no synthetic animations. Bounded by config: max queries/turn, max orchestration iterations, per-query results, research wall-clock time, and a token budget that disables optional stages (summaries, memory extraction) when exhausted.

**Why an orchestrated pipeline rather than model-driven tool-calling loops:** the decisions that must *never* be wrong (don't search for memory questions, don't claim change without a citation, don't fabricate history) are deterministic guardrails in code, unit-tested. An LLM deciding these per-turn is non-deterministic and unauditable.

## 3. Why memory is separate from conversation history

Conversation history is the **transcript**; memory is the **distilled, retrievable index**. History answers "what was said"; memory answers "what do we know". They have different lifecycles and query patterns:

- **Messages** are append-only, ordered, retrieved by conversation and time window.
- **Memories** are extracted facts/decisions/entities with importance, category and a link to the source message; they are ranked by `importance + recency-decay + keyword overlap + entity match` and searched via SQLite FTS5.

A shortlist decision from three weeks ago must still be findable when the conversation that produced it has scrolled out of any context window. Summaries (rebuilt every ~6 messages) preserve prices, plans and dates in compact form — they exist primarily as *retrieval artifacts*. Separating the two also keeps a deletion story clean: deleting a conversation deletes its memories, but a *new* conversation can still recall an *old* one's conclusions through the same index.

## 4. Why temporal comparison is deterministic (mostly)

Dates are computed by a parser (`shared/utils/temporal.ts`), never by the LLM: "last Tuesday", "since November 3", "three months ago" resolve to exact UTC ranges in the configured timezone (default Asia/Kolkata), including boundary cases ("November 3" asked at 00:30 IST is still November 3; "last Tuesday" said *on* a Tuesday means a week back). Temporal references are tagged as `historical` vs. `present_anchor` ("correct today?" anchors the present without polluting date-window history lookup), with a same-conversation fallback when the baseline occurred earlier in the active thread. These ranges drive date-window retrieval and are injected into prompts as authoritative facts.

The comparison *judgment* (was $19 → $25 a price increase?) is an LLM step — but a constrained one: structured output over a fixed classification enum, with a hard rule that a change classification **must cite evidence indexes**, validated in code; unsupported changes are downgraded to `INCONCLUSIVE`. Unknown dates stay `null` — the system never invents a publication date to make a comparison look cleaner, and distinguishes publication date / retrieval date explicitly.

## 5. Why exactly one external tool (web search)

Memory, history and evidence are **application infrastructure**: deterministic, auditable, local. Wrapping them as agent tools would mean the model *chooses* whether to remember — the failure mode this product exists to prevent. A single `web_search` tool, behind a registry that clamps limits, keeps the agent's external surface tiny: one thing that can lie to you (the web), mediated by one pipeline that validates it (the ledger). It also makes provider swaps (Tavily → anything) a one-class change behind the `SearchProvider` interface.

## 6. How search orchestration works

The query planner (LLM, with a deterministic fallback) expands the question into **entity-scoped queries** — one per product/aspect, never a blended query — biased toward primary sources ("pricing", "changelog", official domains), with `news` topic and time ranges only where freshness is the point. Execution is bounded-concurrency with a SQLite-backed TTL cache (survives restarts, doubles as a rate-limit shield), per-query failure isolation, and one optional refinement round when specific entities came back with zero coverage. Results are normalized (canonical URLs, domains, lenient date parsing), deduplicated, and ranked by `provider score + official-domain & official-path signals + freshness + topical overlap`, with a same-domain diversity penalty and balanced per-entity ledger selection so one vendor cannot crowd out others in multi-entity comparisons.

## 7. How evidence and citations are validated

Every citable source is minted in an **evidence ledger**: numbered, deduplicated by URL, with excerpt, publication date (or explicit unknown) and retrieval timestamp. The response generator only ever sees the ledger's numbered block, and after streaming, code (not the model) strips any `[n]` marker outside the ledger's range. The same validation runs on comparison outputs — an asserted change without a surviving citation is downgraded to `INCONCLUSIVE` with the reason attached. The UI renders chips only for valid indexes; the source list below each answer shows what was actually retrieved. Fabricating a citation is structurally difficult: the model would have to output an index that the sanitizer then removes.

## 8. Stale information and conflicting sources

- **Retrieval-time honesty:** evidence blocks always carry publication and retrieval dates; the response prompt demands date-qualified statements.
- **Conflicts:** the ranker prefers primary sources; the comparator is instructed to prefer them when they conflict with secondary reporting and to say so; a genuine conflict is classified `INCONCLUSIVE` with both sources cited, never silently averaged.
- **Absence of evidence:** no current evidence → `NO_LONGER_VERIFIABLE`, phrased as "could not verify", never "unchanged". If search fails entirely, the turn completes with an explicit "could NOT verify current information" instruction rather than a crash.
- **Missing history:** if the referenced conversation doesn't exist, the model is instructed — and the pipeline configured — to say so and offer a fresh start, never to improvise a memory.

## 9. Alternatives considered and rejected

- **Fully autonomous multi-agent architecture** (planner/researcher/critic agents looping over tools). Rejected: unbounded latency and cost per turn, non-reproducible behavior, and the critical safety decisions (search vs. memory, citation validity) become emergent rather than enforced. Memento keeps the *shape* of that idea (plan → execute → verify) as bounded, single-process stages.
- **In-memory conversation history.** Rejected: violates the core premise — memory must survive restarts and be queryable weeks later by date and topic. SQLite gives that with zero configuration.
- **Vector-database-only memory.** Rejected as the *primary* retrieval mechanism: embeddings answer "semantically similar", but the product's questions are heavily *temporal and exact* ("November 3", "the five CRMs we shortlisted"), where date-window queries and FTS are precise and an embedding lookup is lossy. The memory interface leaves room for an embedding provider as an additional signal (hybrid), but requiring a paid embedding API for core behavior was a non-starter.
- **Search the web for every message.** Rejected: most questions are memory or stable-knowledge questions; searching them is slow, costly, and actively harmful to trust (searching "what did we discuss Monday?" returns the *internet's* Monday, not the user's). The planner plus deterministic guardrails keep the unnecessary-search rate at a measured 0% on the eval suite.
- **One giant LLM prompt with all history stuffed in.** Rejected: context windows are finite and expensive; recall quality degrades as history grows; per-decision guardrails are impossible; citation validation would be pure hope. The layered pipeline keeps each LLM call small, purposeful and testable.

## 10. With another week

1. **Embeddings as a hybrid signal** (local model or batched API) alongside FTS + recency for recall questions that don't share vocabulary with the original conversation.
2. **Per-entity claim graphs** — structured storage of prices/features per subject over time, so "what changed" queries hit a table instead of re-extracting claims from transcripts.
3. **Concurrency across turns** — request-scoped DB handles so simultaneous users get real isolation (single-connection SQLite serializes writes today).
4. **Auth & multi-user** — the user table and repository layer are ready; needs session handling and per-user rate limits.
5. **LLM-driven eval harness against live providers** (golden transcripts, drift detection) to complement the mocked suite.
6. **Streaming refinement** — interleaving comparison generation with search so long research turns show partial structure earlier.
