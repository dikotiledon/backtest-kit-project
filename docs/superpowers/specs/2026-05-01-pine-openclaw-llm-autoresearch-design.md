# Pine OpenClaw LLM Autoresearch Design

## Status
Draft for review

## Objective
Add a new, isolated LLM-assisted autoresearch lane that can use OpenClaw as a research brain and scheduler companion while preserving the existing Windows Task Scheduler autoresearch loop as a fully standalone system.

The new lane must auto-run validated parameter candidates and collect evidence, but it must not auto-promote a champion. Promotion remains manual or explicitly invoked through existing guarded promotion paths.

## Non-Negotiable Requirements
- Existing Windows scheduled autoresearch must run flawlessly without OpenClaw, OpenClaw cron, OpenClaw memory, or OpenClaw result delivery.
- Existing autoresearch behavior must not be replaced or weakened.
- New implementation must live in new files/state paths and must not mutate current autoresearch state except through explicit, reviewed integration points.
- LLM may propose parameter changes only.
- LLM must not edit PineScript structure, strategy code, JavaScript orchestration code, scheduler scripts, package scripts, or promotion logic during scheduled research.
- Every candidate must pass schema validation before execution.
- Every run must be race-safe, lock-safe, duplicate-safe, and auditable.
- Runtime memory footprint must stay light; scheduler reads compact state, not full raw logs.
- Research must be progressive: it must remember what failed, avoid ping-pong, avoid replaying same challenger, and explore hypotheses rather than random churn.

## Current System Boundary
Existing autoresearch already has local safety systems:
- Windows Task Scheduler wrappers for micro/full/digest/autopromote.
- Scheduler wrapper lock in `tmp/pine-autoresearch-locks/scheduler.lock`.
- Autoresearch command lock under research state.
- Promotion queue keyed by exact manifest/run identity.
- Tabu candidate fingerprints to avoid replaying rejected candidates.
- Retention controls for manifests/sweeps/evaluations.

These remain the source of correctness for current scheduled autoresearch. OpenClaw can observe and optionally launch advisory jobs, but must not become part of the required correctness path.

## Design Principle
Treat OpenClaw as a **research brain**, not as the **runtime safety kernel**.

Local scripts must own:
- locks
- candidate validation
- duplicate detection
- run ledgers
- promotion safety
- retention
- scheduler independence

OpenClaw may own:
- LLM reasoning
- prompt construction
- periodic nudges
- summaries
- operator notifications
- optional trigger orchestration

If OpenClaw is down, existing Windows scheduled autoresearch continues. If OpenClaw is up, it can improve candidate selection and reporting without becoming a single point of failure.

## Chosen Mode: Option C
The LLM lane auto-runs validated parameter candidates, but auto-promotion is disabled.

Flow:
1. Build compact research context.
2. Ask LLM for one or more parameter-only candidate patches.
3. Validate patches through strict schema gate.
4. Reject duplicate, unsafe, out-of-range, or structurally invalid candidates.
5. Execute accepted candidates under fixed wall-clock budget.
6. Write immutable manifest and append-only ledger events.
7. Update compact research memory.
8. If candidate looks promotable, enqueue/report for manual promotion review only.

## Proposed File Layout
New files only:

```text
config/pine-autoresearch-llm.default.json
scripts/pine-autoresearch-llm.mjs
scripts/lib/pine-autoresearch-llm-context.mjs
scripts/lib/pine-autoresearch-llm-schema.mjs
scripts/lib/pine-autoresearch-llm-ledger.mjs
scripts/lib/pine-autoresearch-llm-memory.mjs
scripts/lib/pine-autoresearch-llm-runner.mjs
scripts/ops/pine-autoresearch-llm-run.ps1
scripts/ops/install-pine-autoresearch-llm-tasks.ps1
scripts/ops/remove-pine-autoresearch-llm-tasks.ps1
tests/pine-autoresearch-llm-schema.test.mjs
tests/pine-autoresearch-llm-ledger.test.mjs
tests/pine-autoresearch-llm-memory.test.mjs
tests/pine-autoresearch-llm-runner.test.mjs
pine/autoresearch-llm/<matrix-id>/state/
pine/autoresearch-llm/<matrix-id>/manifests/
pine/autoresearch-llm/<matrix-id>/runs/
pine/autoresearch-llm/<matrix-id>/archive/
```

Existing files can receive minimal additive package scripts/docs only after the spec is approved. Existing autoresearch logic should not be edited unless a narrow adapter is required and separately justified.

## CLI Shape
`scripts/pine-autoresearch-llm.mjs` exposes separate commands:

```bash
node scripts/pine-autoresearch-llm.mjs propose --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs run --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs digest --config config/pine-autoresearch-llm.default.json
node scripts/pine-autoresearch-llm.mjs validate --config config/pine-autoresearch-llm.default.json --candidate <path>
node scripts/pine-autoresearch-llm.mjs enqueue --config config/pine-autoresearch-llm.default.json --candidate <path>
```

Recommended scheduled command is `run`, because it can propose, validate, execute, and summarize in one bounded turn.

## Scheduler Architecture
There are two independent scheduler layers:

### Existing Windows Scheduler
Remains unchanged in responsibility:
- runs micro/full/digest/autopromote tasks
- uses local wrapper lock
- uses local autoresearch locks/queues/state
- does not call OpenClaw
- does not read LLM lane results unless a future explicit integration is approved

### New LLM Windows Scheduler
Separate scheduled tasks:
- `BacktestKit-Pine-LLM-Run`
- `BacktestKit-Pine-LLM-Digest`

Separate wrapper lock:
- `tmp/pine-autoresearch-locks/llm-scheduler.lock`

Default cadence:
- LLM run every 30 minutes, disabled until explicitly installed/enabled.
- LLM digest every 6 hours.
- No autopromote task in v1.

The LLM scheduler must use fixed wall-clock runtime. Recommended budget:
- 2 minutes max for context/proposal/validation.
- 12 minutes max for candidate execution.
- 1 minute max for manifest/memory/digest update.
- Total scheduled slot: 15 minutes.

If execution exceeds budget, candidate is marked `timeout`, ledger is appended, lock is released, and next run moves on. It must not retry same candidate blindly.

## OpenClaw Scheduler Integration
OpenClaw cron may be used only as an optional companion:
- trigger `digest` or `propose` manually/on demand
- summarize last N LLM lane runs
- notify when a candidate passes promotion gates
- inspect stalled scheduler state
- request human decision

OpenClaw cron must not be required for:
- Windows scheduled task execution
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
- allowed parameter schema with min/max/step/type
- recent top winners
- recent rejected fingerprints and short reasons
- active research hypothesis
- fixed run budget
- hard rules

The LLM must output JSON only:

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

Allowed output is parameter patch only. No code blocks, no PineScript, no commands, no file paths as mutation targets.

## Parameter Schema Gate
`pine-autoresearch-llm-schema.mjs` owns validation.

Validation rejects:
- unknown parameter keys
- missing patch
- non-JSON output
- arrays/objects where scalar expected
- float/int type mismatch unless safe coercion is explicit
- values outside min/max
- values not aligned to step
- too many changed params
- forbidden params
- duplicate fingerprint
- candidates too close to recent rejected candidates
- candidates that equal current champion
- candidates that imply Pine structure/code change

The schema is local and explicit. It must not be inferred from LLM text at runtime.

## Candidate Identity
Every validated candidate gets:
- stable canonical JSON
- config fingerprint
- parent champion fingerprint
- source model/id if available
- hypothesis id
- createdAt
- immutable candidate file path

Fingerprint ignores formatting and key order.

A candidate cannot execute if its fingerprint is in:
- LLM lane run ledger
- LLM lane tabu set
- existing autoresearch tabu set, if explicitly imported read-only
- current champion fingerprint

## Progressive Research Memory
Lightweight state file:

```text
pine/autoresearch-llm/<matrix-id>/state/research-memory.json
```

Contents are compact:
- current champion fingerprint and small metrics snapshot
- last 20 candidate summaries
- top 10 winners
- last 50 rejected fingerprints with short reason
- active hypotheses with score/age
- no-change streak
- novelty streak
- last run id

Raw prompts/responses go to archive, but scheduled runs read only compact memory.

This prevents high memory usage from loading old manifests, full logs, or full prompt histories each run.

## Progressive Brain Logic
The LLM lane should not ask the model to “try anything”. It should run a simple research program:

1. Maintain active hypothesis families:
   - entry threshold relaxation/tightening
   - divergence sensitivity
   - squeeze context timing
   - stop/target/trailing risk shape
   - long/short asymmetry if exposed by parameter schema
2. Score hypothesis families by recent improvement and novelty.
3. Ask LLM to produce candidate within selected family.
4. Validate and run.
5. Update hypothesis score.
6. Rotate family when no-change streak or duplicate pressure rises.

This gives LLM “brain” without giving it unsafe control.

## Ping-Pong and Self-Loop Prevention
The new lane must implement local defenses before first scheduled use:
- fingerprint tabu cache
- reject same-as-champion
- reject same-as-last-candidate
- reject alternating A/B/A patterns
- require candidate novelty distance above minimum threshold
- record rejection reasons
- rotate hypothesis family after repeated no-change
- avoid mutable `latest.json` as authority

Promotion candidates must point to immutable manifest path/runId only.

## Race and Lock Safety
Required locks:
- `llm-scheduler.lock`: protects scheduled wrapper overlap.
- `llm-state.lock`: protects memory/ledger writes.
- existing autoresearch lock: only if reusing existing evaluator paths that touch shared resources.

Rules:
- acquire locks in fixed order to prevent deadlocks: scheduler -> state -> evaluator/autoresearch.
- every lock has token, pid, acquiredAt, command, staleAfterMs, cwd.
- stale reclaim must verify dead pid when possible.
- release must be token-safe.
- append ledger before and after execution.
- crash recovery marks orphaned `running` candidates as `abandoned` after stale threshold.

## Data Flow
```text
Windows Task Scheduler
  -> pine-autoresearch-llm-run.ps1
    -> llm-scheduler.lock
      -> pine-autoresearch-llm.mjs run
        -> read compact research-memory.json
        -> build prompt
        -> call configured LLM provider/OpenClaw bridge or local proposal source
        -> validate JSON patch
        -> fingerprint/dedupe/tabu check
        -> execute fixed-budget backtest/evaluation
        -> write immutable manifest
        -> append ledger event
        -> update compact memory
        -> optional digest/notification
```

## LLM Provider Boundary
The implementation should abstract proposal generation behind `proposeCandidate()`.

Provider modes:
- `openclaw`: asks OpenClaw/agent runtime when available.
- `cli`: calls a configured local command that returns JSON.
- `file`: reads a candidate file for dry runs/tests.
- `disabled`: no proposal, only validates queued candidates.

If provider fails, the run records `proposal_failed` and exits cleanly. It must not fall back to unsafe random mutation unless a separate deterministic fallback is explicitly enabled.

## Memory Usage Controls
Hard controls:
- never load all historical manifests in scheduled path
- cap compact memory by count and byte size
- archive raw LLM prompts/responses outside hot path
- stream large result files where possible
- keep candidate count per scheduled run small, default 1
- fixed execution timeout
- retention policy for LLM lane runs/manifests/archive

Suggested defaults:
- `maxHotMemoryBytes`: 256 KB
- `maxPromptBytes`: 16 KB
- `recentCandidates`: 20
- `tabuFingerprints`: 200
- `topWinners`: 10
- `archiveRetentionDays`: 14
- `keepLatestRuns`: 12

## Promotion Policy
V1 does not auto-promote.

If a candidate passes promotion-style gates:
- write `recommendation: "review_for_promotion"`
- include exact manifest path
- include parent champion fingerprint
- include metrics delta
- include risk notes
- optionally notify via OpenClaw if available

Manual promotion must use existing guarded promotion path or a separately approved LLM-lane promotion adapter. No scheduled LLM task promotes automatically.

## Existing Autoresearch Benefit From OpenClaw
Current autoresearch can benefit safely through advisory integration:
- OpenClaw reads digest/manifests and summarizes research state.
- OpenClaw suggests next hypothesis families for the LLM lane.
- OpenClaw alerts on scheduler stalls, repeated no-change, or suspicious duplicate loops.
- OpenClaw can trigger a manual digest after Windows tasks complete.

But current autoresearch must never depend on OpenClaw for loop correctness. Any OpenClaw-derived hint must be copied into repo-local state before use and validated like any other candidate.

## Error Handling
- Invalid LLM JSON: append `rejected_invalid_json`, exit 0 unless strict mode requests nonzero.
- Schema violation: append `rejected_schema`, do not execute.
- Duplicate fingerprint: append `rejected_duplicate`, rotate hypothesis next run.
- Provider timeout: append `proposal_timeout`, release lock.
- Evaluation timeout: append `execution_timeout`, tabu candidate unless configured otherwise.
- Lock exists: wrapper logs skip, exits 0.
- Stale lock with dead pid: reclaim once, then run.
- Stale lock with live pid: skip.
- State write failure: do not promote/report success; leave recoverable event if possible.

## Test Plan
Required tests before enablement:
- schema accepts valid parameter-only patch
- schema rejects unknown key
- schema rejects out-of-range value
- schema rejects wrong type
- schema rejects too many params
- schema rejects duplicate fingerprint
- canonical fingerprint stable across key order
- ledger append is append-only
- orphaned running candidate becomes abandoned
- compact memory pruning respects byte/count caps
- prompt builder stays below byte budget
- scheduler lock skips fresh lock
- scheduler lock reclaims stale dead pid lock
- lock release is token-safe
- runner never calls promotion in v1
- runner records exact immutable manifest path
- provider failure exits cleanly
- fixed budget timeout records timeout and moves on

Verification commands should include focused node tests and `git diff --check`.

## Implementation Phases
1. Spec and config skeleton.
2. Schema/fingerprint validator with tests.
3. Ledger and compact memory with tests.
4. Prompt/context builder with byte caps.
5. Provider abstraction with file/mock mode first.
6. Runner that validates and executes a queued/file candidate.
7. OpenClaw/LLM proposal mode.
8. Windows scheduler wrappers and installer.
9. Digest/reporting.
10. End-to-end dry run on one fixed-budget candidate.
11. Enable scheduled LLM run only after safety tests pass.

## Explicit Non-Goals For V1
- No PineScript structure changes.
- No JavaScript autoresearch self-modification.
- No automatic champion promotion.
- No dependency on OpenClaw cron for Windows scheduler correctness.
- No broad rewrite of current autoresearch.
- No loading full historical research corpus into every prompt.
- No multi-agent swarm in scheduler path.

## Open Questions
- Which LLM provider should be first-class for `openclaw` mode?
- What exact initial parameter allowlist should be exposed?
- Should the LLM lane evaluate one candidate per scheduled run or allow a small batch of two?
- What fixed budget is acceptable on the current machine: 10, 15, or 20 minutes?

## Recommended Defaults
- Start with one candidate per run.
- 15-minute fixed slot.
- Auto-run enabled.
- Auto-promote disabled.
- Separate LLM scheduler disabled by default until manually installed.
- OpenClaw integration advisory only.
- Compact memory under 256 KB.
- Prompt under 16 KB.
- Add manual review notification when candidate beats champion gates.
