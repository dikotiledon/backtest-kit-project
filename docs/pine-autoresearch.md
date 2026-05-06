# Pine autoresearch

Pine autoresearch is the project-local research loop for `pine/test.pine`. It searches nearby Pine input configurations, evaluates candidates across pinned market windows, writes reproducible manifests, and promotes only when matrix, expectancy, lineage, and safety gates agree.

This is not generic backtesting. Generic Backtest Kit modes live in the CLI docs; autoresearch is the closed-loop strategy research system for the current Pine strategy.

## Quick orientation

| Concept | Meaning |
| --- | --- |
| Champion | Current accepted config. Stored in `researchRoot/champion.json` and mirrored in manifests. |
| Challenger | Best candidate from the latest scout cycle. Must beat gates before promotion. |
| Primary lab | Main selection window. Usually current symbol/timeframe window. |
| Shadow labs | Robustness windows/symbols. A challenger must pass enough shadows. |
| Blind holdout labs | Validation-only labs. Not used to search/select candidates. |
| Manifest | Canonical run artifact in `researchRoot/manifests/<runId>.json`. Promotion targets this exact artifact. |
| Digest | Human-readable summary in `digestRoot/latest-digest.md`. |
| Promotion queue | Append-only queue that pauses normal research when a promotion is pending. |
| Regime-exit research | Optional feature lane for regime-conditioned exit and global all-parameter research. See [Pine regime-exit research](./pine-regime-exit-research.md). |

## Runtime commands

Package scripts wrap `scripts/pine-autoresearch.mjs` with the default config.

| Command | Purpose | Typical use |
| --- | --- | --- |
| `npm run pine:autoresearch` | full scout cycle | scheduled full research |
| `npm run pine:autoresearch:micro` | small scout cycle | fast smoke / cadence check |
| `npm run pine:autoresearch:digest` | render latest digest | human status update |
| `npm run pine:autoresearch:promote` | promote selected manifest | manual promotion after review |
| `npm run pine:autoresearch:autopromote` | consume promotion queue | scheduled guarded promotion |
| `npm run pine:dataset:pin` | create pinned datasets | bootstrap offline windows |
| `npm run pine:dataset:stage` | materialize pinned cache | prepare strict offline runs |
| `npm run pine:dataset:verify` | verify pinned cache completeness | required before strict research |

Direct form:

```bash
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --profile micro
node scripts/pine-autoresearch.mjs digest --config config/pine-autoresearch.default.json
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --run-id <runId>
node scripts/pine-autoresearch.mjs autopromote --config config/pine-autoresearch.default.json
```

## Core lifecycle

### 1. Scout / cycle

A cycle is the main research unit.

1. Load `config/pine-autoresearch.default.json`.
2. Resolve profile (`full` or `micro`) and max config count.
3. Ensure output directories exist.
4. Acquire the JS lock.
5. Check promotion queue.
6. Stop if a pending promotion exists, unless `--force-cycle` is used.
7. Load champion state from `champion.json`, latest promoted manifest, latest champion manifest, or seed config.
8. Select research track and scheduler state.
9. Generate candidate batch.
10. Run primary sweep.
11. Evaluate shortlisted candidates on matrix labs.
12. Apply expectancy, matrix, lineage, and promotion gates.
13. Write manifest, latest pointer, history event, scout digest, and regime/asymmetry artifact.
14. Optionally enqueue a promotion item.
15. Prune old run artifacts according to artifact policy.

### 2. Digest

Digest mode reads the latest manifest and writes a human-facing summary. It does not search or promote.

Use digest when you need the current state without mutating strategy config.

### 3. Promote

Promotion patches the Pine script/config from an exact manifest. Prefer `--run-id` or queue-backed promotion over “latest” assumptions.

Promotion writes:
- updated champion state
- history event
- promotion digest
- queue status event, when promotion came from queue

### 4. Autopromote

Autopromote consumes the promotion queue. It promotes only if:
- a pending queue item exists
- queued manifest is still present
- queued candidate/champion fingerprints match expectations
- matrix/policy gates still pass
- cooldown and daily cap allow promotion
- lineage anti-ping-pong checks pass

### 5. Holdout / blind holdout

Blind holdout labs are validation only. They must not generate or select candidates. Use them to detect overfit after a candidate is selected.

