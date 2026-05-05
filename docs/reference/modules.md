# Reference: modules

Inventory of local code in `scripts/` and `scripts/lib/`. Behavior is tested in `tests/*.test.mjs`.

## Core autoresearch internals

| Module | Exports / responsibility | Tested by |
|---|---|---|
| `scripts/lib/pine-autoresearch-lock.mjs` | `defaultIsPidAlive`, `readAutoresearchLock`, `isLockStale`, `acquireAutoresearchLock`, `releaseAutoresearchLock` — exclusive JS lock file, stale detection, guarded release | `tests/pine-autoresearch-lock.test.mjs` |
| `scripts/lib/pine-autoresearch-tracks.mjs` | `normalizeResearchTracks`, `buildNoveltySignature`, `computeConfigSimilarity`, `summarizeTopCandidateSimilarity`, `resolveSchedulerStatePath`, `readSchedulerState`, `writeSchedulerState`, `defaultSchedulerState`, `selectActiveTrack`, `nextTrackState` — track state normalization and rotation | `tests/pine-autoresearch-tracks.test.mjs`, `tests/pine-track-generators.test.mjs` |
| `scripts/lib/pine-autoresearch.mjs` | `isoNow`, `timestampId`, `configFingerprint`, `sameConfig`, `computeParameterComplexityPenalty`, `computeSweepOffset`, `planArtifactPrune`, `readJson`, `writeJson`, `appendJsonl`, `writeText`, `readJsonl`, `buildParetoShortlist`, `selectRobustMatrixCandidate`, `summarizeResult`, `extractChampionBootstrapCandidate`, `selectChampionBootstrapSource`, `decideAutoresearchOutcome`, `decideMatrixPromotion`, `partitionLabs`, `decideAutoPromotionAction`, `renderScoutMarkdown`, `renderDigestMarkdown`, `renderHistoryMarkdown`, `summarizeDigestAnnouncement` — shared autoresearch helpers and renderers | `tests/pine-autoresearch.test.mjs` |

## Data, scoring, and search policy

