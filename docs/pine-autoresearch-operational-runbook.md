# Pine Autoresearch Operational Runbook

## Trust Rules

- Trust `manifests/<runId>.json` and `latest.json` only after pointer validation succeeds: `latest.json.runId` must resolve to canonical `manifests/<runId>.json`, canonical manifest body `runId` must match, and any `latest.json.manifestPath` must point at that canonical file.
- Treat malformed/empty/partial `latest.json` or missing/mismatched canonical manifest as fail-closed. Do not promote, autopromote, digest, or bootstrap champion state from the pointer copy.
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
2. Confirm `latest.json.runId` resolves through pointer validation to canonical `manifests/<runId>.json`; do not inspect only the `latest.json` body.
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

Never manually edit `latest.json` except verified backup/restore: restore both `latest.json` and canonical `manifests/<runId>.json`, then run pointer validation/tests before any promotion, autopromotion, digest, or bootstrap.

Do not hand-create successful manifests from raw evaluation directories. If a manifest is missing, mark the run incomplete or rerun the autoresearch cycle.

## Dataset Cache Provenance

- Use `npm run pine:dataset:stage --silent` to materialize pinned datasets into cache.
- Do not manually synthesize, fabricate, pad, or backfill candle/OHLCV files to make tests pass.
- If manual/local cache repair is used, document the upstream exchange/export source, date range, symbol, timeframe, checksum or retrieval command, then rerun `npm run pine:dataset:verify --silent` plus `npm run test:pine:autoresearch:hardening`.
- Tracked artifact/cache decision: keep provenance-bearing pinned datasets and generated manifests; clean or ignore anonymous cache blobs that cannot be traced to a staging command or verified backup.
