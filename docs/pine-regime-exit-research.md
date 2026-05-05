# Pine Regime Exit Research Controls

This document describes Task 13 controls for regime-exit research lanes in autoresearch.

## Default config block

`config/pine-autoresearch.default.json` now includes a default-disabled block:

```json
"regimeExitResearch": {
  "enabled": false,
  "budget": {
    "exploitRatio": 0.25,
    "exitRegimeRatio": 0.35,
    "globalAllParameterRatio": 0.25,
    "robustnessRatio": 0.15
  },
  "resourceBudget": {
    "maxConcurrentLabWorkers": 1,
    "maxRowsPerAnalysisChunk": 5000,
    "maxRetainedCandidatesPerLane": 25,
    "writeFullDebugArtifacts": false
  },
  "promotion": {
    "allowAutomaticRegimeSwitching": false,
    "requireGlobalChampionAnchor": true
  }
}
```

`enabled: false` preserves legacy behavior (regime-exit runtime path stays off).

## Objective priority

Ranking order for regime-exit research decisions:

1. Robustness and positive expectancy
2. ROI above floor
3. Drawdown control
4. Trade-count adequacy
5. Novelty/diversity

## Guardrails

- Regime slices are **shadow research only**; no automatic live switching.
- Global all-parameter search is a controlled escape valve, not default random thrash.
- Offline protections remain mandatory:
  - offline/walk-forward checks
  - multiple-testing penalties
  - promotion gates unchanged

## Resource and RAM safety

- Chunking/streaming analysis via row-limited chunks.
- Retention caps limit per-lane candidate memory growth.
- Compact manifest summaries preferred over large verbose payloads.
- Full debug artifact writing is disabled by default.

## Rollback / kill switch

- Set `regimeExitResearch.enabled=false` to disable the entire regime-exit track.
- Keep global champion anchor requirement enabled.
- Keep existing promotion gates unchanged.

## Backward compatibility

- Existing configs and manifests continue to load.
- New fields (`budget`, `resourceBudget`, `promotion`) are additive.
- Regime-exit manifest extensions are emitted only when `regimeExitResearch.enabled=true`.
