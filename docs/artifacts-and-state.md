# Artifacts and state

Operational map for autoresearch outputs. Not a formal schema; the field inventory lives in `docs/reference/schemas.md`.

## Roots

- `config.outputs.researchRoot`: mutable run state, manifests, queue, lock, scheduler state.
- `config.outputs.digestRoot`: human-facing digests, scout notes, and regime analysis markdown.
- `ensureDirs()` creates:
  - `researchRoot/`
  - `researchRoot/manifests/`
  - `researchRoot/evaluations/`
  - `digestRoot/`

## Generated paths

| Path | Writer | Lifecycle | Notes |
| --- | --- | --- | --- |
| `researchRoot/latest.json` | scout run | overwritten | current manifest snapshot, plus exact `manifestPath` |
| `researchRoot/manifests/<runId>.json` | scout run | append-only by run id | canonical manifest for that scout cycle |
| `researchRoot/champion.json` | seed/promote | overwritten | current champion state |
| `researchRoot/history.jsonl` | scout/digest/promote/holdout | append-only | event log for digests and replay |
| `researchRoot/state/autoresearch.lock.json` | lock helper | exclusive | command/profile owner file |
| `researchRoot/state/autoresearch.lock.json.reclaim` | lock helper | transient | stale-reclaim guard |
| `researchRoot/state/promotion-queue.jsonl` | scout/autopromote | append-only | promotion replay queue |
| `researchRoot/state/scheduler/<matrixId>.json` | scout | overwritten | track rotation/tabu state |
| `researchRoot/<runId>-variants.json` | scout | run-scoped | search batch dump |
| `researchRoot/evaluations/<runId>/<labId>/` | matrix eval | run-scoped | patched Pine, flattened Pine, cleaned JSONL |
| `researchRoot/blind-holdouts/<runId>.json` | holdout run | run-scoped | post-promotion validation |
| `digestRoot/<runId>.md` | digest/scout | append-only by run id | timestamped digest |
| `digestRoot/latest-digest.md` | scout/digest/promote | overwritten | current digest |
| `digestRoot/history.md` | scout/promote | overwritten | history table |
| `digestRoot/analysis/<runId>-asymmetry.md` | scout | run-scoped | regime/asymmetry report |
| `digestRoot/<mode>-promote-<timestamp>.md` | promote/autopromote | run-scoped | human promotion note |
| `pine/sweeps/<runId>/` | sweep script | run-scoped then pruned | primary sweep output |

## Lifecycle

### Scout cycle
1. Load latest manifest or seed champion.
2. Load scheduler state and queue.
3. Build variants, run sweep, evaluate matrix.
4. Write `manifests/<runId>.json`.
5. Overwrite `latest.json` with the manifest plus `manifestPath`.
6. Append `pending` queue item when `matrixDecision.recommendation === 'promote'` and candidate/champion fingerprints differ.
7. Append cycle event to `history.jsonl`.
8. Overwrite scheduler state.
9. Write scout markdown, asymmetry markdown, and latest digest.
10. Prune old sweep/evaluation run dirs by retention policy.

### Digest
- Reads latest manifest, previous manifest, champion, and history.
- Writes `digestRoot/<digest-id>.md` and `digestRoot/latest-digest.md`.
- Digest content surfaces champion, challenger, matrix decision, track diagnostics, expectancy, search plan, Pareto shortlist, matrix summary, recent history, and recommendation.

### Promote / autopromote
- Manual promote patches `scriptPath`, writes `champion.json`, appends a promote event, rebuilds history markdown, and refreshes latest digest.
- Autopromote replays the queue, validates the queued manifest against current champion/policy, then promotes or writes a queue status event.

### Blind holdout
- Uses the latest promoted challenger against blind-holdout labs.
- Writes `blind-holdouts/<runId>.json` and appends a `blindHoldout` history event.

## Queue replay and failure behavior

- Queue file is JSONL, line-by-line replay.
- Malformed lines are captured in `errors[]` with `lineNumber` and parse reason.
- `pending` events are idempotent by `itemId`; first pending record wins.
- `status` events update a known item or become `orphanStatuses[]` when no pending item exists yet.
- Replayed pending items get normalized `status`, `statusAt`, `reason`, and `appliedConfigId` fields.
- `selectNextPendingPromotion()` returns the oldest pending item by `createdAt`, then `itemId`.
- `decideCycleStartAction()` skips a scout cycle while a pending promotion exists unless `--force-cycle` is set.
- Corrupt or concurrently-pruned manifests are ignored during rejected-fingerprint collection; the next scout can still proceed.

## Locking

- Lock owner file carries `token`, `pid`, `acquiredAt`, `command`, `profile`, `staleAfterMs`, and `cwd`.
- A lock is stale only when it is old enough and the PID is dead.
- Reclaim uses a sibling `.reclaim` guard file so two reclaimers do not delete the same lock.
- Release is token-checked twice before unlink.

## Config highlights

- `matrixId`, `scriptPath`, `outputs.researchRoot`, `outputs.digestRoot`.
- `searchPolicy`: `mode`, `exploitRatio`, `freezeArchitecture`, `exploitFamilies`, `exploreFamilies`, `paretoShortlistSize`, `matrixCandidateLimit`, `annealing`, `selfLoopEscape`.
- `matrixPolicy`: `requirePrimaryPromote`, `minShadowPassCount`, `minShadowPassRatio`, `requireCandidateChange`.
- `rotationPolicy`: `cooldownCyclesAfterPromote`, `maxCyclesPerTrack`, `noChangeStreakRotateAfter`, `noNoveltyRotateAfter`, `preferCurrentChampionUntil`.
- `autoPromotion`: `enabled`, `cooldownHours`, `maxPromotionsPerDay`, `requireMatrixPromotion`.
- `expectancyPolicy`: `enabled`, `wrJumpDiagnosticThreshold`, `rejectWrGainAvgWinLoss`, `requireExpectancyNonRegression`.
- `complexityPolicy`: `enabled`, `ignoreKeys`, score/ROI/PF penalty knobs.
- `pinnedData`: `enabled`, `datasetsRoot`, `cacheRoot`, `exchangeName`, `sourceExchangeId`, `sourceMode`.
- `windowPolicy`: `primary`, `shadow`, `rotating`, `minCoverage`, `maxAge`.
- `retention`: `keepLatestRuns`, `pruneSweepRuns`, `pruneEvaluationRuns`, `prunePartialRuns`.
- `researchTracks`: `trackId`, `name`, `gridName`, `variantMode`, `sourceFamily`, `windowSet`, `promotionPolicy`, `stopPolicy`.

## See also

- `docs/reference/schemas.md` for field-level inventory.
- `docs/pine-autoresearch.md` for the full cycle narrative.
