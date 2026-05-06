# Documentation Hub

Start here when you need orientation.

## What this docs set is

- **Current docs**: maintained, behavior-focused pages that should match the repo now.
- **Historical docs**: dated plans, research notes, and older writeups kept for context. Useful for provenance, not authority.

If a historical doc conflicts with code or tests, trust code/tests first.

## Reading order

1. [Project overview](./project-overview.md) — repo purpose, directory map, runtime modes, safety boundaries.
2. [CLI reference](./cli-reference.md) — package scripts and runtime flags.
3. [Pine tooling](./pine-tooling.md) — import, run, optimize, sweep, and dataset workflows.
4. [Pine autoresearch](./pine-autoresearch.md) — end-to-end research and promotion flow.
5. [Pine regime-exit research](./pine-regime-exit-research.md) — optional regime/exit/global research feature.
6. [Artifacts and state](./artifacts-and-state.md) — generated files, manifests, queues, and locks.
7. [Operations](./operations.md) — scheduled tasks, wrappers, recovery, and runbooks.
8. [Development](./development.md) — setup, tests, and extension rules.
9. Reference docs — [modules](./reference/modules.md), [schemas](./reference/schemas.md), [autoresearch config](./reference/autoresearch-config.md), and [autoresearch artifacts](./reference/autoresearch-artifacts.md).

## Autoresearch handoff path

For a new maintainer, read in this order:

1. [Pine autoresearch](./pine-autoresearch.md)
2. [Pine regime-exit research](./pine-regime-exit-research.md)
3. [Autoresearch config reference](./reference/autoresearch-config.md)
4. [Autoresearch artifacts reference](./reference/autoresearch-artifacts.md)
5. [Troubleshooting Pine autoresearch](./troubleshooting/pine-autoresearch.md)

This path is the canonical project/operator documentation for the autoresearch system. The dated `docs/superpowers/**` files are provenance and implementation history, not required operator reading.

## Map

### Core repo docs
- [project-overview.md](./project-overview.md)
- [cli-reference.md](./cli-reference.md)
- [pine-tooling.md](./pine-tooling.md)
- [pine-autoresearch.md](./pine-autoresearch.md)
- [pine-regime-exit-research.md](./pine-regime-exit-research.md)
- [artifacts-and-state.md](./artifacts-and-state.md)
- [operations.md](./operations.md)
- [development.md](./development.md)

### Reference docs
- [reference/modules.md](./reference/modules.md)
- [reference/schemas.md](./reference/schemas.md)
- [reference/autoresearch-config.md](./reference/autoresearch-config.md)
- [reference/autoresearch-artifacts.md](./reference/autoresearch-artifacts.md)

### Troubleshooting docs
- [troubleshooting/pine-autoresearch.md](./troubleshooting/pine-autoresearch.md)

### Existing focused docs
- [backtest_strategy_structure.md](./backtest_strategy_structure.md)
- [backtest_actions.md](./backtest_actions.md)
- [backtest_pinets_usage.md](./backtest_pinets_usage.md)
- [backtest_logging_jsonl.md](./backtest_logging_jsonl.md)
- [backtest_graph_pattern.md](./backtest_graph_pattern.md)
- [backtest_graph_multiple_outputs.md](./backtest_graph_multiple_outputs.md)
- [backtest_risk_async.md](./backtest_risk_async.md)
- [pine_debug.md](./pine_debug.md)
- [pine_indicator_warmup.md](./pine_indicator_warmup.md)

## Current vs historical docs

### Current

Use these for day-to-day work and repo navigation:
- docs hub and overview
- local CLI / Pine / autoresearch / ops docs
- reference pages that describe live code paths and config
- troubleshooting pages

### Historical

Keep these as background unless re-verified:
- dated planning docs in `docs/`
- implementation plans in `docs/superpowers/plans/`
- design provenance in `docs/superpowers/specs/`
- old research notes and migration writeups
- any note that describes behavior without a matching test or current code path
