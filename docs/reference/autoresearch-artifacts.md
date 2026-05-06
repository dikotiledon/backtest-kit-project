# Autoresearch artifacts reference

Field and lifecycle guide for Pine autoresearch artifacts.

For the high-level workflow, see [Pine autoresearch](../pine-autoresearch.md). For generated paths, see [Artifacts and state](../artifacts-and-state.md).

## Roots

Default roots are configured in `config/pine-autoresearch.default.json`:

| Root | Default | Purpose |
| --- | --- | --- |
| `researchRoot` | `../pine/autoresearch/pine-fusion-v4-core-15m-locked-window` | machine-readable state |
| `digestRoot` | `../report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window` | human-readable reports |
| `datasetsRoot` | `../pine/datasets/pine-fusion-v4-core-15m-locked-window` | pinned dataset JSON |
| `cacheRoot` | `../pine/dump/data/candle` | materialized candle cache |

## Core files

| Path | Lifecycle | Purpose |
| --- | --- | --- |
| `latest.json` | overwritten every scout | current manifest pointer/snapshot |
| `manifests/<runId>.json` | append by run id | canonical scout manifest |
| `champion.json` | overwritten on seed/promote | current accepted champion |
| `history.jsonl` | append-only | cycle/digest/promote/holdout events |
| `state/promotion-queue.jsonl` | append-only | promotion queue and status replay |
| `state/autoresearch.lock.json` | transient | JS lock owner |
| `state/scheduler/<matrixId>.json` | overwritten | track/stagnation state |
| `evaluations/<runId>/<labId>/` | run-scoped | patched Pine and lab outputs |
| `blind-holdouts/<runId>.json` | run-scoped | validation result |
| `latest-digest.md` | overwritten | human current summary |
| `history.md` | overwritten | human history table |
| `analysis/<runId>-asymmetry.md` | run-scoped | regime/asymmetry analysis |

## Manifest top-level fields

Scout writes a compact manifest. Common fields:

| Field | Meaning |
| --- | --- |
| `generatedAt` | ISO generation time. |
| `matrixId` | Research namespace. |
| `runId` | Unique run id. |
| `profile` | Scout profile used. |
| `primaryLab` | Primary lab config snapshot. |
| `shadowLabs` | Shadow lab config snapshots. |
| `labTiers` | Training/selection/blind holdout lab id grouping. |
| `blindHoldoutLabs` | Blind holdout config snapshots. |
| `pinnedData` | Pinned dataset/cache config snapshot. |
| `incumbent` / `champion` | Champion summary. |
| `challenger` | Selected challenger summary. |
| `primarySweep` | Primary sweep summary. |
| `searchPlan` | Search mode, budget, and compact variant list. |
| `paretoShortlist` | Primary shortlist. |
| `matrixCandidates` | Compact evaluated candidate summaries. |
| `labResults` | Compact lab decision summaries. |
| `matrixDecision` | Overall decision and gates. |
| `expectancyPolicy` | Policy snapshot. |
| `expectancy` | Champion/challenger expectancy and delta. |
| `researchState` | steady/no-change state. |
| `activeTrackId` | Active track id, if track scheduler used. |
| `windowSetId` | Window/lab-set id. |
| `noveltySignature` | Novelty signature for scheduler. |
| `rotationTrigger` / `rotationReason` | Track rotation diagnostics. |
| `sameTrackCycleStreak` | Consecutive same-track cycles. |
| `topCandidateSimilarity` | Similarity of best non-champion candidate. |
| `promotionEligible` | Whether promotion is eligible. |
| `promotionEligibleReason` | Human-readable gate summary. |
| `noNewCandidate` | Whether candidate equals champion/no new candidate. |
| `noNewCandidateStreak` | Consecutive no-new-candidate count. |
| `candidateFingerprint` | Candidate config fingerprint. |
| `rejectedCandidateFingerprint` | Rejected candidate fingerprint, if any. |
| `championFingerprint` | Champion config fingerprint. |
| `labSetId` | Lab set id. |
| `gridName` | Candidate grid name. |

## Regime-exit manifest fields

Only emitted when `regimeExitResearch.enabled=true`.

| Field | Meaning |
| --- | --- |
| `researchBudgetMode` | Active research mode. |
| `resourceBudget` | Configured resource limits. |
| `resourceUsageSummary` | Compact resource/runtime summary. |
| `checkpointState` | Resume/checkpoint summary. |
| `objectiveBreakdown` | Objective/gate thresholds. |
| `multipleTestingPenalty` | Broad-search penalty summary. |
| `holdoutVerdict` | Blind holdout result summary. |
| `offlineDataSummary` | Offline preflight result. |
| `shadowRegimeScoreboard` | Compact lane/regime scoreboard. |

## Compactness rules

Manifests must stay bounded and reviewable.

Allowed:
- summary metrics
- compact gate decisions
- config snapshots needed for reproduction
- artifact paths/references
- fingerprints
- budget summaries