## Default config shape

Default file: `config/pine-autoresearch.default.json`.

Important sections:

| Section | Role |
| --- | --- |
| `matrixId` | Artifact namespace under `pine/autoresearch/`. |
| `scriptPath` | Pine source of truth, normally `../pine/test.pine`. |
| `outputs.researchRoot` | Machine-readable state and manifests. |
| `outputs.digestRoot` | Human-readable reports. |
| `scoutProfiles` | `full` and `micro` budgets. |
| `primaryLab` | Main selection lab. |
| `shadowLabs` | Robustness labs. |
| `blindHoldoutLabs` | Validation-only labs. |
| `pinnedData` | Offline dataset/cache settings. |
| `searchPolicy` | Candidate generation behavior. |
| `matrixPolicy` | Promotion matrix requirements. |
| `expectancyPolicy` | Win-rate/expectancy safety gate. |
| `autoPromotion` | Queue, cooldown, and lineage guardrails. |
| `regimeExitResearch` | Optional regime/exit/global research feature. |

See [reference/schemas.md](./reference/schemas.md) for field inventory and [Pine regime-exit research](./pine-regime-exit-research.md) for the optional feature block.

## Search policy

Current default is incumbent-local search: mutate around the champion rather than broad random search.

Key controls:
- `exploitRatio`: share of candidates near the incumbent.
- `freezeArchitecture`: prevents unsafe architecture churn during routine search.
- `exploitFamilies`: families allowed in exploit mode.
- `exploreFamilies`: families allowed in exploratory fallback.
- `paretoShortlistSize`: number of primary sweep candidates retained before matrix evaluation.
- `matrixCandidateLimit`: number of candidates matrix-evaluated.
- `selfLoopEscape`: fallback when the loop keeps producing champion duplicates.
- `annealing`: increases mutation temperature during stagnation.

