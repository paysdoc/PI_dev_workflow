# 13. Cost telemetry & D1
> As-is reference. Ground truth: source code.

## Purpose
The cost engine (`adws/cost/`) computes, formats, and persists the monetary/token cost of each ADW phase. It extracts Anthropic token usage from Claude CLI JSONL output, prices it against per-model pricing tables, detects divergence between locally-computed and CLI-reported cost, renders GitHub-comment cost tables in multiple currencies, and dual-writes per-phase/per-model `PhaseCostRecord` rows to a Cloudflare D1-backed Cost API Worker (`workers/cost-api/`). It is provider-pluggable in shape (anthropic is the only provider implemented).

## Responsibilities
- Define `PhaseCostRecord` (one record per model per phase) and convert orchestrator-supplied legacy usage maps into them (`createPhaseCostRecords`).
- Stream-parse Claude CLI JSONL stdout, accumulating per-turn estimates and capturing finalized per-model actuals + CLI-reported total cost (`AnthropicTokenUsageExtractor`).
- Hold Anthropic per-token pricing tables (opus/sonnet/haiku) and compute cost = Σ(usage[k] × pricing[k]) (`computeCost`, `pricing.ts`).
- Detect divergence between computed and CLI-reported cost beyond a 5% threshold (`checkDivergence`).
- Fetch live multi-currency exchange rates with retry/timeout/fallback (`exchangeRates.ts`).
- Render markdown cost tables, currency totals, divergence warnings, estimate-vs-actual tables, and a legacy `CostBreakdown` markdown table (`reporting/`, `costHelpers.ts`).
- POST records to the Cost API Worker, transforming camelCase → snake_case; failures are swallowed (`d1Client.ts`).
- Worker side: authenticate Bearer token, validate ingest payload, auto-resolve project slug, batch-insert `cost_records` + `token_usage` rows, and serve read aggregation endpoints.

## Key Files
| Path | Role |
|------|------|
| `adws/cost/types.ts` | `PhaseCostRecord`, `TokenUsageMap`/`PricingMap`/`ModelUsageMap`, legacy `LegacyModelUsage*`/`CostBreakdown`, `PhaseCostStatus`, `DivergenceResult`, `TokenUsageExtractor` iface, `createPhaseCostRecords` |
| `adws/cost/computation.ts` | `computeCost`, `checkDivergence` (5% default threshold) |
| `adws/cost/providers/anthropic/extractor.ts` | `AnthropicTokenUsageExtractor` — JSONL parse, per-turn estimate + finalized actuals |
| `adws/cost/providers/anthropic/pricing.ts` | Per-token opus/sonnet/haiku tables, `getAnthropicPricing` (sonnet fallback) |
| `adws/cost/exchangeRates.ts` | `fetchExchangeRates` (open.er-api.com), currency symbols, fallback rates |
| `adws/cost/costHelpers.ts` | Legacy merge/total helpers, `buildCostBreakdown`, `formatCostBreakdownMarkdown`, `persistTokenCounts`, token-budget helpers (`computePrimaryModelTokens` etc.) |
| `adws/cost/reporting/commentFormatter.ts` | `formatCostTable`, `formatDivergenceWarning`, `formatEstimateVsActual`, `formatCurrencyTotals`, `formatCostCommentSection` |
| `adws/cost/d1Client.ts` | `transformToIngestPayload`, `postCostRecordsToD1` (HTTP dual-write) |
| `adws/cost/index.ts` | Barrel; renames legacy types (`ModelUsage`/`ModelUsageMap`) for backward compat |
| `workers/cost-api/src/{index,auth,ingest,queries,cors,types}.ts` | Cloudflare Worker: router, Bearer auth, ingest, read APIs |
| `workers/cost-api/src/schema.sql`, `migrations/0001_initial.sql` | D1 schema: `projects`, `cost_records`, `token_usage` |
| `workers/cost-api/wrangler.toml` | Worker config: route `costs.paysdoc.nl/*`, EU-jurisdiction D1 `adw-costs`, secrets-store `COST_API_TOKEN` |
| `adws/cost/__tests__/`, `workers/cost-api/test/` | Vitest unit tests |

## Behavior & Flows
1. **Extraction (during phase):** the phase runner feeds CLI stdout chunks to `AnthropicTokenUsageExtractor.onChunk`. The extractor line-buffers, parses each JSON line, and:
   - `assistant` messages: accumulate accurate `input_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens` per model, plus an estimated `output` from text content (~4 chars/token); dedupes by `message.id`; falls back to a `modelHint` then `'unknown'` for the model key.
   - `result` message: snapshots the pre-finalization estimate, records `total_cost_usd` as `reportedCostUsd`, replaces per-model usage with the actual `modelUsage` (camelCase→snake_case via `toTokenUsageMap`), and marks finalized.
2. **Record creation:** each phase (`adws/phases/*.ts`) calls `createPhaseCostRecords` with a legacy `LegacyModelUsageMap` (camelCase from orchestrators), producing one `PhaseCostRecord` per model. NOTE: currently `computedCostUsd === reportedCostUsd === usage.costUSD` (the CLI cost is copied; local `computeCost` is not yet wired into record creation). `estimatedTokens`/`actualTokens` are set `undefined`.
3. **Reporting:** `formatCostCommentSection` (gated on `SHOW_COST_IN_COMMENTS`) fetches rates for non-USD `COST_REPORT_CURRENCIES`, builds a per-phase table, currency totals, a `>5%` divergence blockquote (`checkDivergence`), and an estimate-vs-actual table when populated, wrapped in a `<details>` block.
4. **Dual-write:** `phaseRunner.ts:84` calls `postCostRecordsToD1({ project: repoName, repoUrl, records })`. The client skips silently if `COST_API_URL` is unset or records empty, transforms to snake_case (`contextResetCount → continuation_count`), and POSTs `COST_API_URL/api/cost` with `Authorization: Bearer COST_API_TOKEN`. All errors are caught and `log(..., 'warn')`-ed — D1 failures never crash the workflow.
5. **Worker ingest:** validates payload, `resolveProject` does `INSERT OR IGNORE` + `SELECT` on `projects.slug` (auto-create, concurrency-safe), batch-inserts `cost_records` (RETURNING id), then a flattened batch of `token_usage` rows (one per token type). Returns `201 {inserted}`.
6. **Worker reads:** `GET /api/projects`, `/api/projects/:id/costs/breakdown` (SUM by model+provider, `COALESCE(reported, computed)`), `/api/projects/:id/costs/issues` (two queries to avoid join fan-out; phases ordered plan→build→test→review→document). All routes Bearer-auth via constant-time compare; CORS via `ALLOWED_ORIGINS`.
7. **Exchange rates:** `fetchExchangeRates` hits `open.er-api.com/v6/latest/USD`, 5s timeout, 2 retries (exponential backoff), caches `lastKnownRates`, falls back to hardcoded `FALLBACK_EUR_RATE = 0.92`.

## Data Structures
- **`PhaseCostRecord`**: `{workflowId, issueNumber, phase, model, provider:'anthropic', tokenUsage:{input,output,cache_read,cache_write}, computedCostUsd, reportedCostUsd?, status, retryCount, contextResetCount, durationMs, timestamp, estimatedTokens?, actualTokens?}`.
- **`TokenUsageMap`/`PricingMap`** = `Record<string,number>` (snake_case keys). **`ModelUsageMap`** = `Record<model, TokenUsageMap>`.
- **Legacy `LegacyModelUsage`** (camelCase: `inputTokens/outputTokens/cacheReadInputTokens/cacheCreationInputTokens/costUSD`) → `LegacyModelUsageMap`; `CostBreakdown` (`totalCostUsd`, `modelUsage`, `currencies[]`).
- **`PhaseCostStatus`** = `success | partial | failed`.
- **D1 schema**: `projects(id,slug UNIQUE,name,repo_url,created_at)`; `cost_records(...,project_id FK, computed_cost_usd, reported_cost_usd, status, retry_count, continuation_count, duration_ms, migrated)`; `token_usage(cost_record_id FK, token_type, count)`.
- **`IngestPayload`/`IngestRecord`** (snake_case) — Worker contract, supports a `migrated` flag for historical CSV backfill.

