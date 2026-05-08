# Pine Autoresearch Duplicate Sweep Guard — Subagent-Driven Execution Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. This document is the execution contract for dispatching, reviewing, integrating, and verifying subagent work. It does not replace the implementation plan; it controls how subagents execute it.

**Goal:** Execute the duplicate-sweep guard fix safely with isolated subagents, strict review gates, and no repeated autoresearch full sweeps.

**Architecture:** The main session owns orchestration, repository state, final synthesis, and commits only after review. Subagents receive one bounded task at a time, work inside the isolated feature worktree, return diffs plus evidence, and never declare final completion without main-session verification. The fix must prevent deterministic `globalAllParameter` repeats at the generation/selection boundary before variant-file write or sweep launch.

**Tech Stack:** Node.js ESM, built-in `node:test`, npm scripts, Git worktrees, Pine autoresearch scripts under `scripts/`, tests under `tests/`, plan under `docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-guard.md`.

---

## 1. Source of Truth

Primary implementation plan:

```text
D:/Code/Experiment/backtest-kit-project/docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-guard.md
```

This subagent execution spec is authoritative for delegation process only:

```text
D:/Code/Experiment/backtest-kit-project/docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-subagent-execution-spec.md
```

Subagents must obey both documents. If they conflict:

1. Direct user instruction wins.
2. This execution spec controls process, dispatch, review, and safety.
3. Duplicate-sweep guard implementation plan controls code changes.
4. Current code reality wins over stale plan snippets; subagent must report mismatch instead of improvising.

---

## 2. Problem Statement

Autoresearch is repeating identical challengers and sweeps.

Verified root cause:

- Scheduler selects `globalAllParameter` at stagnation level 1.
- `buildGlobalMutationBatch()` is deterministic for an unchanged champion.
- It emits the same six families repeatedly:
  - `entry`
  - `filters`
  - `risk`
  - `fusion-weight`
  - `asymmetry`
  - `exit-state`
- Historical duplicate variant files were raw-identical: `sha256 ac02b62d46392adb`.
- Manifests confirm these were real generated variants:
  - `candidateCount=6`
  - `previewOnly=false`
  - `countSource=generatedVariants`
  - `recommendation=hold`

This is a search-diversity collapse, not only a scheduler-lock issue.

---

## 3. Non-Negotiable Correctness Requirements

A subagent implementation is invalid if any item below is missed.

1. Same champion plus already-tested global patch fingerprint must not launch another sweep.
2. Empty `globalAllParameter` novelty result must not fall back to incumbent or track search in the same selected global-lane cycle.
3. Duplicate prevention must happen before writing variants and before `runPrimarySweep()`.
4. Novelty evidence must come from recent completed manifests, not only `history.jsonl`.
5. Champion fingerprinting must bind to champion identity using a source object with both `configId` and `config`.
6. `metadata.mutationFamily` must remain present; new metadata must not break existing tests.
7. Same-batch duplicate patches must be skipped with `emittedFingerprints`.
8. No-op patches that do not change champion config must be skipped.
9. Exhaustion must produce an explicit hold/skip manifest.
10. Exhaustion skip must update scheduler state with `nextTrackState()` and `writeSchedulerState()` before return.
11. Skip result shape must match existing code style: `{ skipped: true, reason: 'global-all-parameter-exhausted', ... }`.
12. New normal and exhausted manifests must include `globalNoveltyGuardVersion: 1`.
13. Production invariant must avoid old artifacts by using synthetic fixtures or `globalNoveltyGuardVersion >= 1` scope.
14. No full expensive autoresearch sweep may be launched during implementation unless user explicitly approves.
15. Dirty `config/pine-autoresearch.default.json` must not be included in commits unless user explicitly approves.

---

## 4. Repository and Worktree Rules

All subagent implementation work must happen in an isolated worktree.

Initial main-session setup command:

```bash
cd D:/Code/Experiment/backtest-kit-project
git status --short --branch
git branch --show-current
git worktree add .worktrees/duplicate-sweep-guard -b fix/duplicate-sweep-guard
cd .worktrees/duplicate-sweep-guard
git status --short --branch
```

Expected:

- Feature branch: `fix/duplicate-sweep-guard`.
- Worktree path: `D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard`.
- No implementation on `main`.
- The unrelated root config diff must remain outside feature commits.

If branch already exists:

```bash
cd D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard
git status --short --branch
```

If worktree is dirty from prior work:

- Main session inspects diff.
- Do not dispatch new implementer until dirty state is attributed to a completed task or reverted.

---

## 5. Scheduler and Sweep Safety

Before any implementation subagent runs, main session must inspect scheduler/process state.

Commands:

```bash
cd D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard
npm run pine:ops:scheduler-health
```

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pine-autoresearch' } | Select-Object ProcessId,CommandLine
```

Rules:

- If no active cycle: continue.
- If active `pine-autoresearch cycle`: pause implementation and ask user before killing or disabling anything.
- If scheduled task is enabled/runnable and could launch during implementation: ask user for approval to disable or use a maintenance window.
- Subagents may run unit tests and hardening tests.
- Subagents must not run full autoresearch cycles.
- Allowed commands include:
  - `node --test ...`
  - `npm run test:pine:autoresearch:hardening`
  - `npm run pine:dataset:verify`
- Disallowed without explicit approval:
  - commands that launch full `pine-autoresearch cycle`
  - task removal/disable commands
  - lock reclamation commands that affect live scheduler state

---

## 6. Subagent Operating Model

Use fresh subagent per task group.

Main session responsibilities:

1. Create/verify worktree.
2. Dispatch one implementer at a time for code-changing tasks.
3. Dispatch one reviewer after each implementer task.
4. Inspect returned diff directly.
5. Run verification commands itself or instruct reviewer to run focused commands.
6. Commit only after reviewer approval and main verification.
7. Keep `SESSION-STATE.md` updated at task boundaries.
8. Maintain final integration narrative.

Subagent responsibilities:

1. Read only assigned plan section and relevant source/tests.
2. Work only in assigned files.
3. Write failing tests first.
4. Run focused failure command and capture expected failure.
5. Implement minimal fix.
6. Run focused passing command.
7. Return exact summary:
   - files changed
   - tests added
   - commands run
   - pass/fail output summary
   - residual risk
8. Do not claim full task completion if tests did not run.
9. Do not touch config diff unless explicitly assigned.
10. Do not commit unless main prompt explicitly allows commit.

Default: subagents do not commit. Main session commits after review.

---

## 7. Required Subagent Sequence

### Phase 0 — Preflight Owner

Owner: main session only.

No subagent.

Exit criteria:

- Worktree ready.
- Scheduler/process state inspected.
- User approval obtained if scheduler must be paused.
- Implementation plan and this spec present in worktree.

---

### Phase 1 — Global Generator Implementer

Plan tasks covered:

- Task 1: patch fingerprints.
- Task 2: deterministic ladders.
- Task 3: novelty filter, same-batch de-dupe, no-op skip.

Files allowed:

```text
scripts/lib/pine-global-search.mjs
tests/pine-global-search.test.mjs
```

Forbidden files:

```text
scripts/pine-autoresearch.mjs
config/pine-autoresearch.default.json
pine/autoresearch/**
report/**
```

Required tests:

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "patchFingerprint|ladder variants|previously tested|de-dupes same-batch"
node --test tests/pine-global-search.test.mjs
```

Acceptance gates:

- `patchFingerprint` is 64-char SHA-256.
- Fingerprint stable across object key order.
- Fingerprint includes champion identity, lane, mutation family, and normalized patch.
- `metadata.mutationFamily` preserved.
- `metadata.patchFingerprint` present.
- Ladder emits deterministic p-level variants.
- `testedPatchFingerprints` filters previously tested patches.
- `emittedFingerprints` filters duplicates in one batch.
- No-op patches are skipped.
- Existing tests still pass.

Implementer prompt:

```text
Implement Phase 1 only in worktree D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard.

Read:
- docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-guard.md sections Task 1-3
- docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-subagent-execution-spec.md Phase 1
- scripts/lib/pine-global-search.mjs
- tests/pine-global-search.test.mjs

Do TDD exactly:
1. Add failing tests for patchFingerprint, deterministic ladders, testedPatchFingerprints, same-batch de-dupe, and no-op skip.
2. Run focused tests and capture failing result.
3. Implement minimal code in scripts/lib/pine-global-search.mjs.
4. Run focused tests and full tests/pine-global-search.test.mjs.

Do not edit other files. Do not commit.

Return:
VERDICT_READY_FOR_REVIEW: yes/no
FILES_CHANGED:
TESTS_ADDED:
COMMANDS_RUN:
RESULTS:
RESIDUAL_RISK:
```

Reviewer prompt:

```text
Review Phase 1 diff only. Do not edit files.

Check:
- No files outside scripts/lib/pine-global-search.mjs and tests/pine-global-search.test.mjs changed.
- Patch fingerprints are stable and include champion identity.
- metadata.mutationFamily is preserved.
- testedPatchFingerprints works.
- emittedFingerprints exists and prevents same-batch duplicate fingerprints.
- no-op patches are skipped.
- deterministic ladder behavior is reproducible.
- Tests actually fail before and pass after, according to implementer evidence.

Run if needed:
node --test tests/pine-global-search.test.mjs

Return:
VERDICT: APPROVE or BLOCK
BLOCKERS:
NON_BLOCKING:
COMMANDS_RUN:
```

Main commit after approval:

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "feat(pine): add novel global search patch generation"
```

---

### Phase 2 — Manifest Novelty Loader Implementer

Plan tasks covered:

- Task 4: extract tested fingerprints from manifests/history.

Files allowed:

```text
scripts/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
```

Required tests:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "collectTestedGlobalPatchFingerprints|loadRecentCompletedManifestsForNovelty"
```

Acceptance gates:

- `collectTestedGlobalPatchFingerprints()` accepts `manifests` and future `historyEvents[].manifest`.
- It filters by same champion identity.
- It accepts both lane names:
  - `globalAllParameter`
  - `global-all-parameter`
- It collects both direct and metadata fingerprints.
- `loadRecentCompletedManifestsForNovelty()` reads from `manifestsDir(config)`.
- It uses existing `readJson()` helper.
- It tolerates missing/malformed manifest files without crashing the cycle.
- It does not depend on current `history.jsonl` containing full manifests.

Implementer prompt:

```text
Implement Phase 2 only in worktree D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard.

Read:
- implementation plan Task 4
- execution spec Phase 2
- scripts/pine-autoresearch.mjs relevant helpers/imports
- tests/pine-autoresearch.test.mjs relevant helper tests

Do TDD:
1. Add failing tests for collectTestedGlobalPatchFingerprints with manifest array and same-champion filtering.
2. Add failing test for loadRecentCompletedManifestsForNovelty using a temporary manifest directory/config object if feasible.
3. Run focused tests and capture failure.
4. Implement helpers using existing readJson() and manifestsDir(config).
5. Run focused tests.

Do not wire cycle yet. Do not commit.

Return required structured summary.
```

Reviewer prompt:

```text
Review Phase 2 diff only. Do not edit files.

Check helper correctness, imports, and test isolation. Ensure no full cycle/sweep command is introduced. Ensure malformed manifests are safely ignored and old history-only logic is not the only source.

Run:
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "collectTestedGlobalPatchFingerprints|loadRecentCompletedManifestsForNovelty"

Return APPROVE/BLOCK with blockers.
```

Main commit after approval:

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): load global novelty evidence from manifests"
```

---

### Phase 3 — Regime Batch Wiring Implementer

Plan tasks covered:

- Task 5: wire novelty filter into regime-aware batch generation.
- First part of Task 6: pass manifest-derived evidence to generator summary.

Files allowed:

```text
scripts/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
```

Required tests:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "skips duplicate globalAllParameter|exhausted globalAllParameter|does not fall back"
```

Acceptance gates:

- Main cycle passes `championSource = { configId: championState.configId, config: championState.config }`.
- `recentManifestsForNovelty` loaded before `buildRegimeAwareSearchBatch()`.
- `buildRegimeAwareSearchBatch()` passes manifest-derived fingerprints to `buildGlobalMutationBatch()`.
- If selected lane is `globalAllParameter`, it returns generated candidates directly, including `[]`.
- Empty `globalAllParameter` result does not become incumbent/track fallback before exhaustion guard.
- `summarizeRegimeLaneGenerator()` can receive `testedPatchFingerprints` or `recentManifestsForNovelty`.
- Exhaustion count source becomes `exhausted` when known fingerprints exist and generated lane variants are empty.

Implementer prompt:

```text
Implement Phase 3 only. No full sweep. No commits.

Read implementation plan Tasks 5-6 and execution spec Phase 3.

Write tests first:
- consecutive same-champion globalAllParameter history/manifests skip prior fingerprints
- all tested fingerprints for selected globalAllParameter returns []
- buildRegimeExitStateForScout reports generatorSummary.countSource='exhausted' using manifest-derived evidence

Then implement:
- championSource with configId + config
- recentManifestsForNovelty load/pass-through
- buildRegimeAwareSearchBatch direct return for selected globalAllParameter
- summarizeRegimeLaneGenerator tested fingerprint evidence

Run focused test command. Return structured summary.
```

Reviewer prompt:

```text
Review Phase 3 diff only. Do not edit files.

Block if:
- empty globalAllParameter can still fall back before guard
- exhaustion uses only historyEvents
- champion identity is lost
- tests do not prove [] result for exhausted selected global lane

Run focused test command if needed. Return APPROVE/BLOCK.
```

Main commit after approval:

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): wire global novelty into autoresearch batches"
```

---

### Phase 4 — Exhausted Skip Guard Implementer

Plan tasks covered:

- Task 6 final summary behavior.
- Task 7 pre-sweep skip guard.

Files allowed:

```text
scripts/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
```

Required tests:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "globalAllParameter.*exhausted|skips primary sweep|scheduler state"
```

Acceptance gates:

- Pure helper `shouldSkipGlobalAllParameterSweep()` exists and is tested.
- Pure helper `buildGlobalAllParameterExhaustedManifest()` exists and is tested.
- Guard is evaluated before variant file write and before `runPrimarySweep()`.
- Guard is evaluated before empty global lane can fall back to fallback variants.
- Exhausted manifest has:
  - `globalNoveltyGuardVersion: 1`
  - `searchPlan.variantCount: 0`
  - `searchPlan.variants: []`
  - `matrixDecision.recommendation: 'hold'`
  - `matrixDecision.reason: 'global-all-parameter-exhausted'`
  - regime scoreboard/generator summary evidence
- Skip path calls `nextTrackState()` and `writeSchedulerState()`.
- Skip return shape is `{ skipped: true, reason: 'global-all-parameter-exhausted', manifest, manifestPath }`.
- No variant file is written in exhausted skip branch unless existing artifact lifecycle requires it; if written, it must be empty and explicitly justified.
- `runPrimarySweep()` is not called in exhausted skip tests.

Implementer prompt:

```text
Implement Phase 4 only. No full sweep. No commits.

Read implementation plan Tasks 6-7 and execution spec Phase 4.

Do TDD:
1. Add tests for shouldSkipGlobalAllParameterSweep.
2. Add tests for buildGlobalAllParameterExhaustedManifest.
3. Add a cycle-boundary/seam test or pure orchestration test proving runPrimarySweep is not called when selected global lane is exhausted.
4. Add assertion scheduler state is updated in exhausted skip path or helper receives state update input.
5. Run failing focused tests.
6. Implement guard at actual boundary before writeJson(variantFilePath, searchVariants) and before runPrimarySweep().
7. Run passing focused tests.

Do not edit global-search files. Do not commit.

Return structured summary.
```

Reviewer prompt:

```text
Review Phase 4 diff only.

Block if:
- guard checks searchVariants after fallback replacement
- runPrimarySweep can still run for exhausted global lane
- scheduler state is not persisted
- skip return shape uses status:'skipped'
- globalNoveltyGuardVersion missing
- final manifest/latest pointer lifecycle bypasses finalizeAutoresearchManifest

Run focused tests. Return APPROVE/BLOCK.
```

Main commit after approval:

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): skip exhausted duplicate global sweeps"
```

---

### Phase 5 — Manifest Evidence and Production Invariant Implementer

Plan tasks covered:

- Task 8: manifest evidence.
- Task 9: production invariant against duplicate post-fix manifests.

Files allowed:

```text
scripts/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
tests/pine-autoresearch-production-invariants.test.mjs
```

Required tests:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "persists global patch fingerprints|globalNoveltyGuardVersion"
node --test tests/pine-autoresearch-production-invariants.test.mjs --test-name-pattern "globalAllParameter"
```

Acceptance gates:

- Normal manifests include `globalNoveltyGuardVersion: 1`.
- Exhausted manifests include `globalNoveltyGuardVersion: 1`.
- `searchPlan.variants[]` persists:
  - `variantId`
  - `lane`
  - `family`
  - `patch`
  - `patchFingerprint`
  - `metadata`
  - `config`
- Production invariant uses synthetic fixtures or filters to `globalNoveltyGuardVersion >= 1`.
- Invariant does not fail on known old duplicate artifacts.

Implementer prompt:

```text
Implement Phase 5 only. No full sweep. No commits.

Read plan Tasks 8-9 and execution spec Phase 5.

Add tests first for manifest fields and invariant scoping. Use inline fixtures; do not rely on old production artifacts unless filtering by globalNoveltyGuardVersion >= 1.

Implement minimal manifest mapping/version marker changes.

Run required tests. Return structured summary.
```

Reviewer prompt:

```text
Review Phase 5 diff only.

Block if invariant can fail on old historical manifests, if version marker missing, or if manifest variant metadata is stripped.

Run required tests. Return APPROVE/BLOCK.
```

Main commit after approval:

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
git commit -m "test(pine): guard post-fix global novelty manifests"
```

---

### Phase 6 — Full Verification Reviewer

Plan tasks covered:

- Task 10: full verification gate.

No implementation changes unless failures reveal missed implementation.

Commands:

```bash
node --test tests/pine-global-search.test.mjs tests/pine-regime-exit-scheduler.test.mjs
npm run test:pine:autoresearch:hardening
npm run pine:dataset:verify
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "duplicate|globalAllParameter|exhausted|fingerprint|globalNoveltyGuardVersion"
git status --short --branch
```

Acceptance gates:

- Focused tests pass.
- Hardening suite passes.
- Dataset verify passes.
- No full sweep launched.
- Dirty files are only intended implementation/test/spec files.
- `config/pine-autoresearch.default.json` is not staged unless explicitly approved.

Verification prompt:

```text
Run Phase 6 verification only. Do not edit files unless a command failure is clearly caused by a typo in the tests from this branch, and report before editing.

Commands:
node --test tests/pine-global-search.test.mjs tests/pine-regime-exit-scheduler.test.mjs
npm run test:pine:autoresearch:hardening
npm run pine:dataset:verify
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "duplicate|globalAllParameter|exhausted|fingerprint|globalNoveltyGuardVersion"
git status --short --branch

Return:
VERDICT: APPROVE or BLOCK
COMMAND_RESULTS:
DIRTY_FILES:
BLOCKERS:
```

Main final commit if fixes were needed:

```bash
git add scripts/lib/pine-global-search.mjs scripts/pine-autoresearch.mjs tests/pine-global-search.test.mjs tests/pine-autoresearch.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
git commit -m "fix(pine): prevent duplicate autoresearch sweeps"
```

---

## 8. Review Discipline

Every implementation phase requires a separate reviewer.

Reviewer must block on:

- unverified tests
- wrong file edits
- broad refactor unrelated to task
- hidden full sweep run
- fallback still possible for exhausted global lane
- manifest-derived novelty evidence missing
- scheduler state not updated on exhausted skip
- old artifacts causing invariant failure
- config diff contamination

Reviewer must not approve based only on summary. Reviewer should inspect diff and run at least focused tests when possible.

If reviewer times out or returns no findings:

- Treat as no review.
- Re-dispatch with narrower prompt once.
- If second reviewer fails, main session performs local review and clearly labels it as local, not subagent approval.

---

## 9. Integration Commit Policy

Default commit cadence:

1. Phase 1 commit after review.
2. Phase 2 commit after review.
3. Phase 3 commit after review.
4. Phase 4 commit after review.
5. Phase 5 commit after review.
6. Final fix commit only if verification changes were needed.

Commit messages:

```text
feat(pine): add novel global search patch generation
feat(pine): load global novelty evidence from manifests
feat(pine): wire global novelty into autoresearch batches
fix(pine): skip exhausted duplicate global sweeps
test(pine): guard post-fix global novelty manifests
fix(pine): prevent duplicate autoresearch sweeps
```

Before each commit:

```bash
git status --short
git diff --stat
git diff -- config/pine-autoresearch.default.json
```

If config diff appears staged:

```bash
git restore --staged config/pine-autoresearch.default.json
```

Do not run `git reset --hard` unless main session explicitly decides rollback for the feature worktree.

---

## 10. Failure and Rollback Protocol

If a phase fails tests after two implementer attempts:

1. Stop dispatching implementers.
2. Dispatch a diagnosis-only subagent with no edit permission.
3. Main session reviews diagnosis.
4. Either patch plan/spec or ask user for decision.

If a phase introduces broad unrelated failures:

```bash
git status --short
git diff --stat
```

Then either:

- revert only the last phase changes before commit, or
- if already committed on feature branch, use:

```bash
git revert <bad_commit_sha>
```

Avoid:

```bash
git reset --hard
```

unless there is no uncommitted useful work and main session explicitly records rollback reason.

Never reset `main`.

---

## 11. Final Acceptance Criteria

The whole subagent-driven execution is complete only when all are true:

1. Feature branch is not `main`.
2. All phase commits reviewed.
3. Focused and full verification commands pass.
4. No full autoresearch sweep was launched without approval.
5. `config/pine-autoresearch.default.json` unrelated diff not committed.
6. Duplicate root cause is fixed at generation/selection boundary.
7. Exhausted `globalAllParameter` does not fallback to another sweep.
8. Scheduler state advances on exhausted skip.
9. New manifests carry `globalNoveltyGuardVersion: 1`.
10. Post-fix invariant cannot fail on old artifacts.
11. Final response includes commands run and pass/fail evidence.

---

## 12. Main-Session Execution Checklist

Use this checklist while orchestrating.

- [ ] Read this spec.
- [ ] Read implementation plan.
- [ ] Create/enter worktree.
- [ ] Inspect scheduler/process state.
- [ ] Dispatch Phase 1 implementer.
- [ ] Review Phase 1 with subagent.
- [ ] Main verify and commit Phase 1.
- [ ] Dispatch Phase 2 implementer.
- [ ] Review Phase 2 with subagent.
- [ ] Main verify and commit Phase 2.
- [ ] Dispatch Phase 3 implementer.
- [ ] Review Phase 3 with subagent.
- [ ] Main verify and commit Phase 3.
- [ ] Dispatch Phase 4 implementer.
- [ ] Review Phase 4 with subagent.
- [ ] Main verify and commit Phase 4.
- [ ] Dispatch Phase 5 implementer.
- [ ] Review Phase 5 with subagent.
- [ ] Main verify and commit Phase 5.
- [ ] Run Phase 6 full verification.
- [ ] Resolve blockers or final commit.
- [ ] Report final evidence.

---

## 13. Self-Review

Spec coverage:

- Covers global generator changes.
- Covers manifest novelty loader.
- Covers regime-aware batch wiring.
- Covers exhausted skip guard.
- Covers manifest evidence and production invariant.
- Covers scheduler/process safety.
- Covers review, commit, rollback, and verification.

Placeholder scan:

- No `TBD`.
- No `TODO`.
- No undefined fake helper names required for implementation.
- No instruction to run full sweep.

Type consistency:

- Uses `patchFingerprint`, `metadata.patchFingerprint`, `metadata.mutationFamily`, `globalNoveltyGuardVersion`, `testedPatchFingerprints`, `recentManifestsForNovelty`, `shouldSkipGlobalAllParameterSweep`, and `buildGlobalAllParameterExhaustedManifest` consistently.

Known residual risk:

- Exact function signatures in `scripts/pine-autoresearch.mjs` may require minor adaptation during implementation because the file is large and existing helper shape is complex. Subagents must report source mismatch instead of inventing parallel logic.
