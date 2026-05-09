# Pine Autoresearch Duplicate Sweep Guard — Hardening Execution Spec

> Purpose: turn the 2026-05-09 adversarial findings into a strict subagent-driven remediation plan. This document is intentionally defensive. Implementers must not code around symptoms, weaken guards, or assume tests prove production behavior unless the exact artifact path and failure mode are covered.

## 0. Current Verdict

**Branch status:** `fix/duplicate-sweep-guard` is **not completion-safe**.

The existing patch fixed the narrow deterministic repeat generator, but adversarial review found production blockers:

1. Exhausted `globalAllParameter` can self-loop forever.
2. Exhausted skip finalizes manifest/scout but skips normal history/digest finalization.
3. Exhausted history events have a weaker schema than normal cycle events.
4. Novelty evidence is bounded by recent manifest window and can forget older tested patches.
5. Patch fingerprints bind to champion `configId`, not actual champion config fingerprint.
6. Legacy global manifests without `patchFingerprint` are invisible to the guard.
7. Stored fingerprints are trusted without validation/reconstruction.
8. Production invariant can pass vacuously in the worktree.
9. Tests miss realistic failure modes.
10. Exhausted markdown can render undefined primary run directory.
11. Sweep normalization currently strips `patchFingerprint` / `metadata`, so reviewers must verify whether sweep-internal records need to preserve novelty evidence or whether manifest reconstruction after sweep is the only intended source of truth.

**Non-negotiable:** no merge, PR, or completion claim until all blockers are fixed and independently reviewed.

---

## 1. Execution Model

Use `subagent-driven-development`.

Main controller responsibilities:

- Own branch state and final integration.
- Dispatch one implementer per phase.
- Dispatch two reviewers after each phase:
  1. **Spec reviewer:** verifies exact requirements and tests.
  2. **Logic/adversarial reviewer:** hunts assumptions, edge cases, and production-path gaps.
- Independently inspect diffs and run the required verification before commits.
- Never accept "tests pass" when the test is vacuous, scoped to temp fixtures only, or avoids the production artifact path being claimed.

Subagent rules:

- Worktree: `D:/Code/Experiment/backtest-kit-project/.worktrees/duplicate-sweep-guard`.
- Default: no commits by subagents unless main prompt explicitly allows.
- No full autoresearch cycle/sweep without explicit user approval.
- Do not edit `config/pine-autoresearch.default.json` unless specifically assigned and approved.
- No broad rewrites. Preserve current behavior for non-global lanes unless explicitly changed.
- Red/green required for each new regression when practical.
- Return exact files changed, commands run, result summaries, and residual risks.

Reviewer rules:

- Reviewer must not summarize what works first.
- Reviewer output starts with `FINDINGS:`.
- Every finding needs severity, file/logic reference, evidence, impact, and recommended fix.
- Reviewer must reject if implementation relies on stale summaries, unvalidated artifact roots, or omitted production edge cases.

---

## 2. Global Acceptance Criteria

All are required.

### Correctness

- Same champion config plus already-tested global patch must never launch another global sweep, regardless of manifest age within retained production artifacts.
- Same config under a different `configId` must still be treated as same champion for global patch novelty.
- Changed config under same `configId` must not inherit stale patch bans from the old config.
- Exhausted `globalAllParameter` must not self-loop indefinitely.
- Exhausted global lane must produce a proper hold manifest and then force/enable a different next lane according to documented scheduler semantics.
- Exhausted skip must produce the same artifact finalization guarantees as normal cycles: latest pointer, manifest, JSONL history, history markdown, scout markdown, live digest, and pruning policy if applicable.
- Exhausted history event must preserve the normal cycle event schema with exhausted-specific values.
- Legacy manifests with enough information must be converted into equivalent tested patch fingerprints.
- Malformed stored fingerprints must not silently poison novelty state.
- Production invariant must fail when expected production artifacts are absent, unless explicitly running in fixture mode.

### Architecture

- Use canonical champion config fingerprint for novelty identity.
- Keep fingerprint generation deterministic and stable.
- Separate concerns:
  - patch/fingerprint math in global search helper,
  - evidence collection/reconstruction in autoresearch helper,
  - lane-exhaustion scheduling in scheduler/state helper,
  - artifact finalization in a shared finalizer helper.
- Avoid embedding production root assumptions directly in tests.
- Avoid duplicate manifest/history/digest finalization branches.

### Testing

Required new/updated test classes:

1. Bounded-window repeat: patch tested outside recent manifest window is still blocked.
2. Same config, new `configId`: duplicate blocked.
3. Same `configId`, changed config: useful patch not falsely blocked.
4. Legacy manifest reconstruction: missing `patchFingerprint` but present patch/config/family is collected.
5. Malformed fingerprint validation: mismatch ignored or corrected with clear behavior.
6. Exhausted skip finalization: `history.md`, `latest-digest.md`, `latest.json`, manifest, scout exist and are consistent.
7. Exhausted history schema parity with normal cycle event.
8. Exhausted lane fallback: next selector does not choose `globalAllParameter` immediately after exhaustion for same champion config.
9. Production invariant root resolution: test fails when artifacts are expected but missing; supports explicit fixture/env override.
10. Markdown exhausted rendering: no undefined primary run dir.
11. Sweep variant normalization: `normalizeVariantRecords()` behavior is explicitly tested/reviewed so patch fingerprint metadata is either preserved through sweep records or intentionally reconstructed later with no evidence loss.

---

## 3. Phase Breakdown

### Phase A — Identity and Fingerprint Hardening

**Goal:** remove `configId` as the primary novelty identity and bind global patch novelty to canonical champion config fingerprint.

Allowed files:

```text
scripts/lib/pine-global-search.mjs
scripts/pine-autoresearch.mjs
scripts/lib/pine-autoresearch*.mjs only if helper extraction is needed
tests/pine-global-search.test.mjs
tests/pine-autoresearch.test.mjs
```

Required implementation:

- Add/route a canonical `championConfigFingerprint` into `buildGlobalPatchFingerprint()` inputs.
- Fingerprint payload must include:
  - `championConfigFingerprint`,
  - lane canonicalized to one spelling,
  - mutation family,
  - normalized patch.
- Keep backward compatibility only for reading old manifests; new writes must use the new identity.
- Persist metadata with both human-debug identity and strict identity:
  - `originConfigId`,
  - `championConfigFingerprint`,
  - `patchFingerprintVersion`.

Tests required:

- Same config under new `configId` yields same patch fingerprint.
- Same `configId` with changed config yields different patch fingerprint.
- Key order does not affect fingerprint.
- Old fingerprint shape is not generated for new variants.

Implementation prompt:

```text
Implement Phase A only. Do not touch scheduler fallback or artifact finalization.

Read this file section Phase A and inspect current:
- scripts/lib/pine-global-search.mjs
- scripts/pine-autoresearch.mjs relevant champion source creation
- tests/pine-global-search.test.mjs
- tests/pine-autoresearch.test.mjs

Write regression tests first for:
1. same config + different configId => same global patch fingerprint
2. same configId + changed config => different global patch fingerprint
3. generated variant metadata includes championConfigFingerprint and patchFingerprintVersion

Then implement minimal changes. Do not make tests pass by weakening assertions.
Return files changed, red command/output summary, green command/output summary, and unresolved risks.
```

Spec reviewer prompt:

```text
Review Phase A for exact spec compliance. Reject if patch identity still depends primarily on configId, if metadata lacks championConfigFingerprint/version, or if tests only check configId behavior. Do not review style except where it affects spec.
```

Logic reviewer prompt:

```text
Adversarially review Phase A. Find edge cases where duplicates can still pass or useful patches can be falsely exhausted. Inspect canonicalization, lane spelling, patch normalization, and old/new manifest compatibility.
```

---

### Phase B — Novelty Evidence Store and Legacy Reconstruction

**Goal:** make novelty memory complete enough for production and robust against legacy data.

Allowed files:

```text
scripts/pine-autoresearch.mjs
scripts/lib/pine-global-search.mjs if reconstruction needs shared helpers
tests/pine-autoresearch.test.mjs
tests/pine-autoresearch-production-invariants.test.mjs
```

Required implementation:

- Replace bounded-only novelty with one of:
  1. cumulative per champion-config fingerprint state file, or
  2. scan all retained same champion-config post-fix manifests plus reconstructable legacy manifests.
- If state file is chosen, it must be updated only after successful completed/hold manifest finalization.
- Reconstruct missing fingerprint from legacy manifest when variant has enough evidence:
  - lane global spelling,
  - family/mutationFamily,
  - patch object, or config + champion config from which a patch can be derived.
