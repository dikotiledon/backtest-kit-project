# Autoresearch config reference

Field guide for `config/pine-autoresearch.default.json`.

This page explains operator-facing meaning. It is not a generated JSON Schema. Code defaults still live in `scripts/pine-autoresearch.mjs` and related `scripts/lib/*.mjs` modules.

## Top-level shape

| Field | Meaning |
| --- | --- |
| `matrixId` | Research namespace. Used under `pine/autoresearch/<matrixId>/` and report paths. |
| `defaultProfile` | Profile used when `--profile` is omitted. |
| `scriptPath` | Pine source of truth to patch/promote. Usually `../pine/test.pine`. |
| `outputs` | Research/digest artifact roots. |
| `scoutProfiles` | Budget presets for full and micro cycles. |
| `primaryLab` | Main candidate-selection lab. |
| `shadowLabs` | Robustness labs required by matrix gates. |
| `blindHoldoutLabs` | Validation-only labs, not used for candidate generation. |
| `pinnedData` | Reproducible dataset/cache settings. |
| `searchPolicy` | Candidate generation and stagnation behavior. |
| `matrixPolicy` | Candidate promotion requirements across labs. |
| `expectancyPolicy` | Win-rate/payoff decomposition guard. |
| `autoPromotion` | Queue promotion, cooldown, and lineage policy. |
| `regimeExitResearch` | Optional regime/exit/global research extension. |

## Outputs

```json
"outputs": {
  "researchRoot": "../pine/autoresearch/pine-fusion-v4-core-15m-locked-window",
  "digestRoot": "../report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window"
}
```

| Field | Meaning |
| --- | --- |
| `researchRoot` | Mutable machine state: manifests, champion, queue, locks, evaluations. |
| `digestRoot` | Human reports: latest digest, history, analysis markdown. |

## Scout profiles

```json
"scoutProfiles": {
  "full": { "maxConfigs": 8, "minTrades": 10 },
  "micro": { "maxConfigs": 2, "minTrades": 10 }
}
```

| Field | Meaning |
| --- | --- |
| `maxConfigs` | Candidate count budget for that profile. |
| `minTrades` | Minimum trade count used by optimizer/gates for that profile. |

Use `micro` for fast smoke runs. Use `full` for scheduled research.

## Labs

Each lab defines a market window:

| Field | Meaning |
| --- | --- |
| `labId` | Stable identifier used in manifests and datasets. |
| `symbol` | Trading pair, e.g. `XRPUSDT`. |
| `timeframe` | Candle interval, e.g. `15m`. |
| `limit` | Candle count. |
| `when` | Right edge of the window. |
| `exchange` | Runtime exchange name. Pinned data can override effective runtime exchange. |
| `tier` / `role` | Training, selection, shadow, or blind holdout semantics. |

Lab types:

| Type | Use |
| --- | --- |
| `primaryLab` | Main selection window. |
| `shadowLabs` | Robustness windows. Matrix gates require enough pass. |
| `blindHoldoutLabs` | Validation-only windows. Do not use for search/selection. |

## Pinned data

```json
"pinnedData": {
  "enabled": true,
  "datasetsRoot": "../pine/datasets/pine-fusion-v4-core-15m-locked-window",
  "cacheRoot": "../pine/dump/data/candle",
  "exchangeName": "ccxt-exchange",
  "sourceExchangeId": "binance",
  "sourceMode": "local-cache"
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Enables strict reproducible datasets and cache preflight. |
| `datasetsRoot` | Where pinned dataset JSONs are stored. |
| `cacheRoot` | Where candle cache is materialized. |
| `exchangeName` | Cache/runtime exchange namespace. |
| `sourceExchangeId` | External source exchange for pinning. |
| `sourceMode` | Source mode, commonly `local-cache`; network pinning can fill missing windows. |

Commands:

```bash
npm run pine:dataset:pin
npm run pine:dataset:stage
npm run pine:dataset:verify
```

Expected strict state: all labs report `cacheComplete=true`, `missingCount=0`.

## Search policy

```json
"searchPolicy": {
  "mode": "incumbent-local",
  "exploitRatio": 0.8,
  "freezeArchitecture": true,
  "exploitFamilies": ["signal", "risk"],
  "exploreFamilies": ["signal"],
  "paretoShortlistSize": 4,
  "matrixCandidateLimit": 3,
  "selfLoopEscape": { ... },
  "annealing": { ... }
}
```

| Field | Meaning |
| --- | --- |
| `mode` | Search strategy. Current default searches around incumbent. |
| `exploitRatio` | Share of local champion-near variants. |
| `freezeArchitecture` | Prevents broad architecture changes in normal search. |
| `exploitFamilies` | Mutation families allowed in exploit search. |
| `exploreFamilies` | Families allowed during exploration. |
| `paretoShortlistSize` | Primary-sweep candidates retained for consideration. |
| `matrixCandidateLimit` | Candidate count evaluated across matrix labs. |
| `selfLoopEscape` | Fallback behavior when candidates repeat/no-change. |
| `annealing` | Temperature growth during stagnation. |

## Self-loop escape

| Field | Meaning |
| --- | --- |
| `enabled` | Enables no-change fallback. |
| `activateAfter` | Number of steady cycles before escape behavior starts. |
| `includeFallback` | Adds fallback families when active. |
| `fallbackFamilies` | Families used for normal fallback. |
| `minFallbackConfigs` | Minimum fallback candidates to include. |
| `temperatureBoost` | Mutation temperature multiplier. |
| `stagnationFallbackFamilies` | Wider family set used during deeper stagnation. |
| `stagnationTemperatureBoost` | Stronger temperature multiplier for stagnation. |

## Matrix policy

```json
"matrixPolicy": {
  "requirePrimaryPromote": true,
  "minShadowPassCount": 3,
  "minShadowPassRatio": 0.6,
  "requireCandidateChange": true
}
```

| Field | Meaning |
| --- | --- |
| `requirePrimaryPromote` | Primary lab must recommend promotion. |
| `minShadowPassCount` | Minimum shadow labs that must pass. |
| `minShadowPassRatio` | Minimum pass ratio across shadow labs. |
| `requireCandidateChange` | Blocks no-op champion re-promotions. |

## Expectancy policy

Expectancy policy prevents fake improvement from win-rate jumps that worsen payoff asymmetry.

Common fields:

| Field | Meaning |
| --- | --- |
| `enabled` | Enables expectancy guard. |
| `wrJumpDiagnosticThreshold` | Win-rate jump that triggers decomposition concern. |
| `rejectWrGainAvgWinLoss` | Rejects win-rate gain when average win/loss quality degrades. |
| `requireExpectancyNonRegression` | Requires expectancy to stay flat or improve. |

Manifest fields include champion/challenger expectancy, deltas, gate result, and policy snapshot.

## Auto-promotion

```json
"autoPromotion": {
  "enabled": true,
  "cooldownHours": 12,
  "maxPromotionsPerDay": 2,
  "requireMatrixPromotion": true,
  "lineagePolicy": { ... }
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Allows queue-consuming autopromote. |
| `cooldownHours` | Minimum time between automatic promotions. |
| `maxPromotionsPerDay` | Daily promotion cap. |
| `requireMatrixPromotion` | Requires matrix recommendation before autopromote. |
| `lineagePolicy` | Anti-ping-pong family controls. |

Lineage policy:

| Field | Meaning |
| --- | --- |
| `enabled` | Enables family reversal controls. |
| `lookbackPromotions` | Promotions inspected for recent family flips. |
| `familyKeys` | Config keys defining strategy family. |
| `baseShadowPassCount` | Normal shadow requirement baseline. |
| `directReversalExtraShadowPasses` | Extra passes needed for direct family reversal. |
| `minExtraAggregateScoreDelta` | Extra score delta required for reversal. |
| `minExtraAggregateRoiDeltaPct` | Extra ROI delta required for reversal. |

## Regime-exit research

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

| Field | Meaning |
| --- | --- |
| `enabled` | Enables the optional feature path. Default false. |
| `budget.*Ratio` | Lane allocation across exploit, exit/regime, global, robustness. |
| `resourceBudget.maxConcurrentLabWorkers` | Worker concurrency cap; keep low for RAM safety. |
| `resourceBudget.maxRowsPerAnalysisChunk` | Streaming/chunking size. |
| `resourceBudget.maxRetainedCandidatesPerLane` | Candidate retention cap per lane. |
| `resourceBudget.writeFullDebugArtifacts` | Writes heavy debug artifacts when true; default false. |
| `promotion.allowAutomaticRegimeSwitching` | Must stay false unless live routing is explicitly designed. |
| `promotion.requireGlobalChampionAnchor` | Keeps single global champion safety model. |

See [Pine regime-exit research](../pine-regime-exit-research.md).

## Safe edit rules

- Change one risk dimension at a time.
- Prefer smaller `micro` validation before full cycles.
- Do not lower promotion gates to force a result.
- If pinned data is incomplete, fix datasets/cache instead of disabling strict mode.
- If RAM is high, reduce workers/retention/debug artifacts before reducing robustness.
- Update [schemas](./schemas.md), [artifacts](../artifacts-and-state.md), and [autoresearch docs](../pine-autoresearch.md) when adding fields.
