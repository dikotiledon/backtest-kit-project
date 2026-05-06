# Troubleshooting Pine autoresearch

Use this when cycle, digest, promotion, scheduled tasks, or regime-exit research behaves unexpectedly.

Start with evidence. Do not delete artifacts or bypass gates until the failing layer is identified.

## First five checks

```bash
git status --short
npm run pine:dataset:verify
npm run pine:autoresearch:digest
git diff --check
npm test
```

Then inspect:
- `pine/autoresearch/<matrixId>/latest.json`
- `pine/autoresearch/<matrixId>/history.jsonl`
- `pine/autoresearch/<matrixId>/state/promotion-queue.jsonl`
- `pine/autoresearch/<matrixId>/state/autoresearch.lock.json`
- `report/pine-autoresearch/<matrixId>/latest-digest.md`

## Symptom map

| Symptom | Likely cause | First action |
| --- | --- | --- |
| `offlineDataMissing` | pinned dataset/cache incomplete | run dataset pin/stage/verify |
| `exchange ... not found` | runtime exchange mismatch or CLI cache path issue | verify pinned cache and `pine-import-run-clean` args |
| cycle exits `0` but does nothing | expected skip/hold path | check latest history event reason |
| cycle refuses to run | pending promotion pause | inspect promotion queue |
| autopromote does nothing | queue gates/cooldown/lineage block | inspect queue status and digest |
| stale lock | dead owner or wrapper PID reuse | inspect lock owner before deleting |
| manifest too large | raw analysis leaked | run compactness tests and inspect manifest JSON |
| high RAM | too many workers/artifacts retained | reduce resource budget, keep debug artifacts off |
| repeated near-duplicates | local search saturated | inspect stagnation state and lane budget |
| promotion blocked despite high ROI | expectancy/matrix/lineage gate failed | inspect `matrixDecision.gates` |

## Offline data failures

### Diagnosis

Run:

```bash
npm run pine:dataset:verify
```

Healthy result: every configured primary/shadow lab prints `cacheComplete=true` and `missingCount=0`.

If incomplete:

```bash
npm run pine:dataset:pin
npm run pine:dataset:stage
npm run pine:dataset:verify
```

### Rules

- Do not weaken promotion gates because data is missing.
- Do not switch to live/network data for locked-window research unless explicitly intended.
- If source mode is `local-cache` and cache is missing, pin from network or populate cache first.
- Blind holdout missing data blocks holdout proof, not normal selection, unless configured as required preflight.

## Exchange/cache mismatch

Common error:

```text
Error: exchange ccxt-exchange not found source=ExchangeUtils.getRawCandles
```

Meaning: Backtest Kit CLI did not load the expected custom exchange schema, or strict pinned/no-cache execution passed an exchange name that the CLI runtime cannot resolve.

Checks:

1. `npm run pine:dataset:verify`
2. Confirm `pinnedData.exchangeName` matches materialized cache namespace.
3. Confirm strict pinned/no-cache path does not forward incompatible `--exchange` to CLI.
4. Confirm `pine/dump/data/candle/<exchange>/<symbol>/<timeframe>/` has expected candle files.

Fix data/cache first. Do not edit generated manifests.

## Promotion queue pause

Normal cycle pauses when a promotion is pending.

Check:

```bash
node -e "const fs=require('fs'); const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/promotion-queue.jsonl'; console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\n/).slice(-10).join('\n'):'no queue')"
```

Expected behavior:
- pending promotion blocks normal cycle
- `autopromote` consumes queue only if gates pass
- status events append; old entries are not rewritten

Use `--force-cycle` only when intentionally researching despite pending promotion.

## Lock issues

There are two lock layers:

1. JS lock: `state/autoresearch.lock.json`
2. Windows wrapper lock in scheduled-task PowerShell scripts

Safe check:

1. Read lock JSON.
2. Check `pid` exists.
3. Compare process start time with lock acquisition time.
4. Only reclaim if owner is stale/dead or PID reuse is detected.

Do not delete a fresh lock owned by a live scheduler process.

## Manifest compactness failures

Symptoms:
- manifest exceeds `resourceBudget.maxManifestBytes` if configured
- manifest JSON contains raw diagnostic marker like `Feature_RawLongPrediction`
- manifest includes heavy `analysis.rows` or trade arrays

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Inspect latest manifest:

```bash
node - <<'NODE'
const fs=require('fs');
const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json';
const s=fs.readFileSync(p,'utf8');
const j=JSON.parse(s);
console.log({ bytes: s.length, runId: j.runId, promotionEligible: j.promotionEligible });
if (s.includes('Feature_RawLongPrediction')) throw new Error('raw diagnostics leaked');
NODE
```

Fix compacting logic, not retention settings, if raw diagnostics leak.

## High RAM / slow cycle

Likely causes:
- too many lab workers
- too many retained candidates
- full debug artifacts enabled
- raw analysis kept in memory/manifest
- broad global search overused

Controls:

```json
"resourceBudget": {
  "maxConcurrentLabWorkers": 1,
  "maxRowsPerAnalysisChunk": 5000,
  "maxRetainedCandidatesPerLane": 25,
  "writeFullDebugArtifacts": false
}
```

Preferred response:
1. keep strict gates
2. reduce workers/retention/debug artifacts
3. use micro profile for smoke
4. use full profile only after micro passes

Do not remove robustness labs just to reduce memory unless explicitly changing the research contract.

## Promotion blocked

A candidate can show high ROI and still be correctly blocked.

Inspect:
- `matrixDecision.recommendation`
- `matrixDecision.gates`
- `expectancy.gate`
- `shadowPassCount` / `shadowPassRatio`
- `candidateFingerprint` and `championFingerprint`
- lineage policy summary in digest/history

Common valid blocks:
- candidate same as champion
- primary passed but shadows failed
- win rate improved but expectancy worsened
- drawdown/trade floor failed
- direct lineage reversal needs stronger proof
- cooldown or daily cap active

## Regime-exit feature not active

If expected regime-exit fields are missing from manifest:

1. Check `regimeExitResearch.enabled`.
2. Check `offlineDataSummary` for skip/hold.
3. Check selected profile and lane budget.
4. Check `shadowRegimeScoreboard` if emitted.
5. Check tests for compatibility guards.

Remember: regime-exit fields are emitted only when the feature path is enabled and reaches the manifest-building path.

## Dirty repo after runs

Autoresearch writes runtime artifacts. Most are gitignored. If repo becomes dirty:

1. Run `git status --short`.
2. Separate tracked source/config/doc changes from generated artifacts.
3. Do not commit `pine/dump`, `pine/sweeps`, or run-scoped autoresearch outputs unless intentionally tracked.
4. Pinned dataset JSONs under `pine/datasets/...` may be intentional when updating offline coverage.

## Recovery order

Use this order after an interrupted or failed run:

1. `git status --short`
2. inspect lock owner
3. inspect promotion queue
4. `npm run pine:dataset:verify`
5. `npm run pine:autoresearch:digest`
6. run focused tests for touched area
7. retry micro cycle
8. retry full cycle

## Evidence to capture in reports

When reporting a fix or blocker, include:
- command run
- exit code
- test summary
- latest `runId`, if relevant
- manifest path, if relevant
- queue item id, if relevant
- exact blocker reason (`offlineDataMissing`, gate name, lock owner, etc.)
- repo status

## See also

- [Pine autoresearch](../pine-autoresearch.md)
- [Pine regime-exit research](../pine-regime-exit-research.md)
- [Autoresearch config reference](../reference/autoresearch-config.md)
- [Autoresearch artifacts reference](../reference/autoresearch-artifacts.md)
- [Operations](../operations.md)