- Explicitly review `normalizeVariantRecords()` / sweep variant-file ingestion. If sweep records intentionally drop `patchFingerprint` and `metadata`, prove that no downstream novelty collector depends on sweep-internal records; otherwise preserve the fields.
- Validate stored fingerprint against reconstructed fingerprint when enough evidence exists.
- Ignore or warn on malformed mismatch; do not let bogus strings poison state.
- Collect from history only if history event contains enough embedded evidence. Do not assume JSONL has full manifest.

Tests required:

- Patch tested more than `tabuBootstrapManifestLimit` manifests ago is still blocked.
- Legacy manifest with `{family, patch}` and no `patchFingerprint` is collected.
- Legacy manifest with variant config and champion config reconstructs patch fingerprint.
- Stored fingerprint mismatch does not block the reconstructed correct candidate.
- Corrupt/missing manifest remains non-fatal but cannot be used as proof of exhaustion.
- Sweep normalization either preserves `patchFingerprint` / `metadata` or tests prove manifest-level persistence/reconstruction remains complete without those fields.

Implementation prompt:

```text
Implement Phase B only. Do not change scheduler fallback or digest finalization.

Focus: collectTestedGlobalPatchFingerprints/loadRecentCompletedManifestsForNovelty and any new helper/state store needed.

Write red tests for:
1. old tested patch outside recent window is blocked
2. legacy no-fingerprint manifest is reconstructed
3. malformed stored fingerprint is rejected/ignored when reconstruction disagrees

Use canonical champion config fingerprint from Phase A. Do not trust configId-only matching. Do not silently broaden matching across different champion configs.
```

Spec reviewer prompt:

```text
Review Phase B. Reject if novelty remains bounded-only, legacy manifests remain invisible, malformed stored fingerprints are blindly trusted, matching still uses configId-only identity, or sweep normalization silently drops novelty evidence that later collectors need.
```

Logic reviewer prompt:

```text
Adversarially review Phase B for false positives, false exhaustion, stale/corrupt artifact behavior, concurrent pruning, and production root differences. Try to construct a duplicate older than the scan window.
```

---

### Phase C — Exhausted Lane Scheduling and Anti-Self-Loop

**Goal:** an exhausted `globalAllParameter` lane must not keep producing empty holds forever.

Allowed files:

```text
scripts/lib/pine-regime-exit-scheduler.mjs
scripts/lib/pine-autoresearch-tracks.mjs
scripts/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
```

Required implementation:

- Persist lane exhaustion keyed by champion config fingerprint and lane.
- Selector must consider exhausted lanes and choose a non-exhausted enabled lane when available.
- Exhaustion should be cleared when champion config changes or when configured reset conditions occur.
- Scheduler state must record enough evidence:
  - exhausted lane,
  - champion config fingerprint,
  - exhausted at timestamp/runId,
  - reason,
  - next selected lane or fallback reason.
- If all lanes are exhausted/disabled, produce an explicit terminal hold reason, not an accidental global retry.

Tests required:

- After one exhausted global hold, next lane is not `globalAllParameter` for same champion config when alternatives enabled.
- Champion config change clears/does not apply old global exhaustion.
- If only global lane is enabled and exhausted, result is explicit no-lane/terminal hold, not primary sweep.
- Budget debt/preferred lane logic cannot override exhaustion.

Implementation prompt:

```text
Implement Phase C only. Do not change fingerprint generation or artifact finalization except where needed to persist scheduler exhaustion state.

Write red tests proving current self-loop, then fix selector/state.
Do not solve by globally disabling globalAllParameter forever. Exhaustion is scoped to champion config fingerprint and lane.
```

Spec reviewer prompt:

```text
Review Phase C. Reject if globalAllParameter can still be selected after same-config exhaustion, if exhaustion never clears on champion config change, or if fallback can launch an unplanned sweep in the exhausted branch.
```

Logic reviewer prompt:

```text
Adversarially review scheduler interactions: stagnation level 1-3 priority, budget debt, enabled lanes, only-global-enabled config, and track rotation. Try to make it self-loop.
```

---

### Phase D — Exhausted Artifact Finalization Parity

**Goal:** exhausted skip must have the same artifact guarantees as a normal cycle.

Allowed files:

```text
scripts/pine-autoresearch.mjs
scripts/lib/pine-autoresearch.mjs
tests/pine-autoresearch.test.mjs
```

Required implementation:

- Extract shared finalization helper if needed; do not duplicate divergent branches.
- Exhausted skip must write/update:
  - manifest under `manifests/`,
  - `latest.json` pointer/content according to existing finalizer behavior,
  - `history.jsonl`,
  - `history.md`,
  - scout markdown,
  - `latest-digest.md`,
  - prune result if normal cycle would prune.
- Return shape must include paths comparable to normal cycle where applicable:
  - `manifestPath`,
  - `scoutPath`,
  - `liveDigestPath`,
  - `pruneResult` if run.
- History event must include normal cycle fields with exhausted values:
  - `steadyState`, `noChangeStreak`, `activeTrackId`, `windowSetId`, `noveltySignature`, `rotationTrigger`, `rotationReason`, `sameTrackCycleStreak`, `topCandidateSimilarity`, `promotionEligible`, `promotionEligibleReason`, `noNewCandidate`, `noNewCandidateStreak`, `stagnationLevel`, `stagnationReason`, `lastEscalatedAt`, `rejectedCandidateFingerprint`, plus global novelty fields.
- Markdown must render primary sweep as skipped, never undefined.

Tests required:

- Exhausted run creates/updates `history.md` and `latest-digest.md`.
- `latest.json` points to exhausted manifest and digest references same run.
- History JSONL event has schema parity with normal cycle fields.
- Return payload contains `scoutPath` and `liveDigestPath`.
- Scout markdown says primary sweep skipped with reason, no `undefined`.

Implementation prompt:

```text
Implement Phase D only. Do not change scheduler selection or fingerprint identity.

Write red integration test showing exhausted skip currently leaves digest/history markdown stale or absent. Then implement shared finalization/parity.
Do not remove existing normal finalization behavior.
```

Spec reviewer prompt:

```text
Review Phase D. Reject if exhausted branch still returns before history markdown/live digest are written, if history schema is weaker than normal cycle, or if markdown can print undefined run dir.
```

Logic reviewer prompt:

```text
Adversarially review artifact consistency: latest pointer, manifest path, digest content, previous manifest read, prune behavior, incomplete marker behavior, and failure handling when finalization partially fails.
```

---

### Phase E — Production Invariant Root and Non-Vacuous Tests

**Goal:** production tests must verify real intended artifact roots or explicit fixtures, never pass because files are absent.

Allowed files:

```text
tests/pine-autoresearch-production-invariants.test.mjs
scripts/lib/pine-autoresearch-artifacts.mjs if helper needed
package.json only if test script wiring is explicitly required
```

Required implementation:

- Resolve artifact root from config or explicit env var, e.g. `PINE_AUTORESEARCH_PRODUCTION_ROOT`.
- If production invariant mode is active and root is missing, fail with clear message.
- Provide fixture-mode tests for duplicate detection without relying on local production artifacts.
- Invariant must check post-fix real manifests for duplicate global patch fingerprints by champion config fingerprint.
- Invariant must report skipped/not-configured only when explicitly allowed by env/test mode.

Tests required:

- Missing expected root fails.
- Explicit fixture root passes/fails appropriately.
- Duplicate same champion config fingerprint fails.
- Legacy manifests are either reconstructed or explicitly excluded with documented reason; no silent early return.

Implementation prompt:

```text
Implement Phase E only. Make production invariants non-vacuous.

Do not hard-code worktree pine output as proof of production. Add explicit root resolution and fixture tests.
Reject silent early returns for missing latest/manifests unless a deliberate fixture/no-production mode is set.
```

Spec reviewer prompt:

```text
Review Phase E. Reject if tests can pass silently because production artifacts are absent, if root remains hard-coded to worktree output, or if duplicate checks still use configId only.
```

Logic reviewer prompt:

```text
Adversarially review root resolution and CI/local behavior. Ensure test does not become flaky but also cannot lie about checking production artifacts.
```

---

### Phase F — Final Integration and Full Verification

Owner: main controller, with final independent reviewers.

Required commands from clean worktree:

```bash
git status --short --branch
node --test tests/pine-global-search.test.mjs
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "globalAllParameter|exhausted|patchFingerprint|production|legacy|digest|history|scheduler"
node --test tests/pine-autoresearch-production-invariants.test.mjs
npm run test:pine:autoresearch:hardening
npm run pine:dataset:verify
git diff --check
git status --short --branch
```

If any command is too slow or environment-bound, main controller must state exact blocker and run the strongest available substitute. Do not claim completion from partial checks.

Final reviewers:

1. **Spec compliance final reviewer**
   - Checks every global acceptance criterion.
   - Must inspect diff, not only test output.
2. **Adversarial production reviewer**
   - Attempts to recreate original duplicate collapse.
   - Attempts stale artifact and self-loop scenarios.
   - Reviews production invariant non-vacuous behavior.
3. **Code quality reviewer**
   - Checks architecture, duplication, error handling, naming, and test overfit.

Final merge/disposition only allowed after all three reviewers approve and main controller reruns verification.

---

## 4. Cross-Phase Anti-Patterns That Must Be Rejected

Reject implementation if it does any of these:

- Uses `configId` alone as durable novelty identity.
- Treats absence of artifacts as success.
- Relies only on the last N manifests without a durable state/backfill strategy.
- Lets exhausted global lane fall back into a different sweep in the same selected-lane branch without explicit scheduler semantics.
- Lets exhausted global lane choose itself next cycle for same champion config.
- Writes latest manifest but skips live digest/history markdown.
- Emits history events with fewer fields than normal cycles.
- Stores unvalidated external strings as authoritative fingerprints.
- Fixes tests by filtering out hard cases.
- Adds broad catch blocks that hide data corruption without diagnostic evidence.
- Runs full autoresearch cycle to prove behavior without approval.
- Touches unrelated config or production artifacts.

---

## 5. Required Evidence Matrix

| Finding | Required proof after fix |
|---|---|
| Self-loop exhausted global lane | Test showing next selected lane is non-global or explicit terminal hold. |
| Stale digest/history on skip | Integration test checks `history.md` and `latest-digest.md` after exhausted skip. |
| Weak exhausted history schema | Test comparing exhausted event keys against required normal-cycle key set. |
| Bounded novelty window | Test with tested patch older than window still blocked. |
| ConfigId-bound fingerprint | Tests for same config/new ID and same ID/changed config. |
| Legacy invisible manifests | Tests reconstruct fingerprints from legacy patch/config data. |
| Malformed fingerprint poisoning | Test mismatch ignored/corrected, not trusted. |
| Vacuous production invariant | Test missing expected root fails; fixture duplicate fails. |
| Undefined markdown run dir | Test markdown contains explicit skipped reason and no `undefined`. |
| Sweep normalization strips evidence | Test/review proves `normalizeVariantRecords()` preserves fingerprint metadata or that manifest reconstruction covers the loss completely. |

---

## 6. Main Controller Checklist

- [ ] Confirm branch `fix/duplicate-sweep-guard` and worktree path.
- [ ] Confirm no unrelated dirty files before each phase.
- [ ] Dispatch Phase A implementer.
- [ ] Phase A spec review.
- [ ] Phase A logic review.
- [ ] Main verify and commit.
- [ ] Dispatch Phase B implementer.
- [ ] Phase B spec review.
- [ ] Phase B logic review.
- [ ] Main verify and commit.
- [ ] Dispatch Phase C implementer.
- [ ] Phase C spec review.
- [ ] Phase C logic review.
- [ ] Main verify and commit.
- [ ] Dispatch Phase D implementer.
- [ ] Phase D spec review.
- [ ] Phase D logic review.
- [ ] Main verify and commit.
- [ ] Dispatch Phase E implementer.
- [ ] Phase E spec review.
- [ ] Phase E logic review.
- [ ] Main verify and commit.
- [ ] Run Phase F full verification.
- [ ] Dispatch final spec, production, and quality reviewers.
- [ ] Re-run verification after final fixes.
- [ ] Only then report completion evidence and ask/act on merge disposition.

---

## 7. Final Completion Bar

Completion claim is allowed only if all are true:

- Every adversarial finding from 2026-05-09 is closed by code or explicitly superseded with evidence.
- Regression tests exist for every closed finding.
- Production invariant cannot pass vacuously.
- Full verification commands have fresh passing output.
- Final reviewers approve.
- Worktree has only intentional committed changes.
- User-visible final report separates verified facts from remaining risks.