| Module | Exports / responsibility | Tested by |
|---|---|---|
| `scripts/lib/pine-dataset.mjs` | `timeframeToMinutes`, `alignWhenToInterval`, `getPinnedWindow`, `expectedCandleTimestamps`, `datasetFilePath`, `cacheCandlePath`, `normalizeFetchedCandles`, `normalizeCacheCandle`, `validateSequentialCandles`, `fetchPinnedCandles`, `readPinnedCandlesFromCache`, `writePinnedDataset`, `readPinnedDataset`, `assertDatasetMatchesLab`, `materializePinnedCache`, `validatePinnedCacheComplete`, `stagePinnedDatasetForLab` — pinned dataset IO, cache materialization, validation | `tests/pine-dataset.test.mjs` |
| `scripts/lib/pine-expectancy.mjs` | `computeExpectancy`, `evaluateExpectancyGuard` — expectancy math and guard logic | `tests/pine-expectancy.test.mjs` |
| `scripts/lib/pine-optimizer.mjs` | `loadJsonlRows`, `inferTimeframeMinutes`, `normalizeRows`, `simulateTrades`, `calculateMetrics`, `scoreMetricsBreakdown`, `scoreMetrics`, `summarizeSignalDiagnostics`, `analyzeJsonlFile` — cleaned JSONL analysis, trade simulation, metrics, scoring | `tests/pine-optimizer.test.mjs`, `tests/pine-phase3.test.mjs` |
| `scripts/lib/pine-regime-analysis.mjs` | `summarizeSideMetrics`, `classifyRegimeFromFeatures`, `summarizeRegimeSlices`, `detectThresholdAsymmetry`, `buildRegimeAnalysisMarkdown`, `buildRegimeAnalysisArtifact` — regime slicing and artifact rendering | `tests/pine-regime-analysis.test.mjs` |
| `scripts/lib/pine-regime-exit-config.mjs` | `normalizeRegimeExitResearchConfig`, `isRegimeExitResearchEnabled` — normalizes regime-exit config block with backward-compatible aliases and defaults | `tests/pine-regime-exit-config.test.mjs`, `tests/pine-autoresearch.test.mjs` |
| `scripts/lib/pine-regime-slices.mjs` | `bucketByRegime`, `buildRegimeThresholdSummary`, `buildRegimeSlices`, `summarizeRegimeSlicesTable` — regime thresholds + slice-level cohort summaries for shadow analysis | `tests/pine-regime-slices.test.mjs`, `tests/pine-regime-exit-integration.test.mjs` |
| `scripts/lib/pine-exit-generators.mjs` | `buildExitFamilyCandidates`, `buildRegimeExitMutationSet` — regime-focused exit candidate generation lanes | `tests/pine-exit-generators.test.mjs`, `tests/pine-regime-exit-integration.test.mjs` |
| `scripts/lib/pine-global-search.mjs` | `buildGlobalMutationBatch`, `rankGlobalMutationCandidates` — controlled all-parameter mutation fallback lane | `tests/pine-global-search.test.mjs`, `tests/pine-regime-exit-integration.test.mjs` |
| `scripts/lib/pine-regime-exit-scheduler.mjs` | `allocateRegimeExitLaneBudget`, `selectNextResearchLane` — lane budget split and regime-exit scheduler routing | `tests/pine-regime-exit-scheduler.test.mjs`, `tests/pine-regime-exit-integration.test.mjs` |
| `scripts/lib/pine-search-policy.mjs` | `allocateLaneBudget`, `computeAnnealingState`, `buildIncumbentSearchBatch` — search lane budget and annealing policy | `tests/pine-tuner.test.mjs` |
| `scripts/lib/pine-track-generators.mjs` | `sharedKnobKeys`, `trackOwnKnobKeys`, `validateTrackPatch`, `buildTrackCandidateBatch` — candidate patch validation and batch generation | `tests/pine-track-generators.test.mjs` |
| `scripts/lib/pine-tuner.mjs` | `normalizeVariantRecords`, `sharedKnobKeys`, `trackOwnKnobKeys`, `cartesianProduct`, `filterSweepCombos`, `countSweepCombos`, `selectSweepCombos`, `buildPatchPlan`, `applyPatchPlan`, `configIdFromCombo`, `rankSweepResults`, `defaultCandidateGrid`, `focusedCandidateGrid`, `rootCauseCandidateGrid`, `profitCandidateGrid`, `exitTuningCandidateGrid`, `exitStateResearchCandidateGrid`, `exitStateTighteningCandidateGrid`, `exitStateTimeStopCandidateGrid`, `exitStatePartialDeriskCandidateGrid`, `exitStateContextCautionCandidateGrid`, `exitStatePostEntrySqueezeCandidateGrid`, `exitStateAdverseDivergenceCandidateGrid`, `exitStateCandidateGrid`, `asymmetryCandidateGrid`, `fusionSafeCandidateGrid`, `fusionV2CandidateGrid`, `fusionV3CandidateGrid`, `fusionV4CandidateGrid`, `squeezeContextCandidateGrid`, `divergenceContextCandidateGrid`, `phase3CoreCandidateGrid`, `getCandidateGrid`, `leaderboardMarkdown` — sweep grid generation, patch planning, ranking, leaderboard output | `tests/pine-tuner.test.mjs`, `tests/pine-phase3.test.mjs` |

## Promotion queue and ops glue

| Module | Exports / responsibility | Tested by |
|---|---|---|
| `scripts/lib/pine-promotion-queue.mjs` | `promotionQueuePath`, `buildPromotionQueueItem`, `appendPromotionQueueEvent`, `readPromotionQueue`, `selectNextPendingPromotion` — append-only promotion queue storage and reduction | `tests/pine-promotion-queue.test.mjs`, `tests/pine-autoresearch.test.mjs` |
| `scripts/pine-autoresearch.mjs` | `decideQueuedPromotionAction`, `canForceQueuedPromotion`, `resolveAutopromoteQueueStatus`, `autoresearchLockPath`, `shouldUseAutoresearchLock`, `formatAutoresearchLockSkip`, `mergeSchedulerTabuFingerprints`, `resolveTrackSelectionState`, `selectChangedMatrixCandidate`, `buildScoutOrchestrationState`, `buildScoutRegimeAnalysisArtifact`, `resolvePromotionManifestPath`, `selectPromotionManifestSource`, `withManifestPath`, `shouldQueuePromotionManifest`, `decideCycleStartAction`, `loadConfig` — CLI orchestration for cycle/digest/promote/autopromote | `tests/pine-autoresearch.test.mjs`, `tests/pine-track-generators.test.mjs` |
| `scripts/pine-dataset.mjs` | Thin CLI wrapper for `pin`, `stage`, `verify` dataset commands | `tests/pine-dataset.test.mjs` |
| `scripts/pine-import-run-clean.mjs` | Thin wrapper for import/run/clean pipeline | `tests/pine-phase3.test.mjs` |
| `scripts/pine-optimize.mjs` | Thin wrapper for optimizer entry points | `tests/pine-optimizer.test.mjs`, `tests/pine-phase3.test.mjs` |
| `scripts/pine-sweep.mjs` | Thin wrapper for sweep entry point | `tests/pine-tuner.test.mjs`, `tests/pine-phase3.test.mjs` |
| `scripts/fetch_docs.mjs` | Refreshes generated library docs from upstream sources | no dedicated unit test |
| `scripts/flatten-pine-imports.mjs` | Flattens Pine imports for local research workflow | no dedicated unit test |
| `scripts/fixed-window-revalidate.mjs` | Utility for fixed-window revalidation workflow | no dedicated unit test |
| `scripts/fusion-v3-benchmark.mjs` | Benchmark runner for fusion v3 research | no dedicated unit test |
| `scripts/fusion-v3-hi-benchmark.mjs` | High-intensity benchmark runner for fusion v3 research | no dedicated unit test |
| `scripts/fusion-v4-benchmark.mjs` | Benchmark runner for fusion v4 research | no dedicated unit test |

## Ops scripts

PowerShell wrappers under `scripts/ops/` are the scheduler-facing shell layer:

- `install-pine-autoresearch-tasks.ps1`
- `remove-pine-autoresearch-tasks.ps1`
- `pine-autoresearch-run.ps1`
- `pine-autoresearch-micro.ps1`
- `pine-autoresearch-full.ps1`
- `pine-autoresearch-digest.ps1`
- `pine-autoresearch-autopromote.ps1`

They wrap the CLI entry points above and add scheduler lock / task-scheduler behavior. Their behavior is covered indirectly through the autoresearch and queue tests; there is no dedicated `tests/*.test.mjs` file for the PowerShell layer.

## Safe extension rules

- Keep wrappers thin; put logic in `scripts/lib/*.mjs`.
- If a module changes behavior, update the matching test file first.
- If a new export affects promotion, queue, or lock behavior, update `tests/pine-autoresearch.test.mjs`, `tests/pine-promotion-queue.test.mjs`, or `tests/pine-autoresearch-lock.test.mjs` as appropriate.
- If a new CLI surface is added, update `docs/cli-reference.md` and `docs/development.md` together.
- If a new artifact field is added, update `docs/reference/schemas.md` and the relevant behavior tests.

## Quick lookup

- Locking: `scripts/lib/pine-autoresearch-lock.mjs`
- Track state: `scripts/lib/pine-autoresearch-tracks.mjs`
- Autoresearch core: `scripts/lib/pine-autoresearch.mjs`
- Dataset and cache: `scripts/lib/pine-dataset.mjs`
- Expectancy: `scripts/lib/pine-expectancy.mjs`
- Optimizer: `scripts/lib/pine-optimizer.mjs`
- Promotion queue: `scripts/lib/pine-promotion-queue.mjs`
- Regime analysis: `scripts/lib/pine-regime-analysis.mjs`
- Search policy: `scripts/lib/pine-search-policy.mjs`
- Track generators: `scripts/lib/pine-track-generators.mjs`
- Tuner: `scripts/lib/pine-tuner.mjs`