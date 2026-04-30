# Pine Tooling

## Scope

This page covers the local Pine workflows wired through `scripts/*.mjs` and the `pine:*` package scripts.

Primary code paths:
- `scripts/pine-import-run-clean.mjs`
- `scripts/pine-optimize.mjs`
- `scripts/pine-sweep.mjs`
- `scripts/pine-dataset.mjs`
- `scripts/pine-autoresearch.mjs`
- `scripts/flatten-pine-imports.mjs`

Related docs:
- [Pine debug](./pine_debug.md)
- [Pine warmup](./pine_indicator_warmup.md)
- [Pine pinets usage](./backtest_pinets_usage.md)
- [Logging & JSONL](./backtest_logging_jsonl.md)
- [Strategy structure](./backtest_strategy_structure.md)
- [Graph pattern](./backtest_graph_pattern.md)
- [Graph multiple outputs](./backtest_graph_multiple_outputs.md)

## Pine run and flatten

### Command

```bash
npm run pine:run -- [input.pine] [symbol] [timeframe] [limit] \
  [--libs ./pine/scripts] [--when ISO] [--exchange NAME] \
  [--no-cache] [--require-cache-complete] \
  [--cache-root ./pine/dump/data/candle] [--cache-exchange NAME] \
  [--flattened ./path/to/output.flattened.pine] [--output name]
```

### Behavior

`pine:run` does two jobs:
1. flatten local Pine imports into a standalone `.flattened.pine` file
2. run the Backtest Kit CLI in `--pine --jsonl` mode against the flattened file

Import flattening rules:
- import syntax must match `import vendor/lib/1 as Alias`
- local library source is loaded from `--libs` (default `./pine/scripts`)
- `//@version=...`, `library(...)`, and everything after a `// Examples:` section are removed from imported libs
- `export` prefixes are stripped from imported lib code
- `Alias.` prefixes are removed from the main file after inlining

Cache rules:
- `--require-cache-complete` validates the pinned candle cache before the CLI run
- `--require-cache-complete` requires `--when`
- `--no-cache` passes `--noCache` to the CLI

### Inputs

- `.pine` source file
- local library `.pine` files
- exchange cache when `--require-cache-complete` is used

### Outputs

- flattened Pine file (`*.flattened.pine`)
- raw JSONL dump: `<pine-dir>/dump/<output>.jsonl`
- cleaned JSONL dump: `<pine-dir>/dump/<output>.cleaned.jsonl`
- signal-only JSONL dump: `<pine-dir>/dump/<output>.signals.jsonl`

### Side effects

- reads local library source files
- runs `node_modules/@backtest-kit/cli/build/index.mjs`
- writes generated dump files next to the input `.pine`

### Example

```bash
npm run pine:run -- ./pine/test.pine BTCUSDT 15m 500 --when "2026-04-21T10:30:00Z"
```

### Verify

- `npm run pine:run -- ./pine/test.pine BTCUSDT 15m 500 --when "2026-04-21T10:30:00Z"`
- inspect `./pine/dump/*.cleaned.jsonl` and `./pine/dump/*.signals.jsonl`

## Pine analyze

### Command

```bash
npm run pine:analyze -- [input.cleaned.jsonl] [--min-trades N] [--json] [--output summary.json]
```

### Behavior

`pine:analyze` loads a cleaned JSONL file and scores the trade stream.

It reports:
- file path
- row count
- inferred timeframe minutes
- score
- trade metrics (`tradeCount`, `winRatePct`, `roiPct`, `maxDrawdownPct`, `profitFactor`, `avgReturnPct`, `avgPnl`)
- first trade preview entries

If `--json` is set, the summary prints as JSON. If `--output` is set, the same summary is written to disk.

### Inputs

- cleaned JSONL from `pine:run` or `pine:sweep`

### Outputs

- stdout summary or JSON
- optional summary JSON file

### Side effects

- read-only unless `--output` is set

### Example

```bash
npm run pine:analyze -- ./pine/dump/test.flattened.cleaned.jsonl --json
```

### Verify

- rerun the same file and compare the score / metrics
- `git diff --check` after saving an output file

## Pine sweep grid search

### Command

```bash
npm run pine:sweep -- [input.pine] [symbol] [timeframe] [limit] \
  [--grid phase3-core] [--max-configs N] [--offset N] [--variant-file file.json] \
  [--keep-artifacts] [--min-trades N] [--when ISO] [--exchange NAME] \
  [--no-cache] [--require-cache-complete] [--cache-root PATH] [--cache-exchange NAME] \
  [--run-id ID]
```

### Behavior

`pine:sweep` patches a Pine source file across many config variants, runs `pine:run` for each one, analyzes the cleaned JSONL, and ranks the results.

If `--variant-file` is omitted, variants come from `getCandidateGrid(gridName)` and `selectSweepCombos(...)`.

Common grid names from `scripts/lib/pine-tuner.mjs`:
`default`, `focused`, `root-cause`, `profit-candidate`, `exit-tuning`, `exit-side`, `exit-state`, `exit-state-tightening`, `exit-state-research`, `exit-state-context`, `exit-state-time-stop`, `exit-state-partial-derisk`, `exit-state-context-caution`, `exit-state-post-entry-squeeze`, `exit-state-adverse-divergence`, `asymmetry`, `asymmetry-context`, `fusion-safe`, `fusion-v2`, `fusion-v3`, `fusion-v4`, `squeeze-context`, `divergence-context`, `phase3-core`.

### Inputs

- Pine source file
- grid name or variant file
- optional candle window and cache overrides

### Outputs

- `pine/sweeps/<runId>/meta.json`
- `pine/sweeps/<runId>/variants/*.pine`
- `pine/sweeps/<runId>/leaderboard.json`
- `pine/sweeps/<runId>/leaderboard.md`
- `pine/sweeps/<runId>/best-config.pine`
- `pine/sweeps/<runId>/best-config.json`

### Side effects

- writes one variant run per config
- optionally keeps or deletes temp variant artifacts
- can hit exchange/cache sources through the nested `pine:run`

### Example

```bash
npm run pine:sweep -- ./pine/test.pine XRPUSDT 15m 5000 --grid phase3-core --max-configs 8 --when "2026-04-21T10:30:00Z"
```

### Verify

- check `pine/sweeps/<runId>/leaderboard.md`
- check the top row in `pine/sweeps/<runId>/leaderboard.json`
- `git diff --check`

## Pine dataset

### Commands

```bash
npm run pine:dataset:pin -- [--config ./config/pine-autoresearch.default.json]
npm run pine:dataset:stage -- [--config ./config/pine-autoresearch.default.json]
npm run pine:dataset:verify -- [--config ./config/pine-autoresearch.default.json]
```

### Behavior

`pine-dataset.mjs` loads a config file, resolves the primary lab plus shadow labs, and works with pinned candle datasets.

Subcommands:
- `pin` — read candles from local cache first, then exchange if `sourceMode` allows it; write pinned dataset JSON; stage cache unless `--no-stage`
- `stage` — read an existing pinned dataset and materialize cache files
- `verify` — read each dataset and confirm the cache is complete for every lab window

Default config: `./config/pine-autoresearch.default.json`

### Inputs

- dataset config JSON
- lab definitions (`primaryLab`, `shadowLabs`, `pinnedData`)

### Outputs

- dataset JSON files under `pinnedData.datasetsRoot`
- cache candle JSON files under `pinnedData.cacheRoot`
- JSON status lines from `verify`

### Side effects

- `pin` may fetch exchange data
- `pin` and `stage` write cache files
- `verify` is read-only

### Example

```bash
npm run pine:dataset:verify
```

### Verify

- `npm run pine:dataset:verify`
- confirm `cacheComplete: true` in the printed JSON

## Pine autoresearch

### Commands

```bash
npm run pine:autoresearch
npm run pine:autoresearch:micro
npm run pine:autoresearch:digest
npm run pine:autoresearch:promote
npm run pine:autoresearch:autopromote
```

### Behavior

`pine-autoresearch.mjs` is the full research / promotion pipeline.

Commands:
- `cycle` / `scout` (default): build candidate variants, run sweeps, evaluate matrix candidates, write a manifest, update the live digest, and maybe queue promotion
- `digest`: render the current digest from the latest manifest
- `promote`: patch the configured `scriptPath` with the chosen challenger and record the new champion
- `autopromote`: consume the pending promotion queue and promote only if the queue + policy gates pass
- `holdout` / `blind-holdout`: evaluate the latest challenger against blind holdout labs

Safety / coordination:
- only one cycle/promote/autopromote path runs at a time
- the runner uses a file lock plus a named mutex
- scheduler wrappers tee output into `tmp/pine-autoresearch-logs/`

### Inputs

- `config/pine-autoresearch.default.json`
- optional overrides: `--grid`, `--profile`, `--symbol`, `--timeframe`, `--limit`, `--when`, `--exchange`, `--max-configs`, `--min-trades`, `--force-cycle`, `--force`

### Outputs

- manifests under `pine/autoresearch/<matrixId>/manifests/`
- latest manifest and champion state
- history JSONL and scheduler state
- digest markdown under `report/pine-autoresearch/...`
- promotion queue / blind-holdout artifacts / logs

### Side effects

- may queue promotions
- may patch `config.scriptPath` during promote/autopromote
- prunes old sweep and evaluation runs when retention says so

### Example

```bash
npm run pine:autoresearch:micro
```

### Verify

- run the micro cycle, then `npm run pine:autoresearch:digest`
- inspect the latest manifest and digest files

## Windows task wrappers

### Commands

```powershell
pwsh -NoProfile -File ./scripts/ops/install-pine-autoresearch-tasks.ps1
pwsh -NoProfile -File ./scripts/ops/remove-pine-autoresearch-tasks.ps1
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-run.ps1 -TaskName demo -Command 'npm run pine:autoresearch:micro' -DryRun
```

### Behavior

- `pine-autoresearch-run.ps1` serializes runs with a scheduler lock and a named mutex, then tees output to a timestamped log file
- `pine-autoresearch-micro.ps1`, `-full.ps1`, `-digest.ps1`, and `-autopromote.ps1` are thin wrappers over the runner
- `install-pine-autoresearch-tasks.ps1` creates `Micro`, `Digest`, optional `Full`, and `Autopromote` tasks
- `remove-pine-autoresearch-tasks.ps1` deletes those tasks

### Verify

- use `-DryRun` before creating tasks
- confirm task names with `Get-ScheduledTask -TaskName 'BacktestKit-Pine-*'`

## Related docs

- [README.md](../README.md)
- [CLI reference](./cli-reference.md)
- [Pine debug](./pine_debug.md)
- [Pine warmup](./pine_indicator_warmup.md)
- [Pine pinets usage](./backtest_pinets_usage.md)
- [Logging & JSONL](./backtest_logging_jsonl.md)
- [Strategy structure](./backtest_strategy_structure.md)
- [Graph pattern](./backtest_graph_pattern.md)
- [Graph multiple outputs](./backtest_graph_multiple_outputs.md)

## Verification

- `npm test`
- `git diff --check`
- a smoke run for the target command path
