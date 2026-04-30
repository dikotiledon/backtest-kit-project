# Project Overview

## What this repo is

This repo is a **Backtest Kit project scaffold** plus local research tooling.

The upstream CLI and runtime live in `@backtest-kit/cli` and related packages. This repo holds:
- strategy entry files
- local Pine tooling and data prep scripts
- autoresearch / optimization workflows
- reports and generated artifacts
- documentation for how the repo is organized and operated

## Repo shape

| Path | Purpose |
|---|---|
| `content/` | Strategy entry points and research strategy files |
| `math/` | Pine scripts and generated Pine artifacts |
| `pine/` | Local Pine research workspace: autoresearch, datasets, sweeps, scripts, and test Pine files |
| `modules/` | Optional runtime hooks loaded by CLI mode |
| `report/` | Strategy research reports and comparisons |
| `scripts/` | Local automation and data tooling |
| `config/` | JSON config for autoresearch and related jobs |
| `docs/` | Current docs, reference docs, and historical notes |
| `dump/` | Generated dumps and exports |
| `tests/` | Automated checks |

## Runtime modes

All modes are driven through the CLI entrypoint in `package.json`.

### Backtest
- Runs a strategy against historical candles.
- Best for validation, comparison, and regression checks.
- Uses `content/*.strategy.ts` plus a frame/schema registration.

### Paper trading
- Live exchange path, no real orders.
- Best for dry validation of live behavior.
- Safer than live, but still exercises exchange connectivity.

### Live trading
- Real orders, real risk.
- Requires correct exchange credentials and operational discipline.
- Treat as production-only.

### Walker
- Compares multiple strategy files over the same historical period.
- Best for ranking variants before commit decisions.

### Pine
- Runs local `.pine` files against exchange data.
- Produces tables or exported files for analysis.

### Dump
- Fetches raw OHLCV candles and writes them to dump files.
- Useful as input for Pine or analysis workflows.

## Safety boundaries

- **Secrets**: keep API keys and tokens in `.env`, not in docs or memory.
- **Real orders**: only live mode can place them; paper/backtest must stay non-destructive.
- **Generated state**: treat `dump/`, `math/dump/`, autoresearch outputs, and lock/queue files as generated artifacts.
- **Module hooks**: `modules/*.ts` are optional runtime extensions; missing modules should fail softly unless a workflow explicitly depends on them.
- **Docs truth**: code and tests outrank historical notes.

## Authority flow

When you need to understand behavior:
1. source code / tests
2. current docs
3. historical docs and dated notes

That order matters because this repo keeps a lot of research history. Historical docs explain how we got here; current docs explain what to do now.

## Where to start

- [docs hub](./README.md)
- [strategy structure guide](./backtest_strategy_structure.md)
- [Pine warmup notes](./pine_indicator_warmup.md)
- [Pine debug guide](./pine_debug.md)

## Planned deeper docs

These pages are linked now so later documentation tasks can fill them in without changing the navigation pattern:
- [cli-reference.md](./cli-reference.md)
- [pine-tooling.md](./pine-tooling.md)
- [pine-autoresearch.md](./pine-autoresearch.md)
- [artifacts-and-state.md](./artifacts-and-state.md)
- [operations.md](./operations.md)
- [development.md](./development.md)
- [reference/modules.md](./reference/modules.md)
- [reference/schemas.md](./reference/schemas.md)
