# CLI Reference

## Scope

This page covers the package scripts in `package.json`, the main `npm start` CLI modes, and the extra local entry points in `scripts/`.

For full mode tables, see:
- [README.md](../README.md) — Backtest, Paper Trading, Live Trading, Walker, Pine, Dump
- [Project overview](./project-overview.md)
- [Strategy structure](./backtest_strategy_structure.md)
- [Pine pinets usage](./backtest_pinets_usage.md)
- [Pine debug](./pine_debug.md)
- [Pine warmup](./pine_indicator_warmup.md)

## Package scripts

| Script | Entry | Inputs | Outputs | Side effects | Verify |
|---|---|---|---|---|---|
| `npm start` | `node ./node_modules/@backtest-kit/cli/build/index.mjs` | runtime flags after `--` | mode-dependent CLI output | runs Backtest Kit CLI | `npm start -- --pine ./pine/test.pine --limit 10 --jsonl` |
| `npm test` | `node --test` | repo test files | test report | none | `npm test` |
| `npm run sync:lib` | `node ./scripts/fetch_docs.mjs` | network + `docs/lib/` | refreshed library READMEs | overwrites `docs/lib/*.md` | `npm run sync:lib && git diff -- docs/lib` |
| `npm run pine:run` | `node ./scripts/pine-import-run-clean.mjs` | `.pine` source + cache options | flattened Pine + JSONL dumps | writes `dump/*.jsonl`, cleans raw output | see [pine tooling](./pine-tooling.md#pine-run-and-flatten) |
| `npm run pine:analyze` | `node ./scripts/pine-optimize.mjs` | cleaned JSONL | score + metrics + optional JSON file | writes summary file when `--output` set | see [pine tooling](./pine-tooling.md#pine-analyze) |
| `npm run pine:sweep` | `node ./scripts/pine-sweep.mjs` | `.pine` source + grid/variant args | sweep leaderboard + best config | writes `pine/sweeps/<runId>/...` | see [pine tooling](./pine-sweep-grid-search) |
| `npm run pine:dataset:pin` | `node ./scripts/pine-dataset.mjs pin --config ./config/pine-autoresearch.default.json` | dataset config + cache source mode | pinned dataset JSON | may fetch exchange data, writes dataset/cache | `npm run pine:dataset:verify` |
| `npm run pine:dataset:stage` | `node ./scripts/pine-dataset.mjs stage --config ./config/pine-autoresearch.default.json` | dataset config | staged cache files | materializes pinned candles into cache | `npm run pine:dataset:verify` |
| `npm run pine:dataset:verify` | `node ./scripts/pine-dataset.mjs verify --config ./config/pine-autoresearch.default.json` | dataset config | JSON status per lab | read-only check | `npm run pine:dataset:verify` |
| `npm run pine:autoresearch` | `node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json` | autoresearch config + optional overrides | manifest, scout report, live digest | may queue promotion, update scheduler state | `npm run pine:autoresearch:micro` |
| `npm run pine:autoresearch:micro` | `node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json --profile micro` | same as above | smaller cycle run | same as `cycle`, fewer configs | smoke run for cycle path |
| `npm run pine:autoresearch:digest` | `node ./scripts/pine-autoresearch.mjs digest --config ./config/pine-autoresearch.default.json` | autoresearch state | digest markdown | writes digest files only | `npm run pine:autoresearch:digest` |
| `npm run pine:autoresearch:promote` | `node ./scripts/pine-autoresearch.mjs promote --config ./config/pine-autoresearch.default.json` | latest manifest or `--manifest` | promotion note + updated champion | patches `config.scriptPath`, updates champion/history/digest | use only after a promote-worthy manifest |
| `npm run pine:autoresearch:autopromote` | `node ./scripts/pine-autoresearch.mjs autopromote --config ./config/pine-autoresearch.default.json` | queued manifest + history | autopromote result | consumes queue item, may call promote | `npm run pine:autoresearch:autopromote` |
| `npm run pine:ops:install-tasks` | `pwsh -NoProfile -File ./scripts/ops/install-pine-autoresearch-tasks.ps1` | task prefix + schedule switches | Windows task registrations | creates scheduled tasks | `Get-ScheduledTask -TaskName 'BacktestKit-Pine-*'` |
| `npm run pine:ops:remove-tasks` | `pwsh -NoProfile -File ./scripts/ops/remove-pine-autoresearch-tasks.ps1` | task prefix | task deletions | removes scheduled tasks | `Get-ScheduledTask -TaskName 'BacktestKit-Pine-*'` |

## CLI runtime modes

`npm start -- ...` is the front door. The detailed flag tables live in [README.md](../README.md); this page keeps the map thin.

| Mode | Flag / entry | What it does | Related docs |
|---|---|---|---|
| Backtest | `--backtest` | Historical strategy run over a frame schema | [Strategy structure](./backtest_strategy_structure.md), [Logging & JSONL](./backtest_logging_jsonl.md) |
| Paper trading | `--paper` | Live exchange path with no real orders | [README.md](../README.md) |
| Live trading | `--live` | Real order flow with exchange credentials | [README.md](../README.md) |
| Walker | `--walker` | Compare multiple strategy files on the same window | [README.md](../README.md), [Graph pattern](./backtest_graph_pattern.md) |
| Pine | `--pine` | Execute `.pine` against exchange data | [pine tooling](./pine-tooling.md), [Pine pinets usage](./backtest_pinets_usage.md), [Pine debug](./pine_debug.md), [Pine warmup](./pine_indicator_warmup.md) |
| Dump | `--dump` | Fetch raw OHLCV candles | [README.md](../README.md), [Logging & JSONL](./backtest_logging_jsonl.md) |

## Extra local entry points

These scripts are runnable directly from `scripts/` and are not package scripts.

| Script | Use | Inputs | Outputs / side effects |
|---|---|---|---|
| `scripts/flatten-pine-imports.mjs` | Standalone `.pine` flattening helper | input file, output file, libs dir | writes flattened Pine file; strips `//@version`, `library(...)`, and `// Examples:` blocks from local libs |
| `scripts/fixed-window-revalidate.mjs` | Fixed-window benchmark harness | source `.pine`, symbol, timeframe, limit, `--when` | writes `pine/sweeps/<runId>/leaderboard.*`, `best-config.*`, and variant dumps |
| `scripts/fusion-v3-benchmark.mjs` | Fusion v3 benchmark harness | source `.pine`, fixed window, fusion grid | writes `pine/sweeps/<runId>/...` and cleans temp variants |
| `scripts/fusion-v3-hi-benchmark.mjs` | Higher-threshold fusion v3 benchmark | source `.pine`, fixed window, fusion grid | same sweep artifact layout as above |
| `scripts/fusion-v4-benchmark.mjs` | Fusion v4 benchmark harness | source `.pine`, fixed window, fusion-v4 grid | same sweep artifact layout as above |
| `scripts/ops/pine-autoresearch-run.ps1` | Scheduler-safe wrapper | task name, command, repo root | writes log to `tmp/pine-autoresearch-logs/`, enforces mutex + file lock |
| `scripts/ops/pine-autoresearch-*.ps1` | Scheduled task wrappers | repo root, optional `-DryRun` | run `npm run pine:autoresearch*` through the serialized wrapper |
| `scripts/ops/install-pine-autoresearch-tasks.ps1` | Task installer | task prefix + schedule switches | creates `Micro`, `Digest`, optional `Full` and `Autopromote` tasks |
| `scripts/ops/remove-pine-autoresearch-tasks.ps1` | Task remover | task prefix | deletes the scheduled tasks |

## Quick verification

- `npm test`
- `git diff --check`
- `npm run sync:lib`
- one smoke run for the target mode, then inspect the matching output files
