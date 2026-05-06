# Schema reference

Operational field inventory only. Not a generated JSON Schema.

For current operator guides, also see:
- [Autoresearch config reference](./autoresearch-config.md)
- [Autoresearch artifacts reference](./autoresearch-artifacts.md)
- [Pine autoresearch](../pine-autoresearch.md)

## Lock owner (`researchRoot/state/autoresearch.lock.json`)

| Field | Meaning |
| --- | --- |
| `token` | unique lock token |
| `pid` | process id that owns the lock |
| `acquiredAt` | ISO timestamp when lock was written |
| `command` | `cycle`, `promote`, or `autopromote` |
| `profile` | selected profile name |
| `staleAfterMs` | stale-reclaim age threshold |
| `cwd` | working directory at acquisition time |

Notes:
- stale only when `acquiredAt` is old enough and PID is dead.
- reclaim guard file: `autoresearch.lock.json.reclaim`.

## Scheduler state (`researchRoot/state/scheduler/<matrixId>.json`)

| Field | Meaning |
| --- | --- |
| `activeTrackId` | current active track |
| `cycleIndex` | rotation cycle counter |
| `noChangeStreak` | cycles without candidate change |
| `noNewCandidateStreak` | cycles with no new candidate |
| `sameTrackCycleStreak` | consecutive cycles on same track |
| `lastNoveltySignature` | last novelty hash |
| `lastChampionFingerprint` | champion config fingerprint last seen |
| `lastCandidateFingerprint` | candidate config fingerprint last seen |
| `lastNoNewCandidateAt` | ISO timestamp of last no-new-candidate event |
| `lastRotationTrigger` | reason for last rotation |
| `lastPromotionEligibleAt` | ISO timestamp of last promotion-eligible cycle |
| `tabuRejectedFingerprints` | rolling tabu list of rejected config fingerprints |

## Dataset artifact (`datasetsRoot/<labId>.json`)

| Field | Meaning |
| --- | --- |
| `formatVersion` | file format version |
| `generatedAt` | ISO timestamp |
| `source` | usually `ccxt` |
| `exchangeName` | exchange label used for cache materialization |
| `exchangeId` | CCXT exchange id |
| `lab` | lab metadata |
| `candleCount` | number of candles |
| `window` | pinned window `{ stepMs, alignedWhenMs, sinceMs, untilMsExclusive }` |
| `candles[]` | sequential OHLCV rows |

`lab` fields:
- `labId`
- `symbol`
- `timeframe`
- `limit`
- `when`
- `exchange`
- `thresholds`

`candles[]` fields:
- `timestamp`
- `open`
- `high`
- `low`
- `close`
- `volume`

Materialization/validation helpers return:
- `materializePinnedCache()`: `exchangeName`, `writtenCount`, `candleCount`
- `validatePinnedCacheComplete()`: `complete`, `expectedCount`, `missingCount`, `missingTimestamps`

## Promotion queue (`researchRoot/state/promotion-queue.jsonl`)

### Pending event

| Field | Meaning |
| --- | --- |
| `type` | `pending` |
| `item` | queued item payload |
| `at` | ISO timestamp of event |

`item` fields:
- `itemId`
- `runId`
- `manifestPath`
- `candidateFingerprint`
- `championFingerprintAtDecision`
- `candidateConfigId`
- `championConfigIdAtDecision`
- `createdAt`

### Status event

| Field | Meaning |
| --- | --- |
| `type` | `status` |
| `itemId` | queued item id |
| `status` | `pending`, `blocked`, `failed`, `stale`, or `promoted` |
| `reason` | human-readable status reason |
| `appliedConfigId` | config id applied by promotion, if any |
| `at` | ISO timestamp (optional on write, filled on read) |

### Reduction output

`readPromotionQueue()` returns:
- `events`
- `items`
- `pending`
- `errors`
- `orphanStatuses`

Reduced item fields:
- `status`
- `statusAt`
- `reason`
- `appliedConfigId`

Replay rules:
- parse errors stay in `errors[]`
- status event before pending becomes `orphanStatuses[]`
- duplicate pending by `itemId` is ignored after first insert
- oldest pending wins in `selectNextPendingPromotion()`

## Promotion manifest

Top-level fields written by scout:
- `generatedAt`
- `matrixId`
- `runId`
- `profile`
- `primaryLab`
- `shadowLabs`
- `labTiers`
- `blindHoldoutLabs`
- `pinnedData`
- `incumbent`
- `champion`
- `challenger`
- `primarySweep`
- `searchPlan`
- `paretoShortlist`
- `matrixCandidates`
- `labResults`
- `matrixDecision`
- `expectancyPolicy`
- `expectancy`
- `researchState`
- `activeTrackId`
- `windowSetId`
- `noveltySignature`
- `rotationTrigger`
- `rotationReason`
- `sameTrackCycleStreak`
- `topCandidateSimilarity`
- `promotionEligible`
- `promotionEligibleReason`
- `noNewCandidate`
- `noNewCandidateStreak`
- `candidateFingerprint`
- `rejectedCandidateFingerprint`
- `championFingerprint`
- `labSetId`
- `gridName`

Regime-exit fields emitted only when `regimeExitResearch.enabled=true`:
- `researchBudgetMode`
- `resourceBudget`
- `resourceUsageSummary`
- `checkpointState`
- `objectiveBreakdown`
- `multipleTestingPenalty`
- `holdoutVerdict`
- `offlineDataSummary`
- `shadowRegimeScoreboard`

Compactness rule: manifest stores summaries, not full raw row/trade diagnostics. Heavy `analysis` payloads and raw diagnostic markers such as `Feature_RawLongPrediction` must not appear in serialized manifest JSON.

### `matrixDecision`

| Field | Meaning |
| --- | --- |
| `recommendation` | `promote` or `hold` |
| `summary` | operator summary |
| `gates` | gate booleans |
| `failedGates` | failed gate list |
| `counts` | lab counts |
| `policy` | effective matrix policy |

`counts` fields:
- `totalLabs`
- `shadowLabs`
- `allPassCount`
- `shadowPassCount`
- `shadowPassRatio`

`gates` fields:
- `candidateChanged`
- `primaryPromote`
- `shadowPassCount`
- `shadowPassRatio`

### `searchPlan`

| Field | Meaning |
| --- | --- |
| `mode` | search mode |
| `exploitRatio` | exploit/explore split |
| `variantCount` | number of generated variants |
| `variants[]` | variant records |

`variants[]` fields:
- `variantId`
- `lane`
- `family`
- `config`

### `researchState`

| Field | Meaning |
| --- | --- |
| `steadyState` | no changed candidate this cycle |
| `noChangeStreak` | trailing steady-state cycles |

### `expectancy`

| Field | Meaning |
| --- | --- |
| `champion` | champion expectancy inputs/result |
| `challenger` | challenger expectancy inputs/result |
| `delta` | challenger minus champion |
| `gate` | expectancy gate result |
| `wrDecompositionRequired` | warning flag when win-rate jump needs decomposition |
| `policy` | effective expectancy policy |

`expectancy.champion` / `expectancy.challenger` / `expectancy.delta` fields:
- `winRatePct`
- `avgWin`
- `avgLoss`
- `expectancy`

`gate` fields commonly observed:
- `passed`
- `recommendation`
- `summary`
- `failedGates`
- `champion`
- `challenger`
- `comparisons`
- `gates`
- `diagnostics`

## Regime / asymmetry artifact

`buildRegimeAnalysisArtifact()` returns:
- `matrixId`
- `runId`
- `sideMetrics`
- `regimeSlices`
- `asymmetry`
- `recommendation`
- `nextTrack`
- `evidence`
- `markdown`

`sideMetrics` buckets:
- `long`
- `short`

Each side bucket includes:
- `tradeCount`
- `winCount`
- `lossCount`
- `winRate`
- `avgWin`
- `avgLoss`
- `profitFactor`
- `mfePct`
- `maePct`
- `avgPnl`
- `totalPnl`

`regimeSlices` buckets can include legacy analysis buckets and regime-exit slice labels:
- `trend`
- `chop`
- `compression`
- `expansion`
- `high-vol`
- `low-vol`
- `long-favored`
- `short-favored`
- `totals`

`asymmetry` fields:
- `isAsymmetric`
- `recommendation`
- `nextTrack`
- `championSurface`
- `candidateSurface`
- `championGap`
- `candidateGap`
- `gapDelta`
- `championBias`
- `candidateBias`
- `flags`

`flags` fields:
- `hasEvidence`
- `sideSurfaceDiverged`
- `widened`
- `surfaceShifted`

## Metrics

From `calculateMetrics()`:
- `tradeCount`
- `winCount`
- `lossCount`
- `flatCount`
- `winRatePct`
- `roiPct`
- `avgReturnPct`
- `avgPnl`
- `avgWin`
- `avgLoss`
- `totalPnl`
- `totalProfit`
- `totalLossAbs`
- `totalProfitPct`
- `totalLossAbsPct`
- `profitFactor`
- `maxDrawdownPct`
- `metricBasis`

From `scoreMetricsBreakdown()`:
- `roi`
- `winRate`
- `profitFactor`
- `drawdown`
- `tradePenalty`
- `total`

`summaryResult()` keeps the operator-facing aliases:
- `configId`
- `score`
- `tradeCount`
- `roiPct`
- `winRatePct`
- `profitFactor`
- `maxDrawdownPct`
- `avgPnl`
- `avgWin`
- `avgLoss`
- `expectancy`

## Tuner / patch combo fields

`buildPatchPlan()` entries:
- `key`
- `value`
- `regex`
- `replace`

`selectSweepCombos()` returns plain combo objects from the grid.

`buildIncumbentSearchBatch()` / `buildTrackCandidateBatch()` variant fields:
- `variantId`
- `lane`
- `family`
- `temperature`
- `tabuSkipped`
- `config`

Track candidate metadata also includes:
- `patch`
- `sharedKeys`
- `ownKeys`
- `trackId` for self-loop fallback variants

`normalizeVariantRecords()` keeps:
- `variantId`
- `lane`
- `family`
- `config`

## Tests-first coverage map

- `tests/pine-autoresearch-lock.test.mjs`: lock owner, reclaim, release.
- `tests/pine-promotion-queue.test.mjs`: pending/status replay, errors, orphans, dedupe.
- `tests/pine-dataset.test.mjs`: dataset artifact, window, cache validation.
- `tests/pine-autoresearch.test.mjs`: manifest, matrixDecision, searchPlan, researchState, pruning, autopromote, regime-exit compatibility, manifest compactness.
- `tests/pine-regime-analysis.test.mjs`: regime slices and asymmetry artifact.
- `tests/pine-expectancy.test.mjs`: expectancy gate and diagnostics.
- `tests/pine-optimizer.test.mjs`: metrics and score breakdown.
- `tests/pine-tuner.test.mjs`: patch planning and candidate grids.
- `tests/pine-track-generators.test.mjs`: track batch metadata and tabu escape.