## Public Interface
- Barrel `adws/cost/index.ts`: `createPhaseCostRecords`, `PhaseCostStatus`, `computeCost`, `checkDivergence`, `AnthropicTokenUsageExtractor`, `ANTHROPIC_PRICING`/`getAnthropicPricing`, `fetchExchangeRates`/`CURRENCY_SYMBOLS`, `postCostRecordsToD1`, reporting formatters, legacy helpers (`mergeModelUsageMaps`, `buildCostBreakdown`, `formatCostBreakdownMarkdown`, `persistTokenCounts`, `computeTotalTokens`/`computeDisplayTokens`/`computePrimaryModelTokens`).
- Worker HTTP: `POST /api/cost`, `GET /api/projects`, `GET /api/projects/:id/costs/{breakdown,issues}`.

## Dependencies
- Upstream (depends on):
  - **Config & Environment (1)**: `COST_API_URL`, `COST_API_TOKEN`, `SHOW_COST_IN_COMMENTS`, `COST_REPORT_CURRENCIES` (`core/environment.ts`, `core/config.ts`).
  - **State & ADW ID (2)**: `AgentStateManager.read/writeState` in `persistTokenCounts`.
  - `core/utils.log`.
  - External: ExchangeRate-API (`open.er-api.com`); Worker depends on Cloudflare D1 + Secrets Store.
- Downstream (depended on by):
  - **Phase runner & cost-tracking composition (5)**: `phaseRunner.ts` drives the extractor and calls `postCostRecordsToD1`.
  - **Phases & orchestrators (7)**: every `adws/phases/*.ts` calls `createPhaseCostRecords`; `buildPhase` uses `computeDisplayTokens`/`computePrimaryModelTokens` for token-budget limits.

## Interactions
| Other subsystem | Direction | What is exchanged |
|-----------------|-----------|-------------------|
| 1 Config & Environment | in | `COST_API_URL/TOKEN`, `SHOW_COST_IN_COMMENTS`, `COST_REPORT_CURRENCIES` |
| 2 State & ADW ID | in/out | `workflowId`(adwId) on records; `persistTokenCounts` writes `state.json` metadata |
| 4 Agent execution | in | raw Claude CLI JSONL stdout chunks fed to the extractor |
| 5 Phase runner & cost composition | out | extractor lifecycle + `postCostRecordsToD1` invocation at `phaseRunner.ts:84` |
| 7 Phases & orchestrators | in/out | phases supply legacy usage maps to `createPhaseCostRecords`; receive token-budget totals; comment formatters posted to GitHub |
| 16 Supply-chain | n/a | Worker bundled deps (`itty-router`, `miniflare` for tests) |

## PRD Divergences
- **Local computed cost not independently calculated.** `specs/prd/d1-cost-database.md` frames `computed_cost_usd` (local pricing) vs `reported_cost_usd` (CLI) as distinct; in code `createPhaseCostRecords` copies CLI `costUSD` into BOTH fields, so divergence detection is effectively a no-op for ingested records. `computeCost`/`pricing.ts` exist but are not wired into record creation. `types.ts` comments acknowledge this ("equals reportedCostUsd until local computation is implemented").
- **Estimate-vs-actual unwired.** `estimatedTokens`/`actualTokens` are always `undefined` from `createPhaseCostRecords`, so `formatEstimateVsActual` never renders, despite the extractor capturing `getEstimatedUsage()`.
- **Pricing table staleness.** `ANTHROPIC_PRICING` keys hardcode `claude-opus-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`; unknown models silently fall back to sonnet pricing.
- Otherwise schema, dual-write, auth (Bearer + constant-time), and EU-jurisdiction D1 match the PRD.
