# Pine Autoresearch Cron Loop

## Goal

Turn the existing backtest-kit pine sweep infrastructure into a repeatable OpenClaw cron research loop that is safe enough to ship defaults from:

1. scout new challenger configs on a locked primary benchmark window
2. revalidate champion vs challenger across a shadow-lab matrix
3. persist champion/challenger history and matrix decisions
4. allow guarded auto-promotion only when matrix policy passes
5. keep research reproducible with pinned datasets instead of silent cache drift

This is autoresearch for the strategy config layer, not generic web browsing.

## Phase 3 extension

Phase 2 made the loop matrix-aware.

Phase 3 makes it operationally safer:
- pinned datasets per lab, stored as durable local artifacts
- bootstrap pinned datasets from existing local candle cache by default
- cache staging plus strict cache completeness checks before scout and evaluation runs
- `--noCache` runtime path so backtest-kit does not warm extra intervals during locked-window research
- scout profiles so micro cadence can use a smaller search budget than full cadence

## Phase 2 architecture

One global `pine/test.pine` default cannot safely auto-promote from independent per-symbol winners.

So the autoresearch loop uses:
- **primary lab**: discovers the best challenger via sweep
- **shadow labs**: revalidate that exact challenger config against the current champion
- **matrix policy**: decides whether promotion is safe enough
- **champion state**: durable shared current default config
- **history ledger**: append-only cycle and promotion log

## Base reused

The loop is built on the existing project primitives, not a second pipeline:

- `scripts/pine-import-run-clean.mjs`
- `scripts/pine-sweep.mjs`
- `scripts/lib/pine-tuner.mjs`
- `scripts/lib/pine-optimizer.mjs`
- locked seed champion artifact:
  - `pine/sweeps/fixed-window-fusion-v4-XRPUSDT-15m-10000-2026-04-21T10-30-00Z/best-config.json`

## Config

Tracked config:
- `config/pine-autoresearch.default.json`

Pinned dataset tooling:
- `scripts/lib/pine-dataset.mjs`
- `scripts/pine-dataset.mjs`

Current matrix:
- primary: `XRPUSDT 15m 10000 bars`
- shadows:
  - `BTCUSDT 15m 10000 bars`
  - `ETHUSDT 15m 10000 bars`
- shared anchor: `2026-04-21T10:30:00.000Z`
- exchange: `ccxt-exchange`
- scout grid: `phase3-core`

### Phase 3 strategy layer
Current phase 3 optimizer scope is intentionally narrow:
- add **Supertrend filter / flip confirm** as new entry gate
- add **ATR trailing stop** as new exit upgrade
- keep the rest of Fusion V4 locked as the base so search space stays controlled

### Scout profiles
- `full`: `maxConfigs=8`
- `micro`: `maxConfigs=2`

The new `phase3-core` grid is designed to stay optimizer-safe:
- always starts from the hardened Fusion V4 baseline
- only sweeps a small Supertrend parameter surface
- only sweeps a small ATR trailing parameter surface
- removes irrelevant params when a feature is disabled

Micro still uses the same locked window and matrix logic, but explores less config space per run.

### Promotion logic

#### Primary lab gates
- score delta >= `0.25`
- ROI delta >= `0`
- profit factor delta >= `0`
- max drawdown delta <= `0.75`
- trade count >= `150`
- trade ratio vs incumbent >= `0.75`

#### Shadow lab gates
Softer, used for generalization checks:
- score delta >= `0`
- ROI delta >= `-0.5`
- profit factor delta >= `-0.05`
- max drawdown delta <= `1.0`
- trade count >= `100`
- trade ratio vs incumbent >= `0.65`

#### Matrix policy
Promotion requires:
- primary lab recommendation = `promote`
- at least `1` shadow lab also recommends `promote`
- shadow pass ratio >= `0.5`
- candidate config must differ from current champion

#### Auto-promotion guard
Auto-promotion also requires:
- latest matrix decision = `promote`
- auto-promotion enabled in config
- promotion cooldown >= `24h`
- max `1` promotion per UTC day

## Commands

Scout matrix cycle:
```bash
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json
```

Micro scout:
```bash
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --profile micro
```

Digest latest run:
```bash
node scripts/pine-autoresearch.mjs digest --config config/pine-autoresearch.default.json
```

Manual promotion from latest manifest:
```bash
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json
```

Guarded auto-promotion:
```bash
node scripts/pine-autoresearch.mjs autopromote --config config/pine-autoresearch.default.json
```

Pin datasets for all labs from existing local cache:
```bash
node scripts/pine-dataset.mjs pin --config config/pine-autoresearch.default.json
```

Pin datasets from network only when explicitly needed:
```bash
node scripts/pine-dataset.mjs pin --config config/pine-autoresearch.default.json --source network
```

Stage pinned datasets into backtest-kit candle cache:
```bash
node scripts/pine-dataset.mjs stage --config config/pine-autoresearch.default.json
```

Verify pinned datasets plus cache completeness:
```bash
node scripts/pine-dataset.mjs verify --config config/pine-autoresearch.default.json
```

Force promotion:
```bash
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --force
```

## Runtime artifacts

Research state:
- `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/champion.json`
- `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/history.jsonl`
- `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/manifests/*.json`
- `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json`
- `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/evaluations/<run-id>/...`

Pinned datasets:
- `pine/datasets/pine-fusion-v4-core-15m-locked-window/<lab-id>.json`

Human-readable reports:
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/*.md`
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/history.md`

Raw sweep outputs still stay in:
- `pine/sweeps/<run-id>/`

Backtest-kit candle cache used for strict replay:
- `pine/dump/data/candle/ccxt-exchange/<symbol>/<timeframe>/<timestamp>.json`

## OpenClaw cron shape

### Scout job
Cadence: every 6 hours for full profile, optional higher cadence for micro profile

Behavior:
- run `pine-autoresearch.mjs cycle`
- or run `pine-autoresearch.mjs cycle --profile micro` for smaller high-cadence scouting
- quiet delivery
- stage pinned datasets into cache first
- require complete cache coverage for the exact locked window
- write manifest, matrix evaluation artifacts, and history
- do not patch `pine/test.pine`

### Digest job
Cadence: daily morning

Behavior:
- run `pine-autoresearch.mjs digest`
- announce concise matrix status to Telegram

### Auto-promotion job
Cadence: daily after digest

Behavior:
- run `pine-autoresearch.mjs autopromote`
- only patches `pine/test.pine` when all guards pass
- otherwise exits with a no-op summary

## Why this shape

Autoresearch should be aggressive at exploring and conservative at shipping.

Primary sweep finds opportunity.
Shadow labs reject brittle local winners.
Champion state keeps promotion deterministic.
History makes drift auditable.
Pinned data prevents silent window drift.
Auto-promotion stays guarded, not impulsive.

## Notes

- `scripts/pine-sweep.mjs` accepts `--when` and `--exchange`, so scout windows stay locked.
- Phase 3 adds `--no-cache`, `--require-cache-complete`, `--cache-root`, and `--cache-exchange` plumbing through the Pine run chain.
- Dataset pinning now uses existing local candle cache by default (`pinnedData.sourceMode=local-cache`) and only uses network when explicitly requested.
- When pinned data is enabled, autoresearch stages each lab dataset into `pine/dump/data/candle/...` and fails fast if any candle is missing, instead of silently refetching network data during the run.
- When full cross-symbol cache coverage is unavailable, an emergency fallback mode can temporarily trim the matrix to XRPUSDT only and anchor `when` to the latest proven local cache tail until one-time network backfill restores the full matrix.
- The config is backward-compatible in spirit with phase 1 and 2, but now also supports `pinnedData`, `defaultProfile`, and `scoutProfiles`.
- Runtime output dirs are ignored in `.gitignore`; only config, scripts, docs, and tests are meant to be committed.
