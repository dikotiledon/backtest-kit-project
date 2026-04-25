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
- tracked seed bootstrap:
  - `config/pine-autoresearch.seed.json`

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
Current phase 3 optimizer scope is broader, but still curated rather than brute-force:
- keep the hardened Fusion V4 baseline as the anchor
- expand search across ML/filter, kernel, entry-gating, Supertrend, and exit-management knobs
- use a curated rotating variant list instead of naive full cartesian expansion, so hourly scouts explore new territory without blowing memory
- keep non-strategy / display inputs out of the champion loop

### Phase 3 context layer
- AVWAP context qualifies baseline directional state.
- Breakout context confirms or degrades that state.
- Context modules default to transparent/disabled behavior until explicitly enabled by tuned configs.
- Exit shaping only tightens trailing behavior or allows earlier signal exits; it never weakens hard SL/TP controls.

## Search policy

The scheduler now uses an incumbent-local search policy instead of a broad static grid.

- 80% of each cycle budget is spent on exploit variants near the current champion.
- 20% is spent on explore variants from the same frozen architecture family.
- Strategy architecture stays fixed around the current V4 champion unless `searchPolicy.freezeArchitecture` is explicitly disabled.
- The primary sweep keeps a Pareto shortlist; the matrix phase can promote a robust shortlist survivor even when it is not the single best primary-lab score.

Detailed input audit:
- `docs/2026-04-22-pine-phase3-input-audit.md`

### Scout profiles
- `full`: `maxConfigs=8`
- `micro`: `maxConfigs=2`

## Search policy

The scheduler now uses an incumbent-local search policy instead of a broad static grid.

- 80% of each cycle budget is spent on exploit variants near the current champion.
- 20% is spent on explore variants from the same frozen architecture family.
- Strategy architecture stays fixed around the current V4 champion unless `searchPolicy.freezeArchitecture` is explicitly disabled.
- The primary sweep keeps a Pareto shortlist; the matrix phase can promote a robust shortlist survivor even when it is not the single best primary-lab score.

The new `phase3-core` grid is designed to stay optimizer-safe:
- always starts from the hardened Fusion V4 baseline
- covers broader ML/filter/kernel/Phase-3/exit knobs
- uses explicit rotating candidate batches so `maxConfigs` does not keep re-testing the same front slice
- removes irrelevant params when a feature is disabled

Micro still uses the same matrix logic, but explores a smaller rotating batch when used manually.

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
- current-window shadows:
  - score delta >= `0`
  - ROI delta >= `-0.5`
  - profit factor delta >= `-0.05`
  - max drawdown delta <= `1.0`
  - trade count >= `100`
  - trade ratio vs incumbent >= `0.65`
- older-window shadows use slightly looser trade/drawdown gates to account for smaller windows:
  - March shadows: min trade count `80`, trade ratio `0.6`, max drawdown delta `1.25`
  - February shadow: min trade count `60`, trade ratio `0.55`, max drawdown delta `1.5`

#### Matrix policy
Promotion requires:
- primary lab recommendation = `promote`
- at least `3` shadow labs also recommend `promote`
- shadow pass ratio >= `0.6`
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
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/latest-digest.md`
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/history.md`

Raw sweep outputs still stay in:
- `pine/sweeps/<run-id>/`

Backtest-kit candle cache used for strict replay:
- `pine/dump/data/candle/ccxt-exchange/<symbol>/<timeframe>/<timestamp>.json`

## OpenClaw cron shape

### Recommended cadence
- **Full scout**: hourly
- **Micro scout**: disable when the objective is broad exploration instead of short-loop regression checking
- **Digest**: optional, because `latest-digest.md` refreshes after each scout already
- **Autopromote**: daily at 08:20 local machine time, opt-in only

### Windows task wrappers
Concrete wrappers now live in:
- `scripts/ops/pine-autoresearch-micro.ps1`
- `scripts/ops/pine-autoresearch-full.ps1`
- `scripts/ops/pine-autoresearch-digest.ps1`
- `scripts/ops/pine-autoresearch-autopromote.ps1`
- `scripts/ops/install-pine-autoresearch-tasks.ps1`
- `scripts/ops/remove-pine-autoresearch-tasks.ps1`

Installer entrypoints:
```bash
npm run pine:ops:install-tasks
npm run pine:ops:remove-tasks
```

Preview install without changing scheduler:
```bash
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -WhatIf
```

Install micro + digest only:
```bash
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1
```

Install hourly full only:
```bash
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -FullEveryHours 1 -DisableMicro -DisableDigest
```

Install full cadence with a custom hourly interval while keeping other jobs enabled:
```bash
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -FullEveryHours 1
```

Install autopromote too:
```bash
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableAutopromote
```

### Scout job
Behavior:
- hourly production cadence runs `pine-autoresearch.mjs cycle`
- manual micro remains available for spot checks, but is not the default production scheduler shape
- quiet delivery
- stage pinned datasets into cache first
- require complete cache coverage for every pinned lab window
- rotate candidate batches across cycles instead of re-testing the same first `maxConfigs`
- write manifest, matrix evaluation artifacts, history, and refresh `latest-digest.md`
- detect steady-state loops where challenger == champion and report them honestly as regression validation, not fake discovery
- do not patch `pine/test.pine`

### Digest job
Behavior:
- run `pine-autoresearch.mjs digest`
- summarize latest matrix state into a durable digest file

### Auto-promotion job
Behavior:
- run `pine-autoresearch.mjs autopromote`
- only patches `pine/test.pine` when all guards pass
- task wrappers now use a shared lock to avoid overlapping scout/digest/autopromote executions
- therefore keep it opt-in until you are comfortable with unattended shipping

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
- Champion bootstrap is hardened: runtime prefers existing `champion.json`, then latest promoted/latest champion manifest state, then tracked seed file `config/pine-autoresearch.seed.json`, instead of relying on a single untracked sweep artifact.
- When full cross-symbol cache coverage is unavailable, an emergency fallback mode can temporarily trim the matrix to XRPUSDT only and anchor `when` to the latest proven local cache tail until one-time network backfill restores the full matrix.
- The config is backward-compatible in spirit with phase 1 and 2, but now also supports `pinnedData`, `defaultProfile`, and `scoutProfiles`.
- Runtime output dirs are ignored in `.gitignore`; only config, scripts, docs, and tests are meant to be committed.
