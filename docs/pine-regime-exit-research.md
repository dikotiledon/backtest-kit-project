# Pine regime-exit research

Regime-exit research is an optional autoresearch extension for finding better exits and asymmetric trade management without abandoning the global champion safety model.

It adds regime-conditioned evidence, exit-state candidate families, controlled global all-parameter search, and resource-bounded execution. It does **not** enable automatic per-regime live switching.

## Purpose

The original autoresearch loop is strong at local champion hill-climbing. Once the entry stack matures, candidates can become near-duplicates. Regime-exit research widens the frontier safely:

- research exits, not only entries
- measure candidate behavior by market regime
- keep one global champion anchor
- allow broad search only as a budgeted escape valve
- preserve promotion gates and backward compatibility
- bound memory/RAM with compact manifests and streaming summaries

## Default state

`config/pine-autoresearch.default.json` ships the feature disabled:

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

`enabled=false` means legacy autoresearch behavior is preserved. All new fields are additive.

## Research lanes

When enabled, the scheduler allocates each cycle across four lane types.

| Lane | Default share | Purpose |
| --- | ---: | --- |
| `exploit` | 25% | Continue local improvements around champion. |
| `exitRegime` | 35% | Search exit-state and regime-conditioned variants. |
| `globalAllParameter` | 25% | Controlled broad search escape valve. |
| `robustness` | 15% | Adversarial/validation-oriented checks. |

The scheduler can adjust lane choice using stagnation state, but promotion gates do not loosen during stagnation.

## Regime slices

Regime slices summarize behavior under different market contexts. Current conceptual slices:

- trend
- chop
- high-vol
- low-vol
- long-favored
- short-favored

Regime slicing is evidence for research and diagnostics. It is not live switching. A candidate that looks good in one slice still needs global matrix promotion.

Rules:
- thresholds must be deterministic/frozen for a run
- insufficient trade count blocks promotion claims for a slice
- invalid PnL is counted separately from valid PnL math
- summary metrics are compact and rounded

## Exit-state families

Exit-state research mutates trade management rather than only entry filters.

Families include:
- ATR stop / take-profit variants
- trailing stop variants
- breakeven variants
- time stop variants
- partial exit variants
- asymmetric long/short exit variants

Candidate generators must preserve Pine compatibility and must not remove required output plots such as `Signal`, `StopLoss`, `TakeProfit`, and `EstimatedTime`.

## Objective priority

Regime-exit ranking favors durable profitability over isolated score spikes.

Priority order:

1. Gate safety: matrix eligibility, expectancy non-regression, enough trades, acceptable drawdown.
2. Robust expectancy: candidate payoff distribution should not worsen while win rate improves.
3. ROI above hard floor.
4. Drawdown control and risk-adjusted return.
5. Trade count adequacy.
6. Regime usefulness as supporting evidence, not standalone promotion proof.

Objective fields are summarized into manifest fields such as `objectiveBreakdown` when the feature is enabled.

## Anti-overfit controls

Broad search increases false discovery risk. Guardrails:

- one global champion remains the anchor
- selection labs and blind holdouts stay separate
- blind holdout labs are not used to generate candidates
- multiple-testing penalty is tracked for broad search
- stagnation can widen search, but cannot lower gates
- automatic regime switching remains disabled
- promotion requires standard matrix and expectancy gates

`globalAllParameter` is a controlled escape valve, not the default path to promotion.

## Offline and walk-forward protection

The feature inherits the pinned-data model from autoresearch.

Required workflow before strict research:

```bash
npm run pine:dataset:pin
npm run pine:dataset:stage
npm run pine:dataset:verify
```

Expected verify result: every configured primary/shadow lab reports `cacheComplete=true` and `missingCount=0`.

Leakage rules:
- freeze datasets before evaluation
- do not use blind holdouts for candidate generation
- keep `when`, `limit`, symbol, and timeframe explicit per lab
- treat `offlineDataMissing` as hold/skip, not as a reason to weaken checks
- prefer exact manifests for promotion review

## Resource and RAM safety

This feature was designed to preserve comprehensiveness without keeping all raw data in memory or manifests.

Default safety controls:
- `maxConcurrentLabWorkers: 1`
- `maxRowsPerAnalysisChunk: 5000`
- `maxRetainedCandidatesPerLane: 25`
- `writeFullDebugArtifacts: false`

Runtime behavior:
- keep heavy JSONL and row diagnostics as artifacts, not manifest payload
- stream/compact summaries where possible
- retain bounded lane candidates
- include `resourceUsageSummary` in manifests when enabled
- enforce manifest compactness tests

Manifest must not persist raw row diagnostic markers such as `Feature_RawLongPrediction`.

## Manifest fields

When enabled, regime-exit manifest extensions can include:

| Field | Meaning |
| --- | --- |
| `researchBudgetMode` | active research mode, usually `regime-exit` |
| `resourceBudget` | configured resource limits |
| `resourceUsageSummary` | compact runtime resource summary |
| `checkpointState` | resume/checkpoint summary |
| `objectiveBreakdown` | ranking/gate threshold summary |
| `multipleTestingPenalty` | broad-search penalty summary |
| `holdoutVerdict` | blind holdout result summary, if run |
| `offlineDataSummary` | strict offline-data preflight result |
| `shadowRegimeScoreboard` | compact lane/regime scoreboard |

These fields are additive. Older manifests without them remain valid.

## Promotion behavior

Promotion still promotes one global champion. There is no automatic per-regime live switching.

Required behavior:
- `promotion.requireGlobalChampionAnchor=true`
- `promotion.allowAutomaticRegimeSwitching=false`
- matrix gates still apply
- expectancy gates still apply
- trade-count and drawdown floors still apply
- lineage anti-ping-pong still applies
- queue replay still promotes exact manifest only

Regime evidence can explain why a candidate is interesting. It cannot bypass promotion gates.

## Rollback / kill switch

Fast rollback options:

1. Disable feature:

```json
"regimeExitResearch": { "enabled": false }
```

2. Disable autopromotion:

```json
"autoPromotion": { "enabled": false }
```

3. Promote a known-good older manifest:

```bash
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --run-id <runId>
```

4. Stop scheduled tasks through the ops scripts or Windows Task Scheduler.

Because the feature is additive, disabling it should return cycles to the legacy autoresearch path.

## Backward compatibility

Compatibility rules:

- existing configs load without `regimeExitResearch`
- `enabled=false` preserves legacy behavior
- existing manifests remain readable without regime-exit fields
- new manifest fields are compact and optional
- old promotion queue items remain valid
- pinned dataset format remains unchanged

## Operator checklist

Before enabling:

- [ ] `npm test` passes
- [ ] `npm run pine:dataset:verify` reports all labs complete
- [ ] `autoPromotion.enabled` setting is intentional
- [ ] `regimeExitResearch.resourceBudget` fits local RAM
- [ ] blind holdouts are configured as validation-only

After enabling:

- [ ] run `npm run pine:autoresearch:micro`
- [ ] inspect `latest.json` for `offlineDataSummary.ok=true`
- [ ] inspect `resourceUsageSummary`
- [ ] inspect `shadowRegimeScoreboard`
- [ ] run full cycle only after micro proves stable

Before promotion:

- [ ] matrix decision recommends promote
- [ ] expectancy gate passes
- [ ] shadow pass ratio/count pass
- [ ] candidate differs from champion
- [ ] blind holdout result is acceptable, if configured
- [ ] manifest is compact and exact `runId` is known

## Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `offlineDataMissing` | pinned cache incomplete | run dataset pin/stage/verify |
| no regime fields in manifest | feature disabled or skipped | check `regimeExitResearch.enabled` and offline summary |
| manifest too large | heavy diagnostics leaked | run compactness tests and inspect manifest JSON |
| broad search dominates | budget config wrong | inspect lane allocation in `shadowRegimeScoreboard` |
| candidate good only in one slice | regime overfit risk | require global matrix/holdout proof |
| RAM pressure | too many workers/retained candidates | lower resource budget, keep debug artifacts off |

## See also

- [Pine autoresearch](./pine-autoresearch.md)
- [Artifacts and state](./artifacts-and-state.md)
- [Reference: schemas](./reference/schemas.md)
- [Troubleshooting: Pine autoresearch](./troubleshooting/pine-autoresearch.md)
- Design provenance: [Regime-conditioned exit research design](./superpowers/specs/2026-05-05-pine-regime-conditioned-exit-research-design.md)
