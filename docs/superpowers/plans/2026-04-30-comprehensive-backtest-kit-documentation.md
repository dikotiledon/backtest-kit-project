# Comprehensive Backtest Kit Documentation Plan

## Goal
Create a complete, navigable documentation set for this project so no implemented behavior is undocumented. Coverage includes the upstream Backtest Kit project scaffold, local Pine execution tools, optimizer/sweep/autoresearch system, promotion queue/locking, datasets/artifacts, scheduler ops, tests, and maintenance workflows.

## Non-goals
- No strategy/scoring/search/Pine behavior changes.
- No scheduler registration or live ops changes.
- No deletion of existing research/planning docs unless explicitly reviewed.
- No generated giant API dump; docs should be readable, structured, and linked.

## Documentation Architecture

Create/refresh these files:

1. `docs/README.md`
   - Documentation map and reading order.
   - Current vs historical docs distinction.
   - Quick links to user guides, Pine/autoresearch, operations, reference, development.

2. `docs/project-overview.md`
   - What this repo is: Backtest Kit scaffold + local research tooling.
   - Runtime modes from README: backtest, paper, live, walker, Pine, dump.
   - Major directories and ownership.
   - Safety model and where state/artifacts live.

3. `docs/cli-reference.md`
   - `npm` scripts from `package.json`.
   - Backtest Kit CLI flags already in README.
   - Local scripts: `fetch_docs`, Pine run/import, optimize, sweep, dataset, autoresearch.
   - Inputs, outputs, side effects, examples, and verification commands.

4. `docs/pine-tooling.md`
   - Pine file layout and import flattening.
   - `pine-import-run-clean.mjs`, `flatten-pine-imports.mjs`, `pine-optimize.mjs`, `pine-sweep.mjs`.
   - Datasets, optimizer metrics, expectancy, regime analysis, tuner helpers.
   - Common debug docs: `pine_debug.md`, `pine_indicator_warmup.md`.

5. `docs/pine-autoresearch.md`
   - End-to-end autoresearch workflow.
   - Profiles, config, pinned windows, search policy, track generation, fallback/self-loop escape.
   - Manifest/history/digest artifacts.
   - Promotion matrix, queue, manual promote, autopromote, exact manifest/runId promotion.
   - Locks: JS global lock, promotion queue, scheduler wrapper lock.
   - Failure recovery and safe operations.

6. `docs/artifacts-and-state.md`
   - `pine/autoresearch/<matrix>/` layout.
   - `latest.json`, `manifests/`, `history.jsonl`, `digest.md`, `state/`, `promotion-queue.jsonl`, scheduler lock files, temp files.
   - Artifact schema fields that tests assert.
   - Queue event schema and replay invariants.
   - Dataset pinned/staged/verified state.

7. `docs/operations.md`
   - Scheduled tasks install/remove scripts.
   - Micro/full/digest/autopromote tasks.
   - Wrapper lock behavior, stale reclaim, dry-run, logs.
   - Manual runbook: run cycle, digest, promote, autopromote, force-cycle, exact manifest promote.
   - Troubleshooting stale locks, malformed queues, overlapping tasks.

8. `docs/development.md`
   - Local setup, branch/worktree expectations, tests.
   - Test suites and what each covers.
   - How to safely extend Pine/autoresearch modules.
   - Documentation maintenance checklist.

9. `docs/reference/modules.md`
   - Source module inventory:
     - `scripts/lib/pine-autoresearch*.mjs`
     - dataset/optimizer/expectancy/regime/search-policy/track-generators/tuner
     - promotion queue and lock helpers
     - ops scripts
   - Public helper exports and responsibilities.
   - Where behavior is tested.

10. `docs/reference/schemas.md`
    - Config shape highlights from `config/pine-autoresearch.default.json`.
    - Manifest fields, matrix decision fields, queue event fields, lock owner fields.
    - Do not claim exhaustive JSON Schema unless generated; document operationally relevant fields.

11. `README.md`
    - Keep current quick start, but add link to `docs/README.md` and local Pine/autoresearch docs.
    - Avoid duplicating all docs in README.

## Execution Strategy
Use subagent-driven documentation. Each writing task owns a small doc set and may inspect source/tests. After each task: spec review then quality review. Main session integrates and verifies links.

## Tasks

### Task 1 — Docs hub + project overview
Files:
- `docs/README.md`
- `docs/project-overview.md`
- small README link update if needed

Requirements:
- Make documentation navigable.
- Explain current-vs-historical docs.
- Cover repo purpose, directory map, runtime modes, safety boundaries.
- Link to deeper docs that later tasks create.

### Task 2 — CLI and Pine tooling docs
Files:
- `docs/cli-reference.md`
- `docs/pine-tooling.md`

Requirements:
- Document all package scripts and local script entry points.
- Cover Pine run/import/optimize/sweep/dataset behavior.
- Include examples and side effects.
- Link existing `docs/backtest_*`, `docs/pine_debug.md`, `docs/pine_indicator_warmup.md`.

### Task 3 — Pine autoresearch docs
Files:
- `docs/pine-autoresearch.md`

Requirements:
- Comprehensive end-to-end explanation of autoresearch cycle/digest/promote/autopromote.
- Document current promotion queue + locking semantics from latest implementation.
- Include operational runbook and safe recovery notes.
- Mention known invariants: queue append-only, exact queued manifest, force rules, pending promotion pause, no latest.json race.

### Task 4 — Artifacts/state/schemas docs
Files:
- `docs/artifacts-and-state.md`
- `docs/reference/schemas.md`

Requirements:
- Document generated directories/files and lifecycle.
- Document manifest/queue/lock/digest/history fields enough for operators/devs.
- Include replay/error/orphan behavior for promotion queue.
- Include config highlights.

### Task 5 — Operations docs
Files:
- `docs/operations.md`

Requirements:
- Scheduled task install/remove/run wrappers.
- MultipleInstances IgnoreNew + wrapper scheduler lock + JS canonical lock.
- Logs, dry-run, stale reclaim, overlap behavior.
- Manual task commands and troubleshooting.

### Task 6 — Development/reference docs
Files:
- `docs/development.md`
- `docs/reference/modules.md`

Requirements:
- Document test suites and development workflow.
- Module-by-module reference of local code and responsibilities.
- Safe extension rules and documentation checklist.

### Task 7 — Integration pass
Files:
- all docs above + README

Requirements:
- Check link consistency and duplicate/conflicting statements.
- Ensure every implementation area has at least one doc home.
- Run markdown/static checks where practical.
- Run targeted tests if source untouched should still pass quickly.

## Verification
- `git diff --check`
- Link/path sanity script for docs links.
- `node --test tests/pine-autoresearch-lock.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs` if docs changes touch examples near behavior or after final integration.
- Manual spot-check docs for stale references.

## Exit Condition
- Comprehensive docs exist and are linked from README/docs hub.
- No local implementation area remains undocumented.
- Final review approves coverage and correctness.
