# Development

## Workflow

1. Read the docs hub and the relevant reference page.
2. Inspect the source module and its matching `tests/*.test.mjs` file.
3. Make the smallest behavior-safe change.
4. Add or update tests first when behavior changes.
5. Run the narrowest test set that proves the change.
6. Finish with `npm test` when the change is non-trivial.
7. Run `git diff --check` before commit.

## Local setup

- Run from the repo root.
- Use the repo’s Node/npm toolchain.
- Keep secrets in env files, not docs or committed config.
- Keep generated artifacts out of manual edits unless a task explicitly targets them.

## Test suites

`npm test` runs `node --test` across the repo.

High-value focused suites:

| Suite | Covers |
|---|---|
| `tests/pine-autoresearch-lock.test.mjs` | lock acquire/release, stale reclaim, token-safe release |
| `tests/pine-autoresearch-tracks.test.mjs` | track state, novelty signatures, rotation, scheduler state |
| `tests/pine-autoresearch.test.mjs` | matrix decision helpers, manifest selection, digest/rendering, promotion gating |
| `tests/pine-dataset.test.mjs` | pinned windows, cache materialization, dataset validation |
| `tests/pine-expectancy.test.mjs` | expectancy math and guard logic |
| `tests/pine-optimizer.test.mjs` | JSONL normalization, simulation, metrics, scoring |
| `tests/pine-promotion-queue.test.mjs` | append-only queue reduction and selection |
| `tests/pine-regime-analysis.test.mjs` | regime slices, asymmetry detection, markdown/artifact output |
| `tests/pine-track-generators.test.mjs` | track patch validation and candidate batch generation |
| `tests/pine-tuner.test.mjs` | grid selection, sweep combo ranking, patch planning |
| `tests/pine-phase3.test.mjs` | optimizer/tuner integration paths |
| `tests/pine-context.test.mjs` | context helpers and broader orchestration checks |

Targeted runs:

```bash
node --test tests/pine-autoresearch-lock.test.mjs
node --test tests/pine-autoresearch.test.mjs tests/pine-promotion-queue.test.mjs
node --test tests/pine-dataset.test.mjs tests/pine-optimizer.test.mjs tests/pine-tuner.test.mjs
```

## Safe extension rules

- Treat `scripts/lib/*.mjs` as the source of truth; wrappers should stay thin.
- Preserve lock semantics: exclusive acquire, stale reclaim, token-checked release.
- Preserve queue semantics: append-only events, exact manifest identity, oldest pending wins.
- Preserve dataset semantics: aligned windows, sequential candles, read-only verification paths.
- Preserve optimizer semantics: any scoring or metric change is behavior change and needs tests.
- Preserve tuner semantics: shared knob keys and patch planning must stay aligned across generators.
- Preserve autoresearch semantics: promotion gating, manifest selection, and queue interaction all need matching tests.
- Do not widen behavior without updating the matching `tests/*.test.mjs` file and this reference docs set.

## Documentation checklist

When you add or rename local code:

- update `docs/reference/modules.md`
- update `docs/reference/schemas.md` if fields or artifact shapes changed
- update `docs/cli-reference.md` if a command surface changed
- update `docs/operations.md` if a scheduler/wrapper path changed
- update `docs/pine-autoresearch.md` or `docs/pine-tooling.md` if workflow behavior changed
- add or update the matching `tests/*.test.mjs` coverage
- rerun the smallest proving test plus `npm test` if the change is cross-cutting
- finish with `git diff --check`

## Good change shape

- code change
- matching test change
- doc update
- diff check
- commit

If a change touches generated output only, document why that output is expected and where the behavior is actually tested.