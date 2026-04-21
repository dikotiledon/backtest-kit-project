# Pine Autoresearch Cron Loop

## Goal

Turn the existing backtest-kit pine sweep infrastructure into a repeatable OpenClaw cron research loop:

1. scout new challenger configs on the locked benchmark window
2. judge challenger vs incumbent with explicit promotion gates
3. write durable scout manifests and human-readable digests
4. optionally promote only when the decision gate says `promote`

This is autoresearch for the strategy config layer, not generic web browsing.

## Base reused

The loop is built on the existing project primitives, not a second pipeline:

- `scripts/pine-import-run-clean.mjs`
- `scripts/pine-sweep.mjs`
- `scripts/lib/pine-tuner.mjs`
- `scripts/lib/pine-optimizer.mjs`
- locked incumbent artifact:
  - `pine/sweeps/fixed-window-fusion-v4-XRPUSDT-15m-10000-2026-04-21T10-30-00Z/best-config.json`

## Config

Tracked config:
- `config/pine-autoresearch.default.json`

Current lab defaults:
- symbol: `XRPUSDT`
- timeframe: `15m`
- bars: `10000`
- anchor: `2026-04-21T10:30:00.000Z`
- scout grid: `fusion-v4`
- incumbent: locked `fusion-v4-04`

Promotion gates:
- score delta >= `0.25`
- ROI delta >= `0`
- profit factor delta >= `0`
- max drawdown delta <= `0.75`
- trade count >= `150`
- trade ratio vs incumbent >= `0.75`

## Commands

Scout cycle:
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

Force promotion even if gates fail:
```bash
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --force
```

## Runtime artifacts

Scout manifests:
- `pine/autoresearch/pine-fusion-v4-xrpusdt-15m-fixed-window/manifests/*.json`
- `pine/autoresearch/pine-fusion-v4-xrpusdt-15m-fixed-window/latest.json`

Human-readable reports:
- `report/pine-autoresearch/pine-fusion-v4-xrpusdt-15m-fixed-window/*.md`

Raw sweep outputs stay in:
- `pine/sweeps/<run-id>/`

## OpenClaw cron shape

### Scout job
Cadence: every 6 hours

Behavior:
- run `pine-autoresearch.mjs cycle`
- stay quiet (`delivery.mode=none`)
- persist manifest + markdown
- do not auto-promote

### Digest job
Cadence: daily morning

Behavior:
- run `pine-autoresearch.mjs digest`
- announce a short summary to Telegram
- point to the digest file path in stdout

## Why promotion is separate

Autoresearch should be aggressive at exploring and conservative at shipping.

The scout loop is allowed to generate new challengers frequently.
Promotion remains a separate explicit command, even though the decision engine already tells us when a candidate is strong enough.

That keeps accidental drift out of `pine/test.pine` while still making promotion trivial when a challenger is clearly better.

## Notes

- `scripts/pine-sweep.mjs` now accepts `--when` and `--exchange`, so cron runs can stay on the same locked benchmark anchor.
- Runtime output dirs are ignored in `.gitignore`; only the config, scripts, docs, and tests are meant to be committed.