Not allowed:
- full raw JSONL rows
- full trade arrays from every analysis
- raw Pine diagnostic series
- large duplicated lab analyses
- raw marker strings such as `Feature_RawLongPrediction`

Tests enforce that heavy `analysis` is omitted from `manifest.labResults` and raw diagnostic markers do not appear in serialized manifest JSON.

## `searchPlan`

| Field | Meaning |
| --- | --- |
| `mode` | Search policy mode. |
| `exploitRatio` | Local exploit share. |
| `variantCount` | Candidate count generated. |
| `variants` | Compact list: `variantId`, `lane`, `family`, `config`. |

## `matrixCandidates`

Each item is compact:

| Field | Meaning |
| --- | --- |
| `challenger` | Candidate summary/config. |
| `matrixDecision` | Decision for candidate. |
| `robustness` | Robustness summary. |
| `expectancy` | Expectancy summary, if present. |

Heavy `labResults[].analysis` is intentionally not persisted here.

## `labResults`

Each item is compact:

| Field | Meaning |
| --- | --- |
| `lab` | Lab identity/config. |
| `incumbent` | Incumbent metrics summary. |
| `challenger` | Challenger metrics summary. |
| `decision` | Lab decision/gates. |

## `matrixDecision`

Common fields:

| Field | Meaning |
| --- | --- |
| `recommendation` | `promote` or `hold`. |
| `summary` | Human-readable decision. |
| `gates` | Gate booleans and counts. |
| `shadowPassCount` | Number of shadow labs passed. |
| `shadowPassRatio` | Shadow pass ratio. |
| `failedGates` | Failed gate names. |

## Promotion queue item

Queued item fields:

| Field | Meaning |
| --- | --- |
| `type` | `pendingPromotion`. |
| `itemId` | Unique queue item id. |
| `runId` | Manifest run id. |
| `manifestPath` | Exact manifest path. |
| `candidateConfigId` | Candidate config id. |
| `candidateFingerprint` | Candidate fingerprint at decision time. |
| `championConfigIdAtDecision` | Champion id when queued. |
| `championFingerprintAtDecision` | Champion fingerprint when queued. |
| `matrixDecision` | Decision snapshot. |
| `createdAt` | ISO timestamp. |

## Promotion queue status

Status event fields:

| Field | Meaning |
| --- | --- |
| `type` | `status`. |
| `itemId` | Queue item id. |
| `status` | `pending`, `blocked`, `failed`, `stale`, or `promoted`. |
| `reason` | Human-readable reason. |
| `appliedConfigId` | Config id applied by promotion. |
| `at` | ISO timestamp. |

Readers replay all queue events. Old entries are not rewritten.

## History events

`history.jsonl` is append-only. Common event types:

| Type | Meaning |
| --- | --- |
| `cycle` | Scout/cycle result. |
| `digest` | Digest render event. |
| `promote` | Manual promotion. |
| `autopromote` | Queue promotion attempt/result. |
| `holdout` | Blind holdout run. |

History is used for digest, cooldown, daily cap, lineage lookback, and stagnation summaries.

## Dataset artifact

Pinned dataset JSON contains:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Dataset format version. |
| `generatedAt` | ISO creation timestamp. |
| `source` | `ccxt`, `local-cache`, or equivalent source. |
| `exchangeName` | Runtime/cache exchange namespace. |
| `exchangeId` | Source exchange id. |
| `lab` | Lab snapshot. |
| `candles` | Candle rows for the lab window. |

Materialization and validation helpers return:
- `materializePinnedCache()`: `exchangeName`, `writtenCount`, `candleCount`
- `validatePinnedCacheComplete()`: `complete`, `expectedCount`, `missingCount`, `missingTimestamps`

## Lock owner

`state/autoresearch.lock.json` fields:

| Field | Meaning |
| --- | --- |
| `token` | Unique lock token. |
| `pid` | Owning process id. |
| `acquiredAt` | ISO acquisition timestamp. |
| `command` | `cycle`, `promote`, or `autopromote`. |
| `profile` | Selected profile. |
| `staleAfterMs` | Stale threshold. |
| `cwd` | Working directory. |

Stale reclaim must verify age and process ownership/PID reuse.

## Retention and cleanup

Autoresearch prunes run-scoped artifacts, not canonical state.

Safe to prune by policy:
- old `pine/sweeps/<runId>/`
- old `researchRoot/evaluations/<runId>/`
- old failed run outputs

Do not manually delete without intent:
- `champion.json`
- `history.jsonl`
- `state/promotion-queue.jsonl`
- manifest for queued promotion
- pinned datasets needed for reproducibility

## See also

- [Pine autoresearch](../pine-autoresearch.md)
- [Artifacts and state](../artifacts-and-state.md)
- [Schema reference](./schemas.md)
- [Autoresearch config reference](./autoresearch-config.md)
