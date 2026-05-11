# Graph Report - .  (2026-05-11)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1104 nodes · 2530 edges · 53 communities (52 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c41dec7d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `number()` - 57 edges
2. `runScout()` - 54 edges
3. `main()` - 47 edges
4. `runLlmAutoresearch()` - 39 edges
5. `isPlainObject()` - 27 edges
6. `round()` - 23 edges
7. `getCandidateGrid()` - 22 edges
8. `runPromote()` - 21 edges
9. `buildTrackCandidateBatch()` - 20 edges
10. `analyzeJsonlFile()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `variantStoredFingerprints()` --calls--> `number()`  [INFERRED]
  tests/pine-autoresearch-production-invariants.test.mjs → scripts/lib/pine-objective-function.mjs
- `buildGlobalAllParameterScoutManifest()` --calls--> `buildScoutOrchestrationState()`  [EXTRACTED]
  tests/pine-autoresearch.test.mjs → scripts/pine-autoresearch.mjs
- `rootsFromConfig()` --calls--> `resolveMaybeRelative()`  [EXTRACTED]
  tests/pine-autoresearch-production-invariants.test.mjs → scripts/pine-dataset.mjs
- `validateProductionArtifactInvariants()` --calls--> `validateLatestManifestPointer()`  [EXTRACTED]
  tests/pine-autoresearch-production-invariants.test.mjs → scripts/lib/pine-autoresearch-artifacts.mjs
- `acquireAutoresearchLock()` --calls--> `unlinkLock()`  [INFERRED]
  scripts/lib/pine-autoresearch-lock.mjs → tests/pine-autoresearch-lock.test.mjs

## Communities (53 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (124): evaluateProfitabilityFloor(), finiteNumberOrNull(), buildQualityFeedbackPrompt(), safeCandidatePreview(), REVIEW_RESOLUTION_STATUSES, Invoke-LoggedCommand(), Stop-ProcessTree(), DEFAULT_REGIME_EXIT_STATE (+116 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (54): normalizeTimeoutMs(), postOpenAiJson(), readOptionalEnv(), redact(), resolveOpenAiAuth(), buildChatCompletionsRequest(), buildResponsesRequest(), extractChatCompletionsText() (+46 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (47): pineSource, signalOutput, alignWhenToInterval(), assertDatasetMatchesLab(), cacheCandlePath(), datasetFilePath(), exchangeCache, expectedCandleTimestamps() (+39 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (45): buildOfflineDataPlan(), compactMissingLab(), summarizeOfflineDataPlan(), buildRegimeAnalysisArtifact(), buildRegimeAnalysisMarkdown(), classifyRegimeFromFeatures(), detectThresholdAsymmetry(), extractThresholdSurface() (+37 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (38): computeParameterComplexityPenalty(), decideAutoresearchOutcome(), isActivatedValue(), summarizeProfitabilityFloorFailure(), computeExpectancy(), evaluateExpectancyGuard(), normalizeWinRate(), analyzeJsonlFile() (+30 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (46): asNumber(), decideLineagePromotionGate(), detectPingPongRisk(), appendReviewQueueEvent(), applyStatus(), buildItemFromInput(), buildReviewQueueItem(), markStaleReviewItems() (+38 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (34): asymmetryCandidateGrid(), AVWAP_CONTEXT_KEYS, buildPhase3CoreVariants(), CHANNEL_CONTEXT_KEYS, CONTEXT_AGGREGATOR_KEYS, CONTEXT_EXIT_SHAPING_KEYS, defaultCandidateGrid(), DIVERGENCE_CONTEXT_KEYS (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (35): decideAutoPromotionAction(), summarizePromotionLineage(), appendLlmLedgerEvent(), readLlmLedger(), summarizeLlmLedgerFingerprints(), finalizeReservation(), isDuplicateCandidate(), readActiveReservations() (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (27): applyPatchPlan(), leaderboardMarkdown(), normalizeVariantRecords(), rankSweepResults(), LIBRARY_LIST, main(), OUT_DIR, compactName() (+19 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (32): computeSweepOffset(), planArtifactPrune(), applySchedulerStateToManifest(), buildGlobalAllParameterExhaustedManifest(), buildGlobalAllParameterExhaustedSchedulerManifestInput(), buildOfflineDataMissingSkipResult(), buildRunId(), collectRecentRejectedCandidateFingerprints() (+24 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (29): normalizeResearchTracks(), selectActiveTrack(), resolveTrackSelectionState(), maxCycle, novelty, { activeTrackSelectionState }, assertTrackBatch(), baseline (+21 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (27): buildPatchPlan(), configIdFromCombo(), flattenedPath, rawPath, signalsPath, confirmFamilies, penaltyBand, thresholdBand (+19 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (26): appendCheckpointEvent(), buildCheckpointKey(), CHECKPOINT_KEY_FIELDS, createCheckpointState(), readCheckpointState(), selectIncompleteStages(), aliasRegex, cleaned (+18 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (27): appendJsonl(), extractChampionBootstrapCandidate(), readJson(), renderHistoryMarkdown(), selectChampionBootstrapSource(), appendDigestWarnings(), appendOfflineDataMissingEvent(), buildAutoresearchArtifactWarnings() (+19 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (25): BLOCKED_EXIT_FAMILIES, buildExitFamilyCandidates(), EXIT_SURFACE_FAMILIES, normalizeBase(), prioritizeFirstPassByAxis(), SUPPORTED_EXIT_PATCH_KEYS, SUPPORTED_KEYS, SURFACE_SPEC_BY_KEY (+17 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (24): autoresearchManifestPath(), beginAutoresearchRunArtifact(), finalizeAutoresearchManifest(), isSafeAutoresearchRunId(), markAutoresearchRunIncomplete(), markAutoresearchRunIncompleteUnlessManifestExists(), repairOrphanEvaluationRuns(), validateLatestManifestPointer() (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (26): canonicalPatch(), ARCHITECTURE_BOOLEAN_KEYS, buildCandidateId(), buildChampionConfigFingerprint(), buildGlobalMutationBatch(), buildGlobalPatchFingerprint(), buildLegacyGlobalPatchFingerprint(), canonicalGlobalLane() (+18 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (21): allocateRegimeExitLaneBudget(), DEFAULT_RATIOS, LANE_KEYS, normalizeBudgetDebt(), resolveExhaustedResearchLanes(), selectNextResearchLane(), STAGNATION_LANE_METADATA, buildRegimeAwareSearchBatch() (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (21): findOrphanEvaluationRuns(), writeJson(), writeText(), codes, configuredProductionRoots(), fileContains(), hasProductionArtifactEvidence(), latestHistoryEventForRun() (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (22): buildFullPromptPayload(), buildHardRules(), buildOverflowPromptPayload(), buildPromptResult(), buildRequiredOutput(), buildResearchContext(), cloneArray(), promptByteLength() (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (20): buildParetoShortlist(), decideMatrixPromotion(), isoNow(), appendInvalidResponse(), byteBoundedPreview(), byteLengthText(), sha256Text(), writeManifest() (+12 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (19): cartesianProduct(), countSweepCombos(), deleteKeys(), explicitVariantCombos(), filterSweepCombos(), patchableParameterKeys(), selectSweepCombos(), batch (+11 more)

### Community 22 - "Community 22"
Cohesion: 0.27
Nodes (18): applyPatch(), asymmetryPatches(), buildMetadata(), buildTrackCandidateBatch(), divergencePatches(), exitStatePatches(), extractPatchObject(), getFallbackPatchPool() (+10 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (16): PARAMETER_SURFACE_CATALOG, sourceConfig(), ARCHITECTURE_KEYS, buildParameterLadder(), buildSurfaceMutationCandidates(), FAMILY_PRIORITY, familyCandidates(), mutationValuesForSpec() (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.28
Nodes (16): buildCandidateFamilyKey(), stableValue(), buildNoveltySignature(), computeConfigSimilarity(), defaultSchedulerState(), nextTrackState(), normalizeLaneExhaustions(), normalizeNonNegativeInteger() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (16): championConfig, championConfigFingerprint, fingerprints, patch, patchFingerprint, authoritativePatchFingerprint, expectedPatchFingerprint, newCandidate (+8 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (14): resolveSchedulerStatePath(), baseTracks, blockedPromotionFingerprints, bounded, changedCandidate, malformed, maxCycleRotated, nextBucketEdge (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (9): DISALLOWED_DEPENDENCY_PATTERNS, EXCLUDED_PATH_SEGMENTS, offenders, relativePaths, RELEVANT_FILE_NAME_PATTERNS, scriptsRoot, configDir, repoRoot (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.3
Nodes (14): buildLanePatchFingerprint(), canonicalGeneratedLane(), championFingerprint(), collectTestedLanePatchFingerprints(), configVerifiedPatch(), filterNovelLaneCandidates(), manifestChampionFingerprint(), manifestHasChampionConfig() (+6 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (13): acquireAutoresearchLock(), buildOwner(), defaultIsPidAlive(), getOwnerSnapshot(), isLockStale(), openExclusiveHandle(), releaseAutoresearchLock(), sameOwnerSnapshot() (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (12): configFingerprint(), allocateLaneBudget(), buildIncumbentSearchBatch(), computeAnnealingState(), countCycles(), freezeArchitecture(), normalizeTabuCache(), pickNonTabuVariant() (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (12): championConfigIdentity(), collectTestedGlobalPatchFingerprints(), isGlobalAllParameterLane(), manifestChampionConfigIdentity(), patchesEqual(), reconstructGlobalPatchFingerprint(), reconstructPatchFromVariantConfig(), variantChampionConfigIdentity() (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.24
Nodes (3): normalizeMinInt(), runEvaluationWorker(), workerPath

### Community 33 - "Community 33"
Cohesion: 0.39
Nodes (8): appendExpectancyDiagnostics(), appendTrackDiagnostics(), findBestAlternative(), isSteadyStateCandidate(), renderDigestMarkdown(), renderLabRowTable(), renderScoutMarkdown(), summarizeDigestAnnouncement()

### Community 34 - "Community 34"
Cohesion: 0.46
Nodes (6): clamp(), finiteNumber(), normalizeLaneRatios(), normalizePromotion(), normalizeRegimeExitResearchConfig(), cases

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (7): changedParamKeys(), isHigherThanChampion(), isLowerThanChampion(), scoreCandidateQuality(), scorePenalty(), textIncludesAny(), toFiniteNumber()

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (6): candidateFile, digest, evaluationManifest, fixture(), openAiFixture(), manifest

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (5): classifyPromotionHoldReason(), isForceablePromotionStatus(), PROMOTION_STATUS, canForceQueuedPromotion(), decideQueuedPromotionAction()

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (5): Acquire-SchedulerLock(), Get-SchedulerLockPayload(), Test-ProcessAlive(), Test-ProcessOwnsLock(), Test-SchedulerLockStale()

### Community 39 - "Community 39"
Cohesion: 0.47
Nodes (6): buildLlmChallengerSummary(), executeLlmMatrixCandidate(), shouldEnqueueLlmCandidate(), summarizeLlmLabResultForManifest(), summarizeLlmMatrixDelta(), writeLlmEvaluationManifest()

### Community 40 - "Community 40"
Cohesion: 0.6
Nodes (5): evaluateConfigOnLab(), resolveEffectiveRuntimeExchange(), runPrimarySweep(), stagePinnedData(), runNode()

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (3): buildLlmLaneNamespace(), buildLlmLanePaths(), normalizeMatrixId()

## Knowledge Gaps
- **323 isolated node(s):** `pineSource`, `signalOutput`, `LIBRARY_LIST`, `OUT_DIR`, `DEFAULT_CONFIGS` (+318 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `number()` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 8`, `Community 9`, `Community 14`, `Community 16`, `Community 17`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 30`, `Community 31`, `Community 34`, `Community 35`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `main()` connect `Community 8` to `Community 0`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 40`, `Community 11`, `Community 13`, `Community 20`, `Community 21`, `Community 29`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `round()` connect `Community 4` to `Community 0`, `Community 33`, `Community 3`, `Community 39`, `Community 20`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 53 inferred relationships involving `number()` (e.g. with `main()` and `buildRegimeAwareSearchBatch()`) actually correct?**
  _`number()` has 53 INFERRED edges - model-reasoned connections that need verification._
- **What connects `pineSource`, `signalOutput`, `LIBRARY_LIST` to the rest of the system?**
  _323 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._