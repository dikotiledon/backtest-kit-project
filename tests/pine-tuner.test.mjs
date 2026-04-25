import fs from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPatchPlan,
  applyPatchPlan,
  cartesianProduct,
  filterSweepCombos,
  rankSweepResults,
  getCandidateGrid,
  selectSweepCombos,
  normalizeVariantRecords,
} from '../scripts/lib/pine-tuner.mjs';
import { allocateLaneBudget, buildIncumbentSearchBatch } from '../scripts/lib/pine-search-policy.mjs';

test('allocateLaneBudget keeps an 80/20 split while guaranteeing at least one explore slot', () => {
  assert.deepEqual(allocateLaneBudget(8, 0.8), { exploit: 6, explore: 2 });
  assert.deepEqual(allocateLaneBudget(5, 0.8), { exploit: 4, explore: 1 });
  assert.deepEqual(allocateLaneBudget(1, 0.8), { exploit: 1, explore: 0 });
});

test('buildIncumbentSearchBatch freezes strategy architecture and emits lane metadata', () => {
  const incumbent = {
    useSignalFusion: true,
    useFusionV2: false,
    useFusionV3: false,
    useFusionV4: true,
    useSupertrendFilter: true,
    useTrailingStop: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    lag: 2,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 2.5,
    trailAtrLen: 14,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };

  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    policy: {
      exploitRatio: 0.8,
      freezeArchitecture: true,
      exploitFamilies: ['signal', 'risk'],
      exploreFamilies: ['signal'],
    },
  });

  assert.equal(batch.length, 8);
  assert.equal(batch.filter((item) => item.lane === 'exploit').length, 6);
  assert.equal(batch.filter((item) => item.lane === 'explore').length, 2);

  for (const item of batch) {
    assert.equal(item.config.useSignalFusion, true);
    assert.equal(item.config.useFusionV2, false);
    assert.equal(item.config.useFusionV3, false);
    assert.equal(item.config.useFusionV4, true);
    assert.equal(item.config.useSupertrendFilter, true);
    assert.equal(item.config.useTrailingStop, true);
    assert.match(item.variantId, /^(exploit|explore)-/);
  }
});

test('buildIncumbentSearchBatch rotates exploit families by cycle count', () => {
  const incumbent = {
    useSignalFusion: true,
    useFusionV2: false,
    useFusionV3: false,
    useFusionV4: true,
    useSupertrendFilter: true,
    useTrailingStop: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    lag: 2,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 2.5,
    trailAtrLen: 14,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };

  const cycle0Families = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 4,
    historyEvents: [],
    policy: {
      exploitRatio: 0.5,
      freezeArchitecture: true,
      exploitFamilies: ['signal', 'risk'],
      exploreFamilies: ['signal'],
    },
  }).map((variant) => variant.family);

  const cycle1Families = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 4,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      exploitRatio: 0.5,
      freezeArchitecture: true,
      exploitFamilies: ['signal', 'risk'],
      exploreFamilies: ['signal'],
    },
  }).map((variant) => variant.family);

  assert.deepEqual(cycle0Families, ['signal', 'risk', 'signal', 'signal']);
  assert.deepEqual(cycle1Families, ['risk', 'signal', 'signal', 'signal']);
});

test('cartesianProduct expands candidate grid into all combinations', () => {
  const combos = cartesianProduct({
    a: [1, 2],
    b: [true, false],
    c: ['x'],
  });

  assert.equal(combos.length, 4);
  assert.deepEqual(combos[0], { a: 1, b: true, c: 'x' });
  assert.deepEqual(combos[3], { a: 2, b: false, c: 'x' });
});

test('applyPatchPlan patches input defaults and preserves other text', () => {
  const source = [
    'useTrendXConf = input.bool(true, title="Require Confirmation Trend (x)")',
    'minPredSum = input.float(2.5, title="Min Prediction Sum")',
    'neighbors = input.int(title=\'Neighbors Count\', defval=8)',
  ].join('\n');

  const plan = buildPatchPlan({
    useTrendXConf: false,
    minPredSum: 1.5,
    neighborsCount: 13,
  });

  const patched = applyPatchPlan(source, plan);

  assert.match(patched, /input\.bool\(false, title="Require Confirmation Trend \(x\)"\)/);
  assert.match(patched, /input\.float\(1\.5, title="Min Prediction Sum"\)/);
  assert.match(patched, /title='Neighbors Count', defval=13\)/);
});

test('rankSweepResults sorts by score then roi then win rate', () => {
  const ranked = rankSweepResults([
    { configId: 'b', score: 20, metrics: { roiPct: 10, winRatePct: 50, tradeCount: 20 } },
    { configId: 'a', score: 25, metrics: { roiPct: 5, winRatePct: 40, tradeCount: 10 } },
    { configId: 'c', score: 25, metrics: { roiPct: 15, winRatePct: 35, tradeCount: 8 } },
  ]);

  assert.deepEqual(ranked.map((r) => r.configId), ['c', 'a', 'b']);
});

test('buildPatchPlan ignores deprecated side toggles and still patches exit multipliers', () => {
  const plan = buildPatchPlan({
    useLongSide: false,
    useShortSide: false,
    slAtrMult: 1.25,
    tpAtrMult: 2.0,
  });

  assert.deepEqual(plan.map((step) => step.key), ['slAtrMult', 'tpAtrMult']);
});

test('applyPatchPlan patches filter toggles and thresholds for focused sweeps', () => {
  const source = [
    'FilterSettings filterSettings = FilterSettings.new(input.bool(title="Use Volatility Filter", defval=true, tooltip="Whether to use the volatility filter.", group="Filters"), input.bool(title="Use Regime Filter", defval=true, group="Filters", inline="regime"), input.bool(title="Use ADX Filter", defval=true, group="Filters", inline="adx"), input.float(title="Threshold", defval=-0.1, minval=-10, maxval=10, step=0.1, tooltip="Whether to use the trend detection filter. Threshold for detecting Trending/Ranging markets.", group="Filters", inline="regime"), input.int(title="Threshold", defval=20, minval=0, maxval=100, step=1, tooltip="Whether to use the ADX filter. Threshold for detecting Trending/Ranging markets.", group="Filters", inline="adx"))',
  ].join('\n');

  const plan = buildPatchPlan({
    useVolatilityFilter: false,
    useRegimeFilter: false,
    useAdxFilter: false,
    regimeThreshold: -1.5,
    adxThreshold: 10,
  });

  const patched = applyPatchPlan(source, plan);

  assert.match(patched, /Use Volatility Filter", defval=false/);
  assert.match(patched, /Use Regime Filter", defval=false/);
  assert.match(patched, /Use ADX Filter", defval=false/);
  assert.match(patched, /input\.float\(title="Threshold", defval=-1\.5[^\n]*inline="regime"/);
  assert.match(patched, /input\.int\(title="Threshold", defval=10[^\n]*inline="adx"/);
});

test('getCandidateGrid returns focused blocker grid', () => {
  const grid = getCandidateGrid('focused');

  assert.deepEqual(grid.useVolatilityFilter, [false, true]);
  assert.deepEqual(grid.useRegimeFilter, [false, true]);
  assert.deepEqual(grid.useAdxFilter, [false, true]);
  assert.deepEqual(grid.regimeThreshold, [-1.5, -0.5, 0.5]);
  assert.deepEqual(grid.adxThreshold, [10, 20]);
  assert.deepEqual(grid.minPredSum, [0.5, 1.0]);
  assert.deepEqual(grid.useTrendXConf, [false, true]);
  assert.deepEqual(grid.minBarsBetween, [0]);
});

test('getCandidateGrid returns root-cause grid with regime filter disabled', () => {
  const grid = getCandidateGrid('root-cause');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false, true]);
  assert.deepEqual(grid.useAdxFilter, [false, true]);
  assert.deepEqual(grid.adxThreshold, [10, 20]);
  assert.deepEqual(grid.minPredSum, [0.5, 1.0, 1.5]);
  assert.deepEqual(grid.useTrendXConf, [false, true]);
  assert.deepEqual(grid.minBarsBetween, [0, 2]);
});

test('getCandidateGrid returns profit-candidate grid on the best branch', () => {
  const grid = getCandidateGrid('profit-candidate');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false, true]);
  assert.deepEqual(grid.useAdxFilter, [false, true]);
  assert.deepEqual(grid.adxThreshold, [10, 20]);
  assert.deepEqual(grid.minPredSum, [0.5, 1.0, 1.5]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
});

test('applyPatchPlan patches atr stop-target multipliers without side controls', () => {
  const source = [
    'slAtrMult      = input.float(1.5,  title="SL ATR x", minval=0.1, step=0.1, group="Strategy")',
    'tpAtrMult      = input.float(1.5,  title="TP ATR x (1:1 R:R by default)", minval=0.1, step=0.1, group="Strategy")',
  ].join('\n');

  const plan = buildPatchPlan({
    slAtrMult: 1.2,
    tpAtrMult: 2.4,
  });

  const patched = applyPatchPlan(source, plan);

  assert.match(patched, /slAtrMult\s*=\s*input\.float\(1\.2,\s+title="SL ATR x"/);
  assert.match(patched, /tpAtrMult\s*=\s*input\.float\(2\.4,\s+title="TP ATR x \(1:1 R:R by default\)"/);
});

test('getCandidateGrid returns exit-tuning grid without side toggles', () => {
  const grid = getCandidateGrid('exit-tuning');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false]);
  assert.deepEqual(grid.useAdxFilter, [true]);
  assert.deepEqual(grid.adxThreshold, [20]);
  assert.deepEqual(grid.minPredSum, [0.5, 1.0]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
  assert.equal('useLongSide' in grid, false);
  assert.equal('useShortSide' in grid, false);
  assert.deepEqual(grid.slAtrMult, [1.0, 1.25, 1.5, 2.0]);
  assert.deepEqual(grid.tpAtrMult, [1.0, 1.5, 2.0, 2.5]);
});

test('applyPatchPlan patches signal-fusion inputs', () => {
  const source = [
    'useSignalFusion = input.bool(false, title="Use Signal Fusion", group="Edge Controls")',
    'minFusionScore = input.int(1, title="Min Fusion Score", minval=0, maxval=4, group="Edge Controls")',
    'useAtrFlipConfirm = input.bool(true, title="Use ATR Flip Confirm", group="Signal Fusion")',
    'use3LineConfirm = input.bool(true, title="Use 3 Line Strike Confirm", group="Signal Fusion")',
    'useEngulfingConfirm = input.bool(true, title="Use Engulfing Confirm", group="Signal Fusion")',
    'useEmaCrossConfirm = input.bool(true, title="Use EMA Cross Confirm", group="Signal Fusion")',
    'useFusionV2 = input.bool(false, title="Use Fusion V2 Soft Mode", group="Signal Fusion V2")',
    'fusionBonusPerSignal = input.float(0.25, title="Fusion Bonus Per Signal", minval=0.0, step=0.05, group="Signal Fusion V2")',
    'fusionMaxBonus = input.float(0.50, title="Fusion Max Bonus", minval=0.0, step=0.05, group="Signal Fusion V2")',
    'useFusionV3 = input.bool(false, title="Use Fusion V3 Threshold Shaping", group="Signal Fusion V3")',
    'fusionPenaltyPerMissing = input.float(0.25, title="Fusion Penalty Per Missing Signal", minval=0.0, step=0.05, group="Signal Fusion V3")',
    'useFusionV4 = input.bool(false, title="Use Fusion V4 Residual Layer", group="Signal Fusion V4")',
    'fusionV4MinAbsPrediction = input.float(2.0, title="Fusion V4 Min |Prediction|", minval=0.0, step=0.5, group="Signal Fusion V4")',
    'fusionV4MaxAbsPrediction = input.float(4.0, title="Fusion V4 Max |Prediction|", minval=0.0, step=0.5, group="Signal Fusion V4")',
    'fusionV4LongAtrWeight = input.float(-0.25, title="Fusion V4 Long ATR Weight", step=0.05, group="Signal Fusion V4")',
    'fusionV4LongEngulfWeight = input.float(-0.25, title="Fusion V4 Long Engulf Weight", step=0.05, group="Signal Fusion V4")',
    'fusionV4LongEmaWeight = input.float(0.0, title="Fusion V4 Long EMA Weight", step=0.05, group="Signal Fusion V4")',
    'fusionV4ShortAtrWeight = input.float(-0.5, title="Fusion V4 Short ATR Weight", step=0.05, group="Signal Fusion V4")',
    'fusionV4ShortEngulfWeight = input.float(-0.1, title="Fusion V4 Short Engulf Weight", step=0.05, group="Signal Fusion V4")',
    'fusionV4ShortEmaWeight = input.float(0.0, title="Fusion V4 Short EMA Weight", step=0.05, group="Signal Fusion V4")',
  ].join('\n');

  const plan = buildPatchPlan({
    useSignalFusion: true,
    minFusionScore: 2,
    useAtrFlipConfirm: false,
    use3LineConfirm: false,
    useEngulfingConfirm: true,
    useEmaCrossConfirm: false,
    useFusionV2: true,
    fusionBonusPerSignal: 0.5,
    fusionMaxBonus: 1.0,
    useFusionV3: true,
    fusionPenaltyPerMissing: 0.25,
    useFusionV4: true,
    fusionV4MinAbsPrediction: 2.0,
    fusionV4MaxAbsPrediction: 4.0,
    fusionV4LongAtrWeight: -0.25,
    fusionV4LongEngulfWeight: -0.25,
    fusionV4LongEmaWeight: 0.0,
    fusionV4ShortAtrWeight: -0.5,
    fusionV4ShortEngulfWeight: -0.1,
    fusionV4ShortEmaWeight: 0.0,
  });

  const patched = applyPatchPlan(source, plan);

  assert.match(patched, /useSignalFusion\s*=\s*input\.bool\(true,\s+title="Use Signal Fusion"/);
  assert.match(patched, /minFusionScore\s*=\s*input\.int\(2,\s+title="Min Fusion Score"/);
  assert.match(patched, /useAtrFlipConfirm\s*=\s*input\.bool\(false,\s+title="Use ATR Flip Confirm"/);
  assert.match(patched, /use3LineConfirm\s*=\s*input\.bool\(false,\s+title="Use 3 Line Strike Confirm"/);
  assert.match(patched, /useEngulfingConfirm\s*=\s*input\.bool\(true,\s+title="Use Engulfing Confirm"/);
  assert.match(patched, /useEmaCrossConfirm\s*=\s*input\.bool\(false,\s+title="Use EMA Cross Confirm"/);
  assert.match(patched, /useFusionV2\s*=\s*input\.bool\(true,\s+title="Use Fusion V2 Soft Mode"/);
  assert.match(patched, /fusionBonusPerSignal\s*=\s*input\.float\(0\.5,\s+title="Fusion Bonus Per Signal"/);
  assert.match(patched, /fusionMaxBonus\s*=\s*input\.float\(1,\s+title="Fusion Max Bonus"/);
  assert.match(patched, /useFusionV3\s*=\s*input\.bool\(true,\s+title="Use Fusion V3 Threshold Shaping"/);
  assert.match(patched, /fusionPenaltyPerMissing\s*=\s*input\.float\(0\.25,\s+title="Fusion Penalty Per Missing Signal"/);
  assert.match(patched, /useFusionV4\s*=\s*input\.bool\(true,\s+title="Use Fusion V4 Residual Layer"/);
  assert.match(patched, /fusionV4MinAbsPrediction\s*=\s*input\.float\(2,\s+title="Fusion V4 Min \|Prediction\|"/);
  assert.match(patched, /fusionV4MaxAbsPrediction\s*=\s*input\.float\(4,\s+title="Fusion V4 Max \|Prediction\|"/);
  assert.match(patched, /fusionV4LongAtrWeight\s*=\s*input\.float\(-0\.25,\s+title="Fusion V4 Long ATR Weight"/);
  assert.match(patched, /fusionV4LongEngulfWeight\s*=\s*input\.float\(-0\.25,\s+title="Fusion V4 Long Engulf Weight"/);
  assert.match(patched, /fusionV4LongEmaWeight\s*=\s*input\.float\(0,\s+title="Fusion V4 Long EMA Weight"/);
  assert.match(patched, /fusionV4ShortAtrWeight\s*=\s*input\.float\(-0\.5,\s+title="Fusion V4 Short ATR Weight"/);
  assert.match(patched, /fusionV4ShortEngulfWeight\s*=\s*input\.float\(-0\.1,\s+title="Fusion V4 Short Engulf Weight"/);
  assert.match(patched, /fusionV4ShortEmaWeight\s*=\s*input\.float\(0,\s+title="Fusion V4 Short EMA Weight"/);
});

test('getCandidateGrid returns fusion-safe grid', () => {
  const grid = getCandidateGrid('fusion-safe');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false]);
  assert.deepEqual(grid.useAdxFilter, [true]);
  assert.deepEqual(grid.adxThreshold, [20]);
  assert.deepEqual(grid.minPredSum, [0.5]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
  assert.deepEqual(grid.slAtrMult, [1.0]);
  assert.deepEqual(grid.tpAtrMult, [2.5]);
  assert.deepEqual(grid.useSignalFusion, [false, true]);
  assert.deepEqual(grid.minFusionScore, [1, 2]);
  assert.deepEqual(grid.useAtrFlipConfirm, [false, true]);
  assert.deepEqual(grid.use3LineConfirm, [false, true]);
  assert.deepEqual(grid.useEngulfingConfirm, [false, true]);
  assert.deepEqual(grid.useEmaCrossConfirm, [false, true]);
});

test('getCandidateGrid returns fusion-v2 grid', () => {
  const grid = getCandidateGrid('fusion-v2');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false]);
  assert.deepEqual(grid.useAdxFilter, [true]);
  assert.deepEqual(grid.adxThreshold, [20]);
  assert.deepEqual(grid.minPredSum, [0.5, 0.75, 1.0]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
  assert.deepEqual(grid.slAtrMult, [1.0]);
  assert.deepEqual(grid.tpAtrMult, [2.5]);
  assert.deepEqual(grid.useSignalFusion, [true]);
  assert.deepEqual(grid.useFusionV2, [true]);
  assert.deepEqual(grid.fusionBonusPerSignal, [0.25, 0.5]);
  assert.deepEqual(grid.fusionMaxBonus, [0.5, 1.0]);
  assert.deepEqual(grid.useAtrFlipConfirm, [true]);
  assert.deepEqual(grid.use3LineConfirm, [false, true]);
  assert.deepEqual(grid.useEngulfingConfirm, [false]);
  assert.deepEqual(grid.useEmaCrossConfirm, [false, true]);
});

test('getCandidateGrid returns fusion-v3 grid', () => {
  const grid = getCandidateGrid('fusion-v3');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false]);
  assert.deepEqual(grid.useAdxFilter, [true]);
  assert.deepEqual(grid.adxThreshold, [20]);
  assert.deepEqual(grid.minPredSum, [0.5, 0.75, 1.0]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
  assert.deepEqual(grid.slAtrMult, [1.0]);
  assert.deepEqual(grid.tpAtrMult, [2.5]);
  assert.deepEqual(grid.useSignalFusion, [true]);
  assert.deepEqual(grid.useFusionV2, [false]);
  assert.deepEqual(grid.useFusionV3, [true]);
  assert.deepEqual(grid.fusionBonusPerSignal, [0.25, 0.5]);
  assert.deepEqual(grid.fusionMaxBonus, [0.5, 1.0]);
  assert.deepEqual(grid.fusionPenaltyPerMissing, [0.25, 0.5]);
  assert.deepEqual(grid.useAtrFlipConfirm, [true]);
  assert.deepEqual(grid.use3LineConfirm, [false, true]);
  assert.deepEqual(grid.useEngulfingConfirm, [false]);
  assert.deepEqual(grid.useEmaCrossConfirm, [false, true]);
});

test('getCandidateGrid returns fusion-v4 grid', () => {
  const grid = getCandidateGrid('fusion-v4');

  assert.deepEqual(grid.useRegimeFilter, [false]);
  assert.deepEqual(grid.useVolatilityFilter, [false]);
  assert.deepEqual(grid.useAdxFilter, [true]);
  assert.deepEqual(grid.adxThreshold, [20]);
  assert.deepEqual(grid.minPredSum, [2.0]);
  assert.deepEqual(grid.useTrendXConf, [true]);
  assert.deepEqual(grid.minBarsBetween, [2]);
  assert.deepEqual(grid.slAtrMult, [1.0]);
  assert.deepEqual(grid.tpAtrMult, [2.5]);
  assert.deepEqual(grid.useSignalFusion, [true]);
  assert.deepEqual(grid.useFusionV2, [false]);
  assert.deepEqual(grid.useFusionV3, [false]);
  assert.deepEqual(grid.useFusionV4, [true]);
  assert.deepEqual(grid.fusionV4MinAbsPrediction, [2.0]);
  assert.deepEqual(grid.fusionV4MaxAbsPrediction, [4.0]);
  assert.deepEqual(grid.useAtrFlipConfirm, [true]);
  assert.deepEqual(grid.use3LineConfirm, [false]);
  assert.deepEqual(grid.useEngulfingConfirm, [false, true]);
  assert.deepEqual(grid.useEmaCrossConfirm, [false, true]);
  assert.deepEqual(grid.fusionV4LongAtrWeight, [-0.25]);
  assert.deepEqual(grid.fusionV4LongEngulfWeight, [-0.25]);
  assert.deepEqual(grid.fusionV4LongEmaWeight, [0.0]);
  assert.deepEqual(grid.fusionV4ShortAtrWeight, [-0.5]);
  assert.deepEqual(grid.fusionV4ShortEngulfWeight, [-0.1, 0.0]);
  assert.deepEqual(grid.fusionV4ShortEmaWeight, [0.0, 0.25]);
});

test('filterSweepCombos collapses redundant fusion-disabled combos', () => {
  const combos = [
    { useSignalFusion: false, minFusionScore: 1, useAtrFlipConfirm: false, use3LineConfirm: false, useEngulfingConfirm: false, useEmaCrossConfirm: false },
    { useSignalFusion: false, minFusionScore: 2, useAtrFlipConfirm: true, use3LineConfirm: true, useEngulfingConfirm: true, useEmaCrossConfirm: true },
    { useSignalFusion: true, minFusionScore: 1, useAtrFlipConfirm: false, use3LineConfirm: false, useEngulfingConfirm: false, useEmaCrossConfirm: false },
    { useSignalFusion: true, minFusionScore: 1, useAtrFlipConfirm: true, use3LineConfirm: false, useEngulfingConfirm: false, useEmaCrossConfirm: false },
  ];

  const filtered = filterSweepCombos(combos);

  assert.equal(filtered.length, 3);
  assert.deepEqual(filtered[0], combos[0]);
  assert.deepEqual(filtered[1], combos[2]);
  assert.deepEqual(filtered[2], combos[3]);
});

test('filterSweepCombos collapses redundant fusion-v4 weight combos when related confirms are disabled', () => {
  const combos = [
    {
      useSignalFusion: true,
      useFusionV4: true,
      useAtrFlipConfirm: true,
      use3LineConfirm: false,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: false,
      fusionV4ShortEngulfWeight: -0.1,
      fusionV4ShortEmaWeight: 0.0,
    },
    {
      useSignalFusion: true,
      useFusionV4: true,
      useAtrFlipConfirm: true,
      use3LineConfirm: false,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: false,
      fusionV4ShortEngulfWeight: 0.0,
      fusionV4ShortEmaWeight: 0.25,
    },
  ];

  const filtered = filterSweepCombos(combos);

  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0], combos[0]);
});

test('getCandidateGrid returns expanded phase3-core grid with broader strategy knobs', () => {
  const grid = getCandidateGrid('phase3-core');

  assert.deepEqual(grid.neighborsCount, [24, 32, 48]);
  assert.deepEqual(grid.useVolatilityFilter, [false, true]);
  assert.deepEqual(grid.useRegimeFilter, [false, true]);
  assert.deepEqual(grid.regimeThreshold, [-0.5, -0.1, 0.5]);
  assert.deepEqual(grid.adxThreshold, [15, 20, 25]);
  assert.deepEqual(grid.useEmaFilter, [false, true]);
  assert.deepEqual(grid.emaPeriod, [50, 100, 150, 200, 300]);
  assert.deepEqual(grid.useSmaFilter, [false, true]);
  assert.deepEqual(grid.smaPeriod, [50, 100, 150, 200, 300]);
  assert.deepEqual(grid.h, [4, 5, 8, 10, 13, 16, 21]);
  assert.deepEqual(grid.r, [0.5, 1.0, 2.0, 4.0, 8.0, 16.0]);
  assert.deepEqual(grid.x, [2, 5, 8, 12, 16, 20, 25]);
  assert.deepEqual(grid.lag, [1, 2]);
  assert.deepEqual(grid.riskAtrLen, [7, 10, 14, 21, 28]);
  assert.deepEqual(grid.useSignalExits, [false, true]);
  assert.deepEqual(grid.slAtrMult, [0.75, 1.0, 1.25, 1.5, 2.0]);
  assert.deepEqual(grid.tpAtrMult, [1.5, 2.0, 2.5, 3.0, 4.0, 5.0]);
  assert.deepEqual(grid.supertrendAtrLen, [7, 10, 14]);
  assert.deepEqual(grid.supertrendFactor, [1.5, 2.0, 2.5]);
  assert.deepEqual(grid.trailAtrLen, [7, 14, 21]);
  assert.deepEqual(grid.trailAtrMult, [1.0, 1.5, 2.0]);
  assert.deepEqual(grid.trailActivateR, [0.5, 1.0, 1.5]);
});

test('selectSweepCombos rotates candidate batches with wrap-around', () => {
  const grid = {
    a: [1, 2, 3],
    b: ['x', 'y'],
  };

  const batch = selectSweepCombos(grid, { maxConfigs: 4, offset: 4 });

  assert.deepEqual(batch, [
    { a: 3, b: 'x' },
    { a: 3, b: 'y' },
    { a: 1, b: 'x' },
    { a: 1, b: 'y' },
  ]);
});

test('buildIncumbentSearchBatch preserves incumbent architecture when freezeArchitecture is false', () => {
  const incumbent = {
    useSignalFusion: false,
    useFusionV2: true,
    useFusionV3: true,
    useFusionV4: false,
    useSupertrendFilter: false,
    useTrailingStop: false,
    useStopsTP: false,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    lag: 2,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 2.5,
    trailAtrLen: 14,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };

  const [variant] = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: {
      freezeArchitecture: false,
      exploitRatio: 0.8,
      exploitFamilies: ['signal'],
      exploreFamilies: ['signal'],
    },
  });

  assert.equal(variant.config.useSignalFusion, false);
  assert.equal(variant.config.useFusionV2, true);
  assert.equal(variant.config.useFusionV3, true);
  assert.equal(variant.config.useFusionV4, false);
  assert.equal(variant.config.useSupertrendFilter, false);
  assert.equal(variant.config.useTrailingStop, false);
  assert.equal(variant.config.useStopsTP, false);
});

test('pine test script defaults to the hardened fusion v4 profile', async () => {
  const source = await fs.readFile(new URL('../pine/test.pine', import.meta.url), 'utf8');

  assert.match(source, /Use Volatility Filter", defval=false/);
  assert.match(source, /Use Regime Filter", defval=false/);
  assert.match(source, /Use ADX Filter", defval=true/);
  assert.match(source, /useTrendXConf\s*=\s*input\.bool\(true,\s+title="Require Confirmation Trend \(x\)"/);
  assert.match(source, /minPredSum\s*=\s*input\.float\(2(?:\.0)?,\s+title="Min Prediction Sum \(strength\)"/);
  assert.match(source, /minBarsBetween\s*=\s*input\.int\(2,\s+title="Cooldown Bars Between Entries"/);
  assert.match(source, /useSignalFusion\s*=\s*input\.bool\(true,\s+title="Use Signal Fusion"/);
  assert.match(source, /useAtrFlipConfirm\s*=\s*input\.bool\(true,\s+title="Use ATR Flip Confirm"/);
  assert.match(source, /use3LineConfirm\s*=\s*input\.bool\(false,\s+title="Use 3 Line Strike Confirm"/);
  assert.match(source, /useEngulfingConfirm\s*=\s*input\.bool\(true,\s+title="Use Engulfing Confirm"/);
  assert.match(source, /useEmaCrossConfirm\s*=\s*input\.bool\(false,\s+title="Use EMA Cross Confirm"/);
  assert.match(source, /useFusionV2\s*=\s*input\.bool\(false,\s+title="Use Fusion V2 Soft Mode"/);
  assert.match(source, /useFusionV3\s*=\s*input\.bool\(false,\s+title="Use Fusion V3 Threshold Shaping"/);
  assert.match(source, /useFusionV4\s*=\s*input\.bool\(true,\s+title="Use Fusion V4 Residual Layer"/);
  assert.match(source, /fusionV4MinAbsPrediction\s*=\s*input\.float\(2(?:\.0)?,\s+title="Fusion V4 Min \|Prediction\|"/);
  assert.match(source, /fusionV4MaxAbsPrediction\s*=\s*input\.float\(4(?:\.0)?,\s+title="Fusion V4 Max \|Prediction\|"/);
  assert.match(source, /fusionV4LongAtrWeight\s*=\s*input\.float\(-0\.25,\s+title="Fusion V4 Long ATR Weight"/);
  assert.match(source, /fusionV4LongEngulfWeight\s*=\s*input\.float\(-0\.25,\s+title="Fusion V4 Long Engulf Weight"/);
  assert.match(source, /fusionV4LongEmaWeight\s*=\s*input\.float\(0(?:\.0)?,\s+title="Fusion V4 Long EMA Weight"/);
  assert.match(source, /fusionV4ShortAtrWeight\s*=\s*input\.float\(-0\.5,\s+title="Fusion V4 Short ATR Weight"/);
  assert.match(source, /fusionV4ShortEngulfWeight\s*=\s*input\.float\(-0\.1,\s+title="Fusion V4 Short Engulf Weight"/);
  assert.match(source, /fusionV4ShortEmaWeight\s*=\s*input\.float\(0(?:\.0)?,\s+title="Fusion V4 Short EMA Weight"/);
  assert.match(source, /slAtrMult\s*=\s*input\.float\(0\.75,\s+title="SL ATR x"/);
  assert.match(source, /tpAtrMult\s*=\s*input\.float\(4\.5,\s+title="TP ATR x \(1:1 R:R by default\)"/);
});

test('normalizeVariantRecords accepts metadata-backed search variants', () => {
  const records = normalizeVariantRecords([
    {
      variantId: 'exploit-signal-1',
      lane: 'exploit',
      family: 'signal',
      config: { neighborsCount: 24, adxThreshold: 20 },
    },
  ]);

  assert.deepEqual(records, [
    {
      variantId: 'exploit-signal-1',
      lane: 'exploit',
      family: 'signal',
      config: { neighborsCount: 24, adxThreshold: 20 },
    },
  ]);
});

test('normalizeVariantRecords also accepts legacy plain combo arrays', () => {
  const records = normalizeVariantRecords([{ neighborsCount: 24, adxThreshold: 20 }]);
  assert.deepEqual(records, [
    {
      variantId: 'variant-1',
      lane: 'legacy',
      family: 'legacy',
      config: { neighborsCount: 24, adxThreshold: 20 },
    },
  ]);
});

test('pine test script does not expose long-only or short-only controls', async () => {
  const source = await fs.readFile(new URL('../pine/test.pine', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /Enable Longs/);
  assert.doesNotMatch(source, /Enable Shorts/);
  assert.doesNotMatch(source, /useLongSide/);
  assert.doesNotMatch(source, /useShortSide/);
});


test('pine-sweep rejects non-array variant files with a useful error', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pine-sweep-'));
  const variantFile = path.join(tempDir, 'variants.json');
  await fs.writeFile(variantFile, JSON.stringify({ variantId: 'bad' }), 'utf8');

  const scriptPath = fileURLToPath(new URL('../scripts/pine-sweep.mjs', import.meta.url));
  const inputPath = fileURLToPath(new URL('../pine/test.pine', import.meta.url));

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, '--input', inputPath, '--variant-file', variantFile, '--max-configs', '1'], {
      cwd: path.resolve(path.dirname(scriptPath), '..'),
      shell: false,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stderr }));
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /variant-file must contain a JSON array of variant records/);
});
