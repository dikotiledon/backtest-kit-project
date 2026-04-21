# Pine Autoresearch Cron Loop

## Goal

Turn the existing backtest-kit pine sweep infrastructure into a repeatable OpenClaw cron research loop that is safe enough to ship defaults from:

1. scout new challenger configs on a locked primary benchmark window
2. revalidate champion vs challenger across a shadow-lab matrix
3. persist champion/challenger history and matrix decisions
4. allow guarded auto-promotion only when matrix policy passes

This is autoresearch for the strategy config layer, not generic web browsing.

## Phase 2 architecture

One global `pine/test.pine` default cannot safely auto-promote from independent per-symbol winners.

So phase 2 uses:
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

Current matrix:
- primary: `XRPUSDT 15m 10000 bars`
- shadows:
  - `BTCUSDT 15m 10000 bars`
  - `ETHUSDT 15m 10000 bars`
- shared anchor: `2026-04-21T10:30:00.000Z`
- scout grid: `fusion-v4`

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

Human-readable reports:
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/*.md`
- `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/history.md`

Raw sweep outputs still stay in:
- `pine/sweeps/<run-id>/`

## OpenClaw cron shape

### Scout job
Cadence: every 6 hours

Behavior:
- run `pine-autoresearch.mjs cycle`
- quiet delivery
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
Auto-promotion stays guarded, not impulsive.

## Notes

- `scripts/pine-sweep.mjs` accepts `--when` and `--exchange`, so scout windows stay locked.
- The phase 2 config is backward-compatible in spirit with phase 1, but now uses matrix-aware fields (`primaryLab`, `shadowLabs`, `seedChampion`, `matrixPolicy`, `autoPromotion`).
- Runtime output dirs are ignored in `.gitignore`; only config, scripts, docs, and tests are meant to be committed.