Regime-exit mode adds lane scheduling. See [Pine regime-exit research](./pine-regime-exit-research.md#research-lanes).

## Promotion gates

Promotion is intentionally slower than discovery. A high primary score is not enough.

Required gate families:

| Gate | Why it exists |
| --- | --- |
| Candidate changed | Blocks no-op champion re-promotions. |
| Primary promote | Candidate must beat the primary lab. |
| Shadow pass count/ratio | Candidate must survive enough robustness windows. |
| Expectancy | Prevents fake win-rate improvements with worse payoff asymmetry. |
| Drawdown/trade floors | Blocks fragile candidates. |
| Lineage anti-ping-pong | Prevents oscillation between near-identical families. |
| Promotion queue replay | Ensures the exact reviewed manifest is promoted. |

Default `matrixPolicy` requires primary promotion, minimum shadow pass count, minimum shadow pass ratio, and a changed candidate.

## Offline data model

Pinned datasets make research reproducible and avoid accidental online drift.

Primary workflow:

```bash
npm run pine:dataset:pin
npm run pine:dataset:stage
npm run pine:dataset:verify
```

Pinned data fields:
- `datasetsRoot`: stored dataset JSON artifacts.
- `cacheRoot`: materialized candle cache for Backtest Kit CLI.
- `exchangeName`: pinned runtime exchange namespace, usually `ccxt-exchange`.
- `sourceExchangeId`: source exchange for fetching, usually `binance`.
- `sourceMode`: `local-cache` or network-backed pinning mode.

Strict cycle behavior:
- preflight verifies every required lab has complete candle coverage
- incomplete data yields `offlineDataMissing` and a hold/skip result
- strict pinned/no-cache runs validate pinned cache before invoking Backtest Kit CLI
- local cache exchange mismatches must be fixed by staging/pinning, not by weakening gates

## Artifacts

Main roots:
- `pine/autoresearch/<matrixId>/` — machine state
- `report/pine-autoresearch/<matrixId>/` — human reports
- `pine/datasets/<matrixId>/` — pinned datasets
- `pine/dump/data/candle/` — materialized candle cache

Important files:
- `latest.json` — current manifest snapshot
- `manifests/<runId>.json` — canonical run manifest
- `champion.json` — current champion
- `history.jsonl` — append-only event log
- `state/promotion-queue.jsonl` — append-only queue
- `state/autoresearch.lock.json` — JS lock owner
- `latest-digest.md` — current digest

See [Artifacts and state](./artifacts-and-state.md) for lifecycle details.

## Manifest compactness

Manifests must be useful, reproducible, and bounded. They should contain summaries and artifact references, not raw row dumps.

Rules:
- include compact fields needed for promotion/replay
- omit heavy `analysis.rows`, full trade arrays, and raw diagnostic series
- keep `labResults` compact: lab, incumbent, challenger, decision
- keep `matrixCandidates` compact: challenger, matrix decision, robustness, expectancy
- regime-exit fields are emitted only when enabled
- raw marker strings such as `Feature_RawLongPrediction` must not persist in manifest JSON

Tests guard this compactness in `tests/pine-autoresearch.test.mjs`.

## Locks and queues

### JS canonical lock

The CLI acquires `state/autoresearch.lock.json` for cycle/promote/autopromote work. Stale reclaim requires both age and ownership checks.

### Scheduler wrapper lock

PowerShell scheduled-task wrappers have their own process lock. This prevents overlapping Windows task invocations before the JS process starts.

### Promotion queue

The queue is append-only JSONL. Readers replay all events to derive active pending item and statuses.

Queue invariants:
- pending promotion pauses normal cycles
- status events do not rewrite old items
- exact manifest/runId is preserved
- orphan statuses are retained for diagnosis
- force promotion must still respect explicit command intent

## Safety and rollback

Safe rollback options:

1. Disable automatic promotion:
   - set `autoPromotion.enabled=false`
2. Disable regime-exit research:
   - set `regimeExitResearch.enabled=false`
3. Stop scheduled tasks:
   - use ops remove script or Windows Task Scheduler
4. Promote a known older manifest:
   - use `promote --run-id <knownGoodRunId>`
5. Restore champion seed/config from git:
   - use normal git checkout/revert flow

Never bypass promotion gates by editing generated manifests. Fix config, data, or candidate generation instead.

## Normal operator runbook

### Daily status

```bash
npm run pine:dataset:verify
npm run pine:autoresearch:digest
```

Read:
- `report/pine-autoresearch/<matrixId>/latest-digest.md`
- `pine/autoresearch/<matrixId>/latest.json`

### Manual scout

```bash
npm run pine:dataset:verify
npm run pine:autoresearch:micro
npm run pine:autoresearch
```

### Manual promotion

```bash
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --run-id <runId>
```

### Promotion queue processing

```bash
npm run pine:autoresearch:autopromote
```

### Safe recovery

1. Check `git status --short`.
2. Check lock file age and owner.
3. Check queue state in `state/promotion-queue.jsonl`.
4. Run `npm run pine:dataset:verify`.
5. Run digest to confirm latest state.
6. Only then rerun cycle/promote.

## Troubleshooting quick map

| Symptom | Likely cause | First check |
| --- | --- | --- |
| `offlineDataMissing` | incomplete pinned dataset/cache | `npm run pine:dataset:verify` |
| no new cycle runs | pending promotion pause | promotion queue JSONL |
| lock stuck | live or stale owner | lock file + process owner |
| manifest too large | raw diagnostics leaked | compactness test / manifest JSON search |
| candidate near duplicate | exploit search saturated | scheduler stagnation state |
| promotion blocked despite good ROI | matrix/expectancy/lineage gate | `matrixDecision.gates` and digest |
| Backtest Kit exchange error | pinned cache/exchange mismatch | dataset stage + `pine-import-run-clean` args |

Detailed troubleshooting lives in [troubleshooting/pine-autoresearch.md](./troubleshooting/pine-autoresearch.md).

## Developer checklist

When changing autoresearch behavior:

- update tests first or alongside code
- update `docs/pine-autoresearch.md` for lifecycle changes
- update `docs/pine-regime-exit-research.md` for feature-lane changes
- update `docs/artifacts-and-state.md` for file lifecycle changes
- update `docs/reference/schemas.md` for config/manifest/queue fields
- run focused tests and `npm test`
- run `git diff --check`

## See also

- [Pine regime-exit research](./pine-regime-exit-research.md)
- [Artifacts and state](./artifacts-and-state.md)
- [Reference: schemas](./reference/schemas.md)
- [Reference: modules](./reference/modules.md)
- [Operations](./operations.md)
- [Pine tooling](./pine-tooling.md)
