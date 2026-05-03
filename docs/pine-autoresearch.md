# Pine autoresearch

End-to-end loop for scout → digest → promote → autopromote.
This is the strategy-config research pipeline, not generic backtesting.

## Shape

- `cycle` / `scout`: build variants, run primary sweep, evaluate matrix labs, write manifest, refresh live digest, maybe queue promotion
- `digest`: render digest from the latest manifest only
- `promote`: patch `config.scriptPath` from a chosen manifest, record new champion, refresh history/digest
- `autopromote`: consume the pending promotion queue and promote only when queue + policy gates pass
- `holdout` / `blind-holdout`: recheck latest challenger on blind labs only

## Core flow

### 1) cycle / scout

`node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json`

What happens:
1. load config + champion state
2. check promotion queue
3. if a pending promotion exists, stop unless `--force-cycle`
4. select active track / rotation state
5. build search batch and primary sweep variants
6. evaluate matrix labs
7. choose challenger, compute matrix decision, derive research state
8. write manifest to `manifests/<run-id>.json`
9. write `latest.json`
10. append history event
11. update scheduler state
12. write scout markdown + regime artifact + live digest
13. optionally append a pending promotion queue item

Important: pending promotion pauses normal cycles. Use `--force-cycle` only when you mean to ignore that pause.

### 2) digest

`node scripts/pine-autoresearch.mjs digest --config config/pine-autoresearch.default.json`

Reads the current `latest.json` and renders a digest markdown file. No promotion, no patching.

### 3) promote

`node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json`

Promote path:
1. resolve manifest source
2. use `--manifest` if given
3. else use safe `--run-id` lookup under `manifests/<run-id>.json`
4. else use `latest.json`
5. require a challenger config
6. patch `config.scriptPath`
7. write new champion state
8. append promote history
9. rebuild digest artifacts

`--force` can override a non-promote recommendation only. It does **not** skip missing-manifest / missing-challenger / queue-integrity checks.

### 4) autopromote

`node scripts/pine-autoresearch.mjs autopromote --config config/pine-autoresearch.default.json`

Autopromote does **not** chase mutable `latest.json`.
It consumes the oldest pending queue item, loads the exact queued manifest path, then evaluates gates against that exact manifest.

Flow:
1. read promotion queue
2. select oldest pending item
3. read `queuedItem.manifestPath`
4. build `queuedManifestWithPath`
5. evaluate auto-promotion policy gates
6. validate queued item against champion + manifest identity
7. if blocked, append queue status and stop
8. if allowed, call promote with the queued manifest and `mode=auto`
9. append final queue status

`--force` can override an autopromote gate block only when the queue action status is `blocked`. It does not bypass queue integrity, manifest identity, or missing-manifest failures.

## Promotion queue

Path: `state/promotion-queue.jsonl`

The queue is append-only JSONL.
It stores events, not in-place mutable rows.

### Event model

- `pending`: append a queued promotion item
- `status`: append outcome updates for a queued item

Queue item identity:
- `itemId = ${runId}:${candidateFingerprint}`

Queued item fields:
- `runId`
- `manifestPath`
- `candidateFingerprint`
- `championFingerprintAtDecision`
- `candidateConfigId`
- `championConfigIdAtDecision`
- `createdAt`

Reduction rules:
- first `pending` for an `itemId` wins
- later duplicate `pending` is idempotent
- later `status` updates the item if it exists
- orphan `status` events are retained as orphans until their `pending` arrives
- missing queue file means empty queue, not failure
- oldest pending item wins selection (`createdAt`, then `itemId`)

### Queue invariants

- append-only
- autopromote uses exact queued manifest, not mutable `latest.json`
- manual promote can use exact `--manifest` or safe `--run-id`
- `force` cannot repair broken queue integrity
- queue item must match the exact manifest + candidate fingerprint that was queued

## Locking

### JS canonical lock

`cycle`, `promote`, and `autopromote` all pass through the same JS lock layer:
`state/autoresearch.lock.json`

Owner metadata includes:
- token
- pid
- command
- profile
- acquiredAt
- staleAfterMs
- cwd

Behavior:
- exclusive create first
- if lock exists, read current owner
- if owner is stale and pid is dead, reclaim with a guarded `.reclaim` file
- release only if token still matches

This lock is the main coordination gate for the autoresearch runner.

### Scheduler wrapper lock

The PowerShell scheduler wrapper adds a second lock.
That is defense-in-depth, not the primary guard.
Stale-dead-lock reclaim exists there too.

## Current invariants

- promotion queue append-only
- autopromote uses exact queued manifest, not mutable latest.json
- manual promote can use exact `--manifest` or safe `--run-id`
- `force` can override autopromote gate block only, not queue integrity
- pending promotion pauses cycles unless `--force-cycle`
- JS canonical lock around cycle/promote/autopromote
- scheduler wrapper lock is defense-in-depth and stale-dead-lock reclaim exists

## Operational runbook

### Normal day

1. run `cycle`
2. inspect scout + digest
3. if promotion-worthy, run `promote` on the exact manifest
4. if unattended shipping is desired, let `autopromote` consume the queue later

### Safe manual promote

Prefer one of these:
- `--manifest <exact path>`
- `--run-id <run-id>`

Use `--run-id` only when the manifest lives under the expected `manifests/<run-id>.json` path.

### Force use

- `promote --force`: override a recommendation block, not missing data
- `autopromote --force`: override a blocked gate only
- `cycle --force-cycle`: ignore a pending promotion pause

### Recovery

If autopromote fails:
- check whether the queue item still exists
- check `queuedItem.manifestPath`
- do **not** edit `latest.json` to fake queue recovery
- rerun `autopromote` only after the exact queued manifest is valid again

If the manifest moved or changed:
- the queued item is stale
- queue status should show that
- rerun `cycle` to produce a new candidate, or promote the exact historical manifest if that is still the right answer

If the lock is stuck:
- wait for normal release first
- stale reclaim should handle dead owners
- do not delete locks blindly unless you have verified the owner is gone

## Tests-first inventory

These are the highest-value test areas for autoresearch changes:

- `tests/pine-autoresearch-tracks.test.mjs`
  - track rotation
  - `no-new-candidate` streak handling
  - novelty similarity rotation
  - max-cycle rotation

- `tests/pine-track-generators.test.mjs`
  - no-new-candidate / self-loop escape
  - tabu fingerprints
  - fallback lane generation

- `tests/pine-regime-analysis.test.mjs`
  - regime analysis
  - threshold asymmetry
  - split-track recommendation

- `tests/pine-expectancy.test.mjs`
  - expectancy gate
  - win-rate vs avg-win / avg-loss decomposition

- `tests/pine-autoresearch.test.mjs`
  - matrix decision
  - auto-promotion guard
  - queued-manifest source selection
  - digest rendering
  - scheduler tabu merge
  - track selection state

- `tests/pine-promotion-queue.test.mjs`
  - append-only queue reduction
  - exact manifest identity
  - oldest pending selection

- `tests/pine-autoresearch-lock.test.mjs`
  - exclusive lock
  - stale reclaim
  - token-safe release

## See also

Planned companion docs:

- [Artifacts and state](./artifacts-and-state.md)
- [Operations](./operations.md)
- [Reference: schemas](./reference/schemas.md)

Existing context docs:
- [Pine autoresearch cron loop](./2026-04-21-pine-autoresearch-cron.md)
- [Pine autoresearch anti-curvefit protocol](./2026-04-29-pine-autoresearch-anti-curvefit.md)

## Elite autonomous research guardrails

The non-LLM autoresearch lane is designed as a guarded autonomous research system, not a blind optimizer.

Autopromote is allowed only when all layers agree:

1. the cycle wrote an exact manifest
2. matrix decision is `promote`
3. candidate differs from current champion
4. expectancy policy does not reject the improvement, when the expectancy gate is enabled
5. promotion queue still matches the exact manifest and champion fingerprint at decision time
6. cooldown and daily quota pass
7. lineage anti-ping-pong gate passes

### Why promotion speed is capped

Research can run often. Promotion is durable champion replacement. Every promotion changes the baseline for future comparisons, so unattended promotion must limit champion churn even when matrix gates are strong.

Recommended policy settings:

These are operator presets expressed as direct `autoPromotion.cooldownHours` and `autoPromotion.maxPromotionsPerDay` values, not runtime profile names.

| Profile | cooldownHours | maxPromotionsPerDay | Use |
|---|---:|---:|---|
| Conservative production | 24 | 1 | safest unattended champion evolution |
| Balanced autonomous | 12 | 2 | checked-in balanced default in `config/pine-autoresearch.default.json` |
| Aggressive lab | 6 | 4 | sandbox or high-observation mode |

Do not use 24 promotions/day for live champion state unless the run is explicitly a lab experiment.

### Anti-ping-pong lineage

Promotion history records from/to fingerprints and family keys. If a candidate tries to reverse a recent promotion, autopromote blocks it unless the new evidence has extra margin.

This prevents A → B → A → B churn caused by micro-regime noise.

### N-run escape

Repeated no-new-candidate or high-similarity hold cycles increase `stagnationLevel` in scheduler state. Higher stagnation level widens fallback families and raises mutation temperature.

Stagnation escape changes search pressure only. It never weakens matrix, expectancy, queue, cooldown, or lineage promotion gates.
