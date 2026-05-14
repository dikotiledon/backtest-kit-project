# Expand Autoresearch Parameter Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the autoresearch stagnation by expanding the search space from 2 families (signal, risk) to the full 14-family parameter surface, enabling untapped modules (exit-state, ML-core, squeeze, AVWAP, channel, supertrend) to be explored.

**Architecture:** Config-only changes + one new seed file. No code changes needed — the infrastructure already supports all 14 families, it's just not configured to use them.

**Tech Stack:** JSON config files, Node.js native test runner

---

[Overview]

The autoresearch system has 91 active parameters across 14 families, but the config only searches within 2 families ("signal" and "risk"). The champion uses 12 parameters. 79 parameters are never explored. Entire modules are disabled (exit-state, AVWAP, channel context, ML-core tuning). The system is stuck because it exhausted the tiny search space it was allowed to explore.

The fix is purely configuration: expand `exploitFamilies`/`exploreFamilies`, add research tracks for untapped modules, and create an alternative seed that enables more modules for parallel exploration.

The Pine script already has all the indicators implemented and the parameter surface catalog already defines all the parameters with bounds. The patchers already exist in pine-tuner.mjs. We just need to tell the autoresearch to USE them.

---

[Types]

No type changes needed. All parameter families, bounds, and patchers already exist in the codebase.

---

[Files]

Config and seed file changes only.

**Modified files:**
- `config/pine-autoresearch.default.json` — Expand search families, add research tracks, widen stagnation fallback
- `config/pine-autoresearch.seed.json` — Keep as-is (current champion baseline)

**New files:**
- `config/pine-autoresearch-exploration.seed.json` — Alternative seed with more modules enabled for broader exploration

---

[Functions]

No function changes needed. The infrastructure already supports:
- `buildGlobalMutationBatch` — mutates any family
- `buildTrackCandidateBatch` — generates candidates for any track family
- `buildIncumbentSearchBatch` — uses configured `exploitFamilies`/`exploreFamilies`
- `buildRegimeAwareSearchBatch` — uses configured lanes

---

[Classes]

No class changes needed.

---

[Dependencies]

No dependency changes needed.

---

[Testing]

Run existing tests after config changes to verify no regressions:
```bash
node --test tests/pine-autoresearch.test.mjs
node --test tests/pine-search-policy.test.mjs
node --test tests/pine-track-generators.test.mjs
```

Then run one autoresearch cycle to verify candidates are generated:
```bash
npm run pine:autoresearch
```

Expected: cycle completes with actual candidates tested (not "no-variants-generated").

---

[Implementation Order]

### Task 1: Expand exploit/explore families in config

**File:** `config/pine-autoresearch.default.json`

Change `searchPolicy.exploitFamilies` and `searchPolicy.exploreFamilies` from `["signal", "risk"]` to include the full active surface:

```json
"exploitFamilies": ["signal", "risk", "exit-state", "ml-core", "fusion", "supertrend"],
"exploreFamilies": ["signal", "risk", "exit-state", "ml-core", "fusion", "supertrend", "squeeze", "divergence", "avwap-context", "channel-context"]
```

Rationale:
- `exploitFamilies` — families to mutate when exploiting near the champion (focused, high-value)
- `exploreFamilies` — families to mutate when exploring broadly (all active families)
- Keep exploit focused on 6 high-impact families
- Let explore cover all 10 families with patchers

Also update `selfLoopEscape.fallbackFamilies` and `selfLoopEscape.stagnationFallbackFamilies`:

```json
"fallbackFamilies": ["signal", "risk", "exit-state", "ml-core", "fusion"],
"stagnationFallbackFamilies": ["signal", "risk", "exit-state", "ml-core", "fusion", "supertrend", "squeeze", "divergence", "avwap-context", "channel-context"]
```

- [ ] Step 1: Edit config/pine-autoresearch.default.json searchPolicy section
- [ ] Step 2: Run `node --test --test-name-pattern "default autoresearch config" tests/pine-autoresearch.test.mjs` — update test if needed
- [ ] Step 3: Commit

### Task 2: Add research tracks for untapped modules

**File:** `config/pine-autoresearch.default.json`

Add new research tracks to `researchTracks` array:

```json
{
  "trackId": "exit-state-research",
  "name": "Exit state features",
  "sourceFamily": "exit-state",
  "gridName": "phase3-core",
  "variantMode": "grid",
  "windowSet": "rotating",
  "enabled": true,
  "promotionPolicy": { "requireCandidateChange": true },
  "stopPolicy": { "maxNoChangeStreak": 5 }
},
{
  "trackId": "ml-core-tuning",
  "name": "ML core parameters",
  "sourceFamily": "ml-core",
  "gridName": "phase3-core",
  "variantMode": "grid",
  "windowSet": "primary",
  "enabled": true,
  "promotionPolicy": { "requireCandidateChange": true },
  "stopPolicy": { "maxNoChangeStreak": 5 }
},
{
  "trackId": "supertrend-tuning",
  "name": "Supertrend parameters",
  "sourceFamily": "supertrend",
  "gridName": "phase3-core",
  "variantMode": "grid",
  "windowSet": "rotating",
  "enabled": true,
  "promotionPolicy": { "requireCandidateChange": true },
  "stopPolicy": { "maxNoChangeStreak": 5 }
}
```

- [ ] Step 1: Add tracks to config
- [ ] Step 2: Run `node --test tests/pine-autoresearch.test.mjs` — verify no regressions
- [ ] Step 3: Commit

### Task 3: Create exploration seed with more modules enabled

**File:** `config/pine-autoresearch-exploration.seed.json`

Create a seed that starts with the current champion but enables additional modules:

```json
{
  "configId": "exploration-seed-v1",
  "config": {
    "useRegimeFilter": false,
    "useVolatilityFilter": false,
    "useAdxFilter": true,
    "adxThreshold": 20,
    "minPredSum": 1.8,
    "useTrendXConf": true,
    "minBarsBetween": 1,
    "slAtrMult": 0.5,
    "tpAtrMult": 7.6,
    "useSignalFusion": true,
    "useFusionV2": false,
    "useFusionV3": false,
    "useFusionV4": true,
    "fusionV4MinAbsPrediction": 2,
    "fusionV4MaxAbsPrediction": 4,
    "useAtrFlipConfirm": true,
    "use3LineConfirm": false,
    "useEngulfingConfirm": true,
    "useEmaCrossConfirm": false,
    "fusionV4LongAtrWeight": -0.25,
    "fusionV4LongEngulfWeight": -0.25,
    "fusionV4LongEmaWeight": 0,
    "fusionV4ShortAtrWeight": -0.5,
    "fusionV4ShortEngulfWeight": -0.1,
    "fusionV4ShortEmaWeight": 0,
    "useSupertrendFilter": true,
    "useSupertrendEntryConfirm": false,
    "supertrendAtrLen": 10,
    "supertrendFactor": 1.5,
    "useTrailingStop": true,
    "trailAtrLen": 14,
    "trailAtrMult": 1,
    "trailActivateR": 0.5,
    "useStopsTP": true,
    "useDivergenceContext": true,
    "divFreshBars": 8,
    "divPivotLeft": 3,
    "divPivotRight": 3,
    "divRsiLen": 21,
    "divLongBoostValue": 0.7,
    "divShortBoostValue": 0.7,
    "useSqueezeContext": true,
    "sqzLen": 20,
    "sqzBbMult": 2.0,
    "sqzKcMult": 1.5,
    "sqzLongBoostValue": 0.5,
    "sqzShortBoostValue": 0.5,
    "useTimeStop": true,
    "timeStopBars": 16,
    "useBreakevenStop": true,
    "breakevenActivateR": 1.0,
    "neighborsCount": 32,
    "h": 8,
    "r": 8,
    "x": 25
  }
}
```

This seed enables: squeeze context + time stop + breakeven stop + ML-core params. The autoresearch will optimize from this starting point.

- [ ] Step 1: Create the seed file
- [ ] Step 2: Commit

### Task 4: Reset scheduler state for fresh exploration

After config changes, reset the scheduler state so the system starts fresh with the expanded search space:

```bash
node -e "const fs=require('fs');const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.tabuRejectedFingerprints=[];s.stagnationLevel=0;s.stagnationReason=null;s.noChangeStreak=0;s.noNewCandidateStreak=0;s.lowEmissionStreak=0;s.sameTrackCycleStreak=0;s.laneExhaustions={};s.lastEscalatedAt=null;s.blockedPromotionFingerprints=[];s.budgetDebt={exploit:0,exitRegime:0,globalAllParameter:0,robustness:0};fs.writeFileSync(p,JSON.stringify(s,null,2));console.log('Reset complete')"
```

- [ ] Step 1: Run the reset command
- [ ] Step 2: Run `npm run pine:autoresearch` and verify candidates are generated across new families
- [ ] Step 3: Verify the cycle completes with actual backtests (not "no-variants-generated")

### Task 5: Verify end-to-end

- [ ] Step 1: Run full test suite: `node --test` — all pass
- [ ] Step 2: Run autoresearch cycle: `npm run pine:autoresearch` — generates candidates from new families
- [ ] Step 3: Check the manifest shows variants from exit-state, ml-core, or other new families
- [ ] Step 4: Commit all changes

---

## What This Unlocks

| Module | Parameters | Current State | After This Plan |
|--------|-----------|---------------|-----------------|
| ML-core | neighborsCount, h, r, x | At defaults (8,8,25,32) | Actively optimized |
| Exit-state | useTimeStop, timeStopBars, useBreakevenStop, etc. | All disabled | Explored via track |
| Squeeze context | sqzLen, sqzBbMult, sqzKcMult, boosts | Disabled | Explored via track + seed |
| Supertrend | supertrendAtrLen, supertrendFactor | At defaults (10, 1.5) | Actively optimized |
| Fusion weights | 6 weight params | At initial values | Included in exploit |
| AVWAP context | 6 params | Disabled | In explore families |
| Channel context | 7 params | Disabled | In explore families |

**Expected outcome:** The system will have 10x more parameter space to explore, enabling discovery of better trading configurations that combine multiple indicators and exit strategies.