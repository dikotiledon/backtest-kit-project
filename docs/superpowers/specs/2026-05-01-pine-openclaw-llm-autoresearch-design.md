# Pine OpenClaw LLM Autoresearch Design

## Status
Draft for review - revised after subagent review

## Objective
Add a new, isolated LLM-assisted autoresearch lane that can use LLM reasoning as a research brain while preserving the existing Windows Task Scheduler autoresearch loop as a fully standalone system.

The new lane auto-runs one validated parameter candidate per scheduled run and collects evidence, but it does not auto-promote a champion. Promotion remains manual or explicitly invoked through existing guarded promotion paths.

## Final V1 Decisions
These decisions close the implementation-blocking open questions:

- Scheduled Windows `run` provider default: `disabled` until a non-OpenClaw local provider is explicitly configured.
- First scheduled LLM provider mode: `cli`, where a configured local command returns one strict JSON candidate object.
- `openclaw` provider mode: manual/on-demand only. It must not be used by any Windows scheduled task in v1.
- Candidate count: exactly one candidate object per `run` in v1. No batch envelope.
- Fixed scheduled slot: 15 minutes total.
- Initial parameter source of truth: checked-in `config/pine-autoresearch-llm-allowlist.default.json` with per-field mutability class.
- Architecture/structure toggles are forbidden by default, even if scalar.
- Auto-promotion: disabled in v1.

## Non-Negotiable Requirements
- Existing Windows scheduled autoresearch must run flawlessly without OpenClaw, OpenClaw cron, OpenClaw memory, or OpenClaw result delivery.
- Existing autoresearch behavior must not be replaced or weakened.
- New implementation must live in separate files/state paths and must not mutate current autoresearch state except through explicit, reviewed, read-only integration points.
- Scheduled Windows tasks must never require OpenClaw provider availability.
- LLM may propose parameter changes only.
- LLM must not edit PineScript structure, strategy code, JavaScript orchestration code, scheduler scripts, package scripts, or promotion logic during scheduled research.
- Every candidate must pass schema validation before execution.
- Every mutating command must be race-safe, lock-safe, duplicate-safe, and auditable.
- Runtime memory footprint must stay light; scheduler reads compact state, not full raw logs.
- Research must be progressive: it must remember what failed, avoid ping-pong, avoid replaying same challenger, and explore hypotheses rather than random churn.

## Current System Boundary
Existing autoresearch already has local safety systems:
- Windows Task Scheduler wrappers for micro/full/digest/autopromote.
- Scheduler wrapper lock in `tmp/pine-autoresearch-locks/scheduler.lock`.
- Existing OS mutex namespace, currently used by the current lane only.
- Autoresearch command lock under research state.
- Promotion queue keyed by exact manifest/run identity.
- Tabu candidate fingerprints to avoid replaying rejected candidates.
- Retention controls for manifests/sweeps/evaluations.

These remain the source of correctness for current scheduled autoresearch. OpenClaw can observe and advise, but must not become part of the required correctness path.

## Design Principle
Treat OpenClaw as a **research advisor**, not as the **runtime safety kernel**.

Local scripts must own:
- locks
- OS mutex namespace
- candidate validation
- candidate reservation
- duplicate detection
- run ledgers
- manual-review queue
- promotion safety
- retention
- scheduler independence

OpenClaw may own only read-only, non-blocking advisory work:
- manual LLM reasoning
- human-facing summaries
- operator notifications
- manual/on-demand proposal drafting
- optional scheduler health summaries

OpenClaw advisory jobs never gate local scheduler correctness. If OpenClaw emits a hint, it must be copied into repo-local LLM lane state and validated like any other candidate before use. If OpenClaw is down, existing Windows scheduled autoresearch continues, and the LLM Windows scheduler either uses a configured non-OpenClaw provider or exits cleanly with `proposal_unavailable`.

## Chosen Mode: Option C
The LLM lane auto-runs validated parameter candidates, but auto-promotion is disabled.

Flow:
1. Acquire scheduled wrapper lock and lane mutex.
2. Acquire per-matrix reservation/state lock.
3. Check pending manual-review gate.
4. Build compact research context.
5. Ask configured non-OpenClaw scheduled provider for exactly one parameter-only candidate object.
6. Validate patch through strict allowlist/schema gate.
7. Reserve candidate fingerprint before execution.
8. Reject duplicate, unsafe, out-of-range, or structurally invalid candidates.
9. Execute accepted candidate under fixed wall-clock budget.
10. Verify evaluator process ended or was force-killed before releasing scheduler lock.
11. Write immutable manifest and append-only ledger events.
12. Update compact research memory.
13. If candidate looks promotable, append to dedicated LLM manual-review queue and stop further research for that matrix until review is cleared or forced.

## Allowed And Forbidden Existing Files
New implementation should be additive.

Allowed existing-file changes for v1:
- `package.json`: add npm scripts for LLM lane only.
- `docs/**`: add/update docs for LLM lane only.
- `README.md` or docs index files: link new docs only.
- `tests/**`: add no-regression tests for old and new scheduler separation.

Conditionally allowed only with explicit plan note and subagent review:
- `scripts/lib/pine-autoresearch.mjs`: read-only adapter extraction if reuse is impossible otherwise.
- `scripts/pine-autoresearch.mjs`: export-only change for reuse; no behavior change.

Forbidden in v1:
- modifying existing Windows task wrappers to call LLM lane
- changing existing `pine:autoresearch*` script behavior
- changing current promotion/autopromote semantics
- writing LLM candidates into existing autoresearch promotion queue
- changing PineScript structure or non-allowlisted Pine parameters
- replacing current scheduler lock/mutex names

## Proposed File Layout
New files:

```text
config/pine-autoresearch-llm.default.json
config/pine-autoresearch-llm-allowlist.default.json
scripts/pine-autoresearch-llm.mjs
scripts/lib/pine-autoresearch-llm-context.mjs
scripts/lib/pine-autoresearch-llm-schema.mjs
scripts/lib/pine-autoresearch-llm-ledger.mjs
scripts/lib/pine-autoresearch-llm-memory.mjs
scripts/lib/pine-autoresearch-llm-runner.mjs
scripts/lib/pine-autoresearch-llm-review-queue.mjs
scripts/lib/pine-autoresearch-llm-reservation.mjs
scripts/ops/pine-autoresearch-llm-run.ps1
scripts/ops/install-pine-autoresearch-llm-tasks.ps1
scripts/ops/remove-pine-autoresearch-llm-tasks.ps1
tests/pine-autoresearch-llm-schema.test.mjs
tests/pine-autoresearch-llm-ledger.test.mjs
tests/pine-autoresearch-llm-memory.test.mjs
tests/pine-autoresearch-llm-runner.test.mjs
tests/pine-autoresearch-llm-scheduler.test.mjs
tests/pine-autoresearch-llm-no-regression.test.mjs
```

## LLM Namespace And Artifact Names
The LLM lane uses a distinct namespace from existing autoresearch.

Given existing matrix id `pine-fusion-v4-core-15m-locked-window`, the LLM lane namespace is:

```text
llm-pine-fusion-v4-core-15m-locked-window
```

Root paths:

```text
pine/autoresearch-llm/llm-<matrix-id>/state/
pine/autoresearch-llm/llm-<matrix-id>/manifests/
pine/autoresearch-llm/llm-<matrix-id>/runs/
pine/autoresearch-llm/llm-<matrix-id>/archive/
```

Exact hot-state filenames:

```text
state/llm-scheduler.lock
state/llm-state.lock
state/llm-reservation.lock
state/llm-ledger.jsonl
state/llm-research-memory.json
state/llm-manual-review-queue.jsonl
state/llm-tabu-fingerprints.json
state/llm-provider-status.json
```

The lane must not create or reuse existing autoresearch files named `autoresearch.lock.json`, `promotion-queue.jsonl`, `latest.json`, or `state/scheduler/<matrixId>.json`.

## CLI Shape
`scripts/pine-autoresearch-llm.mjs` exposes separate commands:

```bash
node scripts/pine-autoresearch-llm.mjs run --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs propose --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs digest --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs validate --config config/pine-autoresearch-llm.default.json --candidate <path>
node scripts/pine-autoresearch-llm.mjs enqueue --config config/pine-autoresearch-llm.default.json --candidate <path>
node scripts/pine-autoresearch-llm.mjs review-status --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs review-resolve --config config/pine-autoresearch-llm.default.json --candidate-id <id> --status <status> --reason <text>
```

Mutating commands are `run`, `propose`, `enqueue`, and any future command that writes queue/ledger/memory. Every mutating command must use the same per-matrix reservation gate.

Recommended scheduled command is `run`, because it can propose, validate, execute, and summarize in one bounded turn.

## Scheduler Architecture
There are two independent scheduler layers.

### Existing Windows Scheduler
Remains unchanged in responsibility:
- runs micro/full/digest/autopromote tasks
- uses existing local wrapper lock
- uses existing OS mutex name only for current lane
- uses existing autoresearch locks/queues/state
- does not call OpenClaw
- does not read LLM lane results unless a future explicit integration is approved

### New LLM Windows Scheduler
Separate scheduled tasks:
- `BacktestKit-Pine-LLM-Run`
- `BacktestKit-Pine-LLM-Digest`

Separate wrapper lock:
- `pine/autoresearch-llm/llm-<matrix-id>/state/llm-scheduler.lock`

Separate OS mutex namespace:
- existing lane keeps its current mutex name unchanged
- LLM lane uses `Global\BacktestKit-Pine-LLM-Autoresearch-<matrix-id>`

Default cadence:
- LLM run every 30 minutes, disabled until explicitly installed/enabled.
- LLM digest every 6 hours.
- No autopromote task in v1.

Scheduled `run` provider rules:
- default provider is `disabled`; scheduled task exits cleanly until configured.
- allowed scheduled provider is `cli` only in v1.
- `openclaw` provider is rejected when `--scheduled` or wrapper context is detected.
- installer must warn/refuse enabling `BacktestKit-Pine-LLM-Run` if provider is `openclaw`.

The LLM scheduler must use fixed wall-clock runtime. Recommended budget:
- 2 minutes max for context/proposal/validation.
- 12 minutes max for candidate execution.
- 1 minute max for manifest/memory/digest update.
- Total scheduled slot: 15 minutes.

If execution exceeds budget, candidate is marked `execution_timeout`. The runner must terminate and verify the entire evaluator process tree, not only the parent process. On Windows this requires a Job Object, `taskkill /T /F`-equivalent behavior, or an implementation-proven process-tree killer. Ledger records `timeout_clean_exit`, `timeout_forced_tree_kill`, or `timeout_kill_failed`. Locks release only after every evaluator child/grandchild process is verified dead. If process-tree termination cannot be verified, the run hard-fails and keeps enough state for operator recovery.

## OpenClaw Scheduler Integration
OpenClaw cron may be used only as an optional read-only companion:
- trigger manual `digest`
- summarize last N LLM lane runs
- notify when a candidate passes manual-review gates
- inspect stalled scheduler state
- ask the human for decisions
- draft a candidate file for manual validation, not scheduled execution

OpenClaw cron must not be required for:
- Windows scheduled task execution
- proposal generation for scheduled Windows tasks
- candidate dedupe
- lock release/reclaim
- promotion queue correctness
- run manifest identity
- tabu memory
- challenger selection

No local script may assume OpenClaw memory exists. All durable research state lives inside repo-local files.

## LLM Contract
The LLM receives a compact prompt containing:
- current champion parameter snapshot
- versioned allowlist schema with min/max/step/type/mutability class
- recent top winners
- recent rejected fingerprints and short reasons
- active research hypothesis
- fixed run budget
- hard rules

The LLM must output exactly one JSON object:

```json
{
  "hypothesis": "short reason",
  "patch": {
    "minPredSum": 1.8,
    "divRsiLen": 21
  },
  "expectedEffect": "short expected behavior change",
  "risk": "short risk note"
}
```

Allowed output is one parameter patch only. No arrays, no batch envelope, no code blocks, no PineScript, no commands, and no file paths as mutation targets.

## Parameter Schema Gate
`config/pine-autoresearch-llm-allowlist.default.json` is the authoritative checked-in schema for v1. `pine-autoresearch-llm-schema.mjs` validates candidates against it.

Each allowlist entry must define:
- `key`
- `type`: `int`, `float`, or `bool`
- `min` / `max` where applicable
- `step` where applicable
- `mutability`: `tunable`, `guarded`, or `forbidden`
- `family`
- short rationale

V1 default rules:
- only `mutability: "tunable"` keys may be changed by scheduled runs.
- `guarded` keys require manual candidate file + explicit `--allow-guarded` and are not scheduled.
- `forbidden` keys are always rejected.
- structure/architecture toggles are forbidden by default, including `useSignalFusion`, `useFusionV4`, `useTrailingStop`, and any equivalent architecture switch.
- `freezeArchitecture` is respected: when true, all architecture toggles are rejected even if scalar.

Validation rejects:
- unknown parameter keys
- missing patch
- non-JSON output
- array/batch output
- arrays/objects where scalar expected
- float/int type mismatch unless safe coercion is explicit and tested
- values outside min/max
- values not aligned to step
- too many changed params
- guarded params without explicit manual override
- forbidden params
- duplicate fingerprint
- candidates too close to recent rejected candidates
- candidates that equal current champion
- candidates that imply Pine structure/code change

The schema is local, versioned, and explicit. It must not be inferred from LLM text at runtime.

## Candidate Identity And Reservation
Every validated candidate gets:
- stable canonical JSON
- config fingerprint
- parent champion fingerprint
- candidate id: `parentChampionFingerprint:candidateFingerprint`
- source provider mode
- source model/id if available
- hypothesis id
- createdAt
- immutable candidate file path

Fingerprint ignores formatting and key order.

A candidate cannot execute if its candidate id or fingerprint is in:
- LLM lane ledger
- LLM lane active reservations
- LLM lane tabu set
- LLM lane manual-review queue
- existing autoresearch tabu set, if explicitly imported read-only
- current champion fingerprint

Reservation protocol for every mutating command:
1. acquire lane mutex
2. acquire `llm-reservation.lock`
3. read ledger, tabu, manual-review queue, and active reservations
4. validate candidate
5. append `reserved` event with candidate id
6. write active reservation record
7. release `llm-reservation.lock` only after reservation is durable
8. execute candidate
9. reacquire `llm-reservation.lock`
10. append final event: `completed`, `rejected`, `timeout`, `failed`, or `abandoned`
11. remove active reservation

This prevents two callers from selecting and running the same candidate before the ledger is updated.

## Progressive Research Memory
Lightweight state file:

```text
pine/autoresearch-llm/llm-<matrix-id>/state/llm-research-memory.json
```

Contents are compact:
- current champion fingerprint and small metrics snapshot
- last 20 candidate summaries
- top 10 winners
- last 50 rejected fingerprints with short reason
- active hypotheses with score/age
- no-change streak
- novelty streak
- pending unresolved manual-review count
- last run id

Raw prompts/responses go to archive, but scheduled runs read only compact memory.

This prevents high memory usage from loading old manifests, full logs, or full prompt histories each run.

## Progressive Brain Logic
The LLM lane should not ask the model to “try anything”. It should run a simple research program:

1. Maintain active hypothesis families:
   - entry threshold relaxation/tightening
   - divergence sensitivity
   - squeeze context timing
   - stop/target/trailing risk shape, only if allowlisted as tunable
   - long/short asymmetry, only if allowlisted as tunable
2. Score hypothesis families by recent improvement and novelty.
3. Ask provider to produce one candidate within selected family.
4. Validate and reserve.
5. Run fixed-budget evaluation.
6. Update hypothesis score.
7. Rotate family when no-change streak or duplicate pressure rises.

This gives LLM “brain” without giving it unsafe control.

## Ping-Pong And Self-Loop Prevention
The new lane must implement local defenses before first scheduled use:
- fingerprint tabu cache
- candidate id dedupe by candidate fingerprint + parent champion fingerprint
- reject same-as-champion
- reject same-as-last-candidate
- reject alternating A/B/A patterns
- require candidate novelty distance above minimum threshold
- record rejection reasons
- rotate hypothesis family after repeated no-change
- avoid mutable `latest.json` as authority
- stop new `run`/`propose` work while manual-review queue has pending item for the matrix unless `--force-new-research` is explicitly provided

Promotion candidates must point to immutable manifest path/runId only.

## Race And Lock Safety
Required locks:
- `llm-scheduler.lock`: protects scheduled wrapper overlap.
- `llm-state.lock`: protects compact memory and provider status writes.
- `llm-reservation.lock`: protects select/validate/reserve/finalize transitions.
- LLM lane OS mutex: separates LLM lane from current scheduler mutex.
- existing autoresearch command lock: not used in v1 scheduled LLM lane. If a future implementation must touch shared existing autoresearch resources, that requires a separate spec revision naming exact resources and lock scope before implementation.

Rules:
- acquire locks in fixed order to prevent deadlocks: scheduler -> lane mutex -> reservation -> state -> evaluator/autoresearch.
- every lock has token, pid, acquiredAt, command, staleAfterMs, cwd.
- stale reclaim must verify dead pid when possible.
- release must be token-safe.
- ledger append happens at reservation and finalization.
- crash recovery marks orphaned `running` or `reserved` candidates as `abandoned` after stale threshold.
- locks release after timeout only after the full evaluator process tree has exited or has been force-killed and every child/grandchild process is verified dead.

## Data Flow
```text
Windows Task Scheduler
  -> pine-autoresearch-llm-run.ps1 --scheduled
    -> LLM lane OS mutex
    -> llm-scheduler.lock
      -> pine-autoresearch-llm.mjs run --scheduled
        -> reject provider=openclaw in scheduled mode
        -> acquire llm-reservation.lock
        -> check pending manual-review queue
        -> read compact llm-research-memory.json
        -> call configured non-OpenClaw cli provider or exit proposal_unavailable
        -> validate exactly one JSON patch against allowlist
        -> reserve candidate id durably
        -> execute fixed-budget backtest/evaluation
        -> verify full evaluator process tree stopped before lock release
        -> write immutable manifest
        -> append ledger final event
        -> update compact memory
        -> append dedicated manual-review queue item when gates pass
```

## LLM Provider Boundary
The implementation should abstract proposal generation behind `proposeCandidate()`.

Provider modes:
- `cli`: scheduled-safe mode. Calls a configured local command that returns exactly one JSON candidate object.
- `file`: reads a candidate file for dry runs/tests/manual review.
- `disabled`: no proposal. Scheduled run records `proposal_unavailable` and exits soft-success.
- `openclaw`: manual/on-demand only. Rejected in scheduled mode.

If provider fails, the run records `proposal_failed` and exits cleanly. It must not fall back to unsafe random mutation unless a separate deterministic fallback is explicitly enabled in a future approved spec.

## Memory Usage Controls
Hard controls:
- never load all historical manifests in scheduled path
- cap compact memory by count and byte size
- archive raw LLM prompts/responses outside hot path
- stream large result files where possible
- keep candidate count per scheduled run exactly 1 in v1
- fixed execution timeout
- retention policy for LLM lane runs/manifests/archive

Default caps:
- `maxHotMemoryBytes`: 256 KB
- `maxPromptBytes`: 16 KB
- `recentCandidates`: 20
- `tabuFingerprints`: 200
- `topWinners`: 10
- `archiveRetentionDays`: 14
- `keepLatestRuns`: 12

## Promotion And Manual Review Policy
V1 does not auto-promote.

Dedicated LLM manual-review queue:

```text
pine/autoresearch-llm/llm-<matrix-id>/state/llm-manual-review-queue.jsonl
```

If a candidate passes promotion-style gates:
- append queue item with `status: "pending_review"`
- include exact immutable manifest path
- include runId
- include candidate id
- include parent champion fingerprint
- include candidate fingerprint
- include metrics delta
- include risk notes
- optionally notify via OpenClaw if available

Queue dedupe key:

```text
parentChampionFingerprint:candidateFingerprint
```

The LLM lane must not write into the existing autoresearch `promotion-queue.jsonl` in v1.

Manual-review lifecycle:
- `pending_review`: unresolved item; blocks scheduled `run` and `propose` for the matrix.
- `accepted_for_manual_promotion`: human accepted candidate for separate manual promotion flow; no scheduled auto-promotion occurs.
- `rejected`: human rejected candidate; candidate id is added to tabu memory with review reason.
- `stale`: parent champion fingerprint no longer matches current champion; item no longer blocks research but remains auditable.
- `superseded`: a newer manual-review item for the same parent/candidate identity replaced it through explicit manual action.
- `archived`: operator closed item without promotion, usually after digest/report review.

Resolution commands:
```bash
node scripts/pine-autoresearch-llm.mjs review-status --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs review-resolve --config config/pine-autoresearch-llm.default.json --candidate-id <id> --status rejected --reason <text>
node scripts/pine-autoresearch-llm.mjs review-resolve --config config/pine-autoresearch-llm.default.json --candidate-id <id> --status accepted_for_manual_promotion --reason <text>
```

Resolution rules:
- only unresolved `pending_review` items block scheduled research.
- every resolution appends an immutable queue event; no in-place deletion.
- `rejected`, `stale`, `superseded`, and `archived` items unblock scheduled research.
- `accepted_for_manual_promotion` remains unresolved until a human records final `archived`, `stale`, or `rejected` after the separate manual promotion outcome is known.
- startup/digest marks pending items `stale` when their parent champion fingerprint no longer matches current champion.

Pending-review gate:
- if any unresolved `pending_review` or `accepted_for_manual_promotion` item exists for matrix, scheduled `run` and `propose` do not create new candidates.
- they may digest/notify and exit soft-success.
- `--force-new-research` may bypass only for manual CLI runs, never for scheduled Windows tasks.

Manual promotion must use existing guarded promotion path or a separately approved LLM-lane promotion adapter. No scheduled LLM task promotes automatically.

## Existing Autoresearch Benefit From OpenClaw
Current autoresearch can benefit safely through advisory integration:
- OpenClaw reads digest/manifests and summarizes research state.
- OpenClaw suggests next hypothesis families for the LLM lane.
- OpenClaw alerts on scheduler stalls, repeated no-change, or suspicious duplicate loops.
- OpenClaw can trigger a manual digest after Windows tasks complete.

But current autoresearch must never depend on OpenClaw for loop correctness. Any OpenClaw-derived hint must be copied into repo-local state before use and validated like any other candidate. Advisory jobs are read-only, non-blocking, and never gate local scheduler correctness.

## Exit Semantics
Scheduled wrapper treats these as soft-success exit `0`:
- `lock_exists`
- `pending_review_exists`
- `provider_disabled`
- `proposal_unavailable`
- `proposal_timeout`
- `rejected_invalid_json`
- `rejected_schema`
- `rejected_duplicate`
- `no_candidate`

Scheduled wrapper treats these as hard-fail nonzero:
- state write failure after reservation
- ledger append failure
- lock corruption that cannot be safely reclaimed
- evaluator process cannot be stopped after timeout
- manifest write failure after completed evaluation
- invariant violation such as provider `openclaw` in scheduled mode

Every exit path appends ledger/provider status where safely possible.

## Error Handling
- Invalid LLM JSON: append `rejected_invalid_json`, exit soft-success.
- Schema violation: append `rejected_schema`, do not execute, exit soft-success.
- Duplicate fingerprint: append `rejected_duplicate`, rotate hypothesis next run, exit soft-success.
- Provider timeout: append `proposal_timeout`, release lock, exit soft-success.
- Provider disabled/unavailable: append `proposal_unavailable`, exit soft-success.
- Evaluation timeout: terminate evaluator process tree, verify parent/child/grandchild processes are dead, append `execution_timeout` with `timeout_clean_exit`, `timeout_forced_tree_kill`, or `timeout_kill_failed`; hard-fail on `timeout_kill_failed`; tabu candidate unless configured otherwise.
- Lock exists: wrapper logs skip, exits soft-success.
- Stale lock with dead pid: reclaim once, then run.
- Stale lock with live pid: skip.
- State write failure: do not promote/report success; hard-fail if reservation already exists and cannot be finalized.

## Acceptance Criteria
V1 is done only when all criteria pass:

- Existing `npm run pine:autoresearch`, `pine:autoresearch:micro`, `pine:autoresearch:digest`, and `pine:autoresearch:autopromote` command definitions remain behaviorally unchanged.
- Existing Windows task installer/remover behavior remains unchanged.
- New LLM task installer creates only `BacktestKit-Pine-LLM-*` task names.
- Existing and LLM scheduler locks/mutexes are distinct.
- Scheduled LLM run rejects `provider=openclaw`.
- Scheduled LLM run with `provider=disabled` exits soft-success and writes provider status.
- Exactly one candidate object is accepted per v1 run.
- Architecture toggles and forbidden params are rejected.
- Candidate reservation prevents duplicate concurrent execution.
- Pending unresolved manual-review queue blocks new scheduled research and resolved/stale items unblock it.
- Timeout path verifies the full evaluator process tree ended before lock release.
- No scheduled LLM path writes existing autoresearch `promotion-queue.jsonl`.
- No auto-promotion occurs from LLM scheduled tasks.
- Compact memory and prompt size caps are enforced.
- Immutable manifest path/runId is recorded for every executed candidate.
- All required tests pass and `git diff --check` passes.

## Test Plan
Required tests before enablement:
- schema accepts valid parameter-only patch
- schema rejects unknown key
- schema rejects out-of-range value
- schema rejects wrong type
- schema rejects too many params
- schema rejects guarded param without manual override
- schema rejects forbidden architecture toggles
- schema rejects duplicate fingerprint
- schema rejects array/batch output in v1
- canonical fingerprint stable across key order
- reservation writes `reserved` before execution
- reservation prevents duplicate concurrent execution
- ledger append is append-only
- orphaned running/reserved candidate becomes abandoned
- manual-review queue dedupes by parent champion fingerprint + candidate fingerprint
- pending unresolved manual-review blocks scheduled run/propose
- manual-review resolution appends immutable event and resumes scheduled research after `rejected`, `stale`, `superseded`, or `archived`
- accepted-for-manual-promotion remains blocking until final manual outcome is recorded
- stale review detection unblocks research when parent champion fingerprint no longer matches current champion
- compact memory pruning respects byte/count caps
- prompt builder stays below byte budget
- scheduler lock skips fresh lock
- scheduler lock reclaims stale dead pid lock
- LLM OS mutex name differs from existing lane mutex
- lock release is token-safe
- runner never calls promotion in v1
- runner never writes existing autoresearch promotion queue
- runner records exact immutable manifest path
- provider disabled exits soft-success
- provider `openclaw` rejected in scheduled mode
- provider failure exits cleanly
- fixed budget timeout records clean-exit vs forced process-tree kill and verifies parent/child/grandchild processes dead
- timeout test covers surviving child/grandchild process cleanup before lock release
- existing `pine:autoresearch*` npm scripts remain unchanged
- existing task installer/remover does not create LLM task names
- LLM task installer/remover does not modify existing task names
- scheduler-level dry run proves old and new lock files are separate

Verification commands should include focused node tests, PowerShell parser checks for new ops scripts, old scheduler no-regression tests, scheduler-level dry run, and `git diff --check`.

## Implementation Phases
Every implementation phase requires subagent review before moving to the next phase.

1. Spec and config skeleton.
2. Allowlist schema/fingerprint validator with tests.
3. Ledger, reservation, manual-review queue, and compact memory with tests.
4. Prompt/context builder with byte caps.
5. Provider abstraction with `disabled`, `file`, and `cli` modes; `openclaw` manual-only guard.
6. Runner that validates, reserves, executes, finalizes, and times out safely.
7. Windows scheduler wrappers and installer with distinct lock/mutex/task names.
8. Digest/reporting.
9. Existing scheduler no-regression tests.
10. End-to-end dry run on one fixed-budget candidate.
11. Subagent safety review.
12. Enable scheduled LLM run only after safety tests pass.

## Explicit Non-Goals For V1
- No PineScript structure changes.
- No JavaScript autoresearch self-modification.
- No automatic champion promotion.
- No OpenClaw provider in scheduled Windows tasks.
- No dependency on OpenClaw cron for Windows scheduler correctness.
- No broad rewrite of current autoresearch.
- No loading full historical research corpus into every prompt.
- No multi-agent swarm in scheduler path.
- No batch candidate output.

## Recommended Defaults
- Start with exactly one candidate per run.
- 15-minute fixed slot.
- Auto-run enabled only after provider is configured.
- Scheduled provider: `cli`; default config starts as `disabled`.
- Manual/on-demand provider may be `openclaw`, but never scheduled.
- Auto-promote disabled.
- Separate LLM scheduler disabled by default until manually installed.
- OpenClaw integration advisory only.
- Compact memory under 256 KB.
- Prompt under 16 KB.
- Add manual review notification when candidate beats champion gates.
