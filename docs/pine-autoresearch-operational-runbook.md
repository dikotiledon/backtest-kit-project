# Pine Autoresearch Operational Runbook

## Trust Rules

- Trust `manifests/<runId>.json` and `latest.json` only when `latest.json.runId` has a matching manifest.
- Do not trust raw `evaluations/<runId>/` directories without a manifest.
- Raw evaluation dirs without manifest must have `incomplete/<runId>.json` before the system is considered clean.

## Before Scheduled Full Run

1. Run `npm run pine:dataset:verify --silent`.
2. Run `npm run test:pine:autoresearch:hardening`.
3. Confirm no active locks:
   - `tmp/pine-autoresearch-locks/scheduler.lock`
   - `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/autoresearch.lock.json`

## After Scheduled Full Run

1. Confirm wrapper log contains `[autoresearch] manifest=`.
2. Confirm `latest.json.runId` matches a manifest.
3. Confirm `shadowRegimeScoreboard.generatorSummary.previewOnly` is false for selected regime lane.
4. Confirm promotion did not bypass safety gates with `--force`.

## Force Promotion Policy

Force is allowed only for:

- `operator_blocked`
- `queue_blocked`

Force is never allowed for:

- `safety_failed`
- `expectancy_failed`
- `holdout_failed`
- `invalid`
- `stale`

## Recovery From Orphan Evaluation Dirs

Run dry-run first:

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs
```

If listed orphans are historical/incomplete, mark them:

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs --write
```

Never manually edit `latest.json` unless restoring from a verified manifest backup.

## Dataset Cache Provenance

- Use `npm run pine:dataset:stage --silent` to materialize pinned datasets into cache.
- Do not silently invent missing candles.
- If manual/local cache repair is used, document the source/provenance and rerun `npm run pine:dataset:verify --silent` plus `npm run test:pine:autoresearch:hardening`.
