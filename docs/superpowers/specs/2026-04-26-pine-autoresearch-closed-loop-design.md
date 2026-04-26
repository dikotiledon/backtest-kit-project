# Pine Autoresearch Closed-Loop Scheduler Design

## Status
Draft

## Goal
Upgrade the current Pine autoresearch scheduler from a static sweep runner into a bounded closed-loop research system that can:
- generate research candidates from explicit tracks
- evaluate them across primary and shadow labs
- detect saturation and novelty reuse
- rotate tracks/windows instead of repeating the same matrix
- promote only when strict gates pass

This design keeps the existing scheduler structure, manifests, digests, and promotion flow, but changes how candidate batches are planned and how repetition is handled.

## Non-goals
- No fully autonomous free-form agent that invents arbitrary new knobs.
- No unbounded Cartesian expansion of parameters.
- No change to the Pine strategy itself in this document.
- No removal of current report/artifact flow.

## Current State
The repository already has:
- `scripts/pine-autoresearch.mjs` as the main orchestration entry point
- `scripts/lib/pine-autoresearch.mjs` for manifest/digest/promotion logic
- `scripts/lib/pine-search-policy.mjs` for exploit/explore batching
- `scripts/lib/pine-tuner.mjs` for grid definitions and patching
- scheduled task wrappers for micro/full/digest/autopromote
- pinned primary + shadow lab support and matrix promotion gating

Current weakness:
- the loop can remain honest but saturated
- repeated cycles can rediscover the same champion on the same window set
- micro/full tasks are mostly fixed semantics instead of track-aware research phases
- the Pine squeeze/divergence logic is already integrated inline in `pine/test.pine`; the standalone files under `pine/to-be-implement` are mirrors/reference copies, not the runtime source of truth

## Design Summary
The scheduler becomes a four-stage pipeline:
1. **Plan** — select an active research track and build a bounded candidate batch.
2. **Evaluate** — run the batch on the primary lab, then shadow labs, then matrix gating.
3. **Promote** — update champion only when all required gates pass.
4. **Digest** — write human-readable state, streaks, and next-action summaries.

The key addition is a small **track registry** and **rotation policy** that let the loop move between families/windows instead of repeatedly sweeping the same space.

## Architecture

### 1) Control Plane
Keep `scripts/pine-autoresearch.mjs` as the single orchestration entry point.

Add explicit runtime phases:
- `plan`
- `evaluate`
- `promote`
- `digest`

These phases do not require separate binaries. They are logical steps inside the same runner.

### 2) Track Registry
Add a config-driven registry of research tracks.

Each track defines:
- `trackId`
- `name`
- `sourceFamily`
- `gridName`
- `variantMode` (`grid` or `explicit`)
- `windowSetId`
- `enabled`
- `promotionPolicy`
- `stopPolicy`

Recommended initial tracks:
- `squeeze-context`
- `divergence-context`
- `fusion-risk`
- `exit-tightening`

Tracks are bounded research lanes, not open-ended feature generators.

### 3) Scheduler State
Add a lightweight persisted state object, written alongside manifests and reloaded on startup.

State fields:
- `activeTrackId`
- `cycleIndex`
- `familyCursor`
- `noChangeStreak`
- `lastPromotedConfigId`
- `lastNoveltySignature`
- `lastRotationTrigger`

This state is derived from history, but stored explicitly so the scheduler can resume without guessing.

### 4) Evaluation Topology
Preserve the current lab model:
- **primary lab** = main selection gate
- **shadow labs** = robustness gate
- **matrix decision** = final promote/hold gate

No change to the promotion topology. The change is in what candidate set reaches it.

### 5) Promotion Topology
Promotion remains strict.

A candidate can only promote when:
- the candidate differs from the incumbent
- the primary lab recommends promote
- shadow pass count / ratio meet policy
- cooldown passes
- daily quota passes
- matrix promotion is enabled and passes

No soft override is allowed for steady-state runs.

## Data Flow
1. Select `activeTrackId`.
2. Load track definition.
3. Build candidate batch from the track’s grid or explicit variants.
4. Apply family pruning and dependent-knob pruning.
5. Run primary sweep and write leaderboard artifacts.
6. Pick primary challenger.
7. Run shadow labs and matrix decision.
8. Write manifest, digest, history, champion state.
9. Promote only if all gates pass.
10. Update `noChangeStreak`, novelty signature, and rotation state.

## Rotation Logic
The scheduler must not stall on a repeated family or window.

### Rotation Triggers
Rotate when any of these holds:
- `noChangeStreak >= threshold`
- novelty signature repeats with unchanged champion
- same track fails repeatedly on the same lab set
- champion remains unchanged for multiple cycles and no meaningful alternate appears

### Rotation Actions
When a trigger fires, the scheduler may:
- move to a neighboring family
- switch to another track
- switch window set
- reduce exploit share / increase explore share
- enter a cooldown / steady-state mode

### Rotation Order
Preferred order:
1. exploit current best family
2. explore neighboring family
3. switch track
4. switch window set
5. cool down or pause the track

## Config Design
Extend `config/pine-autoresearch.default.json` with these top-level blocks:
- `researchTracks`
- `rotationPolicy`
- `noveltyPolicy`
- `windowPolicy`
- `gatePolicy`

### Track Config
Each track should contain:
- `trackId`
- `name`
- `sourceFamily`
- `gridName`
- `variantMode`
- `windowSetId`
- `enabled`
- `promotionPolicy`
- `stopPolicy`

### Rotation Policy
Recommended knobs:
- `noChangeStreakRotateAfter`
- `noNoveltyRotateAfter`
- `maxCyclesPerTrack`
- `preferCurrentChampionUntil`
- `cooldownCyclesAfterPromote`

### Window Policy
Recommended fields:
- `primary`
- `shadow`
- `rotating`
- `minCoverage`
- `maxAge`

The scheduler must know whether a cycle reuses the same window set or introduces a new one.

### Novelty Policy
Novelty signature should include:
- `trackId`
- `gridName`
- `candidateFingerprint`
- `windowSetId`
- `labSetId`

If the novelty signature repeats and the champion does not change, the run is steady-state validation, not new research.

### Gate Policy
Keep the current strict gates and allow optional stricter track-level constraints.

Required gates:
- candidate changed
- primary promote
- shadow pass count
- shadow pass ratio
- cooldown
- daily quota
- matrix promotion

Optional gates:
- minimum score delta
- minimum ROI delta
- minimum profit factor delta
- maximum drawdown ceiling
- minimum trade floor
- minimum trade ratio versus incumbent

Track-level gates may be stricter than the global gates, never weaker.

## Artifacts
Keep current artifact names, but extend manifests with track and rotation metadata.

### Existing artifacts
- `latest.json`
- `champion.json`
- `history.jsonl`
- `manifests/<runId>.json`
- `digest/latest-digest.md`
- `digest/history.md`
- `evaluations/<runId>/...`
- `sweeps/<runId>/...`

### Manifest additions
- `activeTrackId`
- `rotationReason`
- `noveltySignature`
- `windowSetId`
- `gateResults`
- `steadyState`
- `noChangeStreak`

## Reporting
### Digest
Digest output should always state:
- current champion
- current challenger
- active track
- novelty state
- steady-state streak
- best alternate
- matrix decision
- next scheduled move

If the loop is in steady state, the digest must say so plainly.

### Scout Report
The scout report should include:
- track used
- window set
- candidate count
- promote/hold verdict
- failed gates
- lab matrix summary
- whether the run is new, rotated, or steady state

### Operator Line
Each run should emit one concise summary line containing:
- track
- novelty
- result
- decision
- next action

## Failure Handling
The scheduler must fail closed.

If any of the following occurs:
- missing pinned data
- missing champion
- malformed candidate file
- matrix incomplete
- lab run failure
- patch failure
- novelty signature unavailable

then the scheduler must:
- hold
- write failure details
- avoid promotion
- avoid champion mutation

## Saturation Handling
If the scheduler keeps producing the same outcome:
- increment `noChangeStreak`
- mark the run as steady state
- rotate track/window after the configured threshold
- if saturation persists, reduce full frequency or pause the track

No-repeat loops should not be presented as progress.

## Recovery Handling
On restart:
- reload latest manifest and champion
- restore active track and streak state
- preserve novelty and rotation state
- do not assume fresh novelty just because the process restarted

## Implementation Notes
### Current script behavior to preserve
- incumbent-local search mode
- pinned lab support
- exploit/explore lane split
- manifest/digest/history writes
- matrix promotion guards
- autopromote cooldown and quota checks

### Required internal changes
- track selection before search batch creation
- novelty signature calculation
- rotation state persistence
- track-aware summary lines
- track-aware digest content
- explicit steady-state detection

## Testing Plan
1. **Config and track parsing tests**
   - track registry loads correctly
   - rotation policy fields parse
   - novelty signature generation is stable

2. **Batch planning tests**
   - track-based candidate sets are bounded
   - disabled tracks are skipped
   - dependent knobs are pruned when a track is inactive

3. **Promotion tests**
   - candidate-change gate blocks same-config promotion
   - matrix promotion still required
   - cooldown and daily quota still block correctly

4. **Steady-state tests**
   - repeated signatures mark steady state
   - no-change streak increments
   - rotation trigger fires after threshold

5. **Artifact tests**
   - manifest includes track metadata
   - digest includes active track and next action
   - history records rotation / steady-state events

## Rollout Order
1. Add track registry and config parsing.
2. Add novelty signature and steady-state detection.
3. Add rotation policy and track switching.
4. Update artifact/report generation.
5. Add tests.
6. Validate on current pinned labs.

## Exit Condition
The design is complete when:
- the spec is approved by the user
- implementation plan can be written directly from this spec
- scheduler changes remain bounded, track-aware, and fail-closed
