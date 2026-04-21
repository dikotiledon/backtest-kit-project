import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inferTimeframeMinutes,
  simulateTrades,
  calculateMetrics,
  scoreMetrics,
  summarizeSignalDiagnostics,
} from '../scripts/lib/pine-optimizer.mjs';

test('inferTimeframeMinutes derives candle spacing from timestamps', () => {
  const rows = [
    { timestamp: '2026-04-21T00:00:00.000Z' },
    { timestamp: '2026-04-21T00:15:00.000Z' },
    { timestamp: '2026-04-21T00:30:00.000Z' },
  ];

  assert.equal(inferTimeframeMinutes(rows), 15);
});

test('simulateTrades exits long on take profit and records pnl', () => {
  const rows = [
    { timestamp: '2026-04-21T00:00:00.000Z', Close: 100, Signal: 1, StopLoss: 95, TakeProfit: 110, EstimatedTime: 60 },
    { timestamp: '2026-04-21T00:15:00.000Z', Close: 104, Signal: 0, StopLoss: 104, TakeProfit: 104, EstimatedTime: 60 },
    { timestamp: '2026-04-21T00:30:00.000Z', Close: 111, Signal: 0, StopLoss: 111, TakeProfit: 111, EstimatedTime: 60 },
  ];

  const trades = simulateTrades(rows);

  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, 'long');
  assert.equal(trades[0].exitReason, 'takeProfit');
  assert.equal(trades[0].entryPrice, 100);
  assert.equal(trades[0].exitPrice, 110);
  assert.equal(trades[0].pnl, 10);
  assert.equal(trades[0].returnPct, 10);
});

test('simulateTrades exits short on stop loss and records pnl', () => {
  const rows = [
    { timestamp: '2026-04-21T00:00:00.000Z', Close: 100, Signal: -1, StopLoss: 105, TakeProfit: 90, EstimatedTime: 60 },
    { timestamp: '2026-04-21T00:15:00.000Z', Close: 103, Signal: 0, StopLoss: 103, TakeProfit: 103, EstimatedTime: 60 },
    { timestamp: '2026-04-21T00:30:00.000Z', Close: 106, Signal: 0, StopLoss: 106, TakeProfit: 106, EstimatedTime: 60 },
  ];

  const trades = simulateTrades(rows);

  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, 'short');
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].entryPrice, 100);
  assert.equal(trades[0].exitPrice, 105);
  assert.equal(trades[0].pnl, -5);
  assert.equal(trades[0].returnPct, -5);
});

test('calculateMetrics summarizes win rate, roi, drawdown, and profit factor', () => {
  const trades = [
    { pnl: 10, returnPct: 10 },
    { pnl: -5, returnPct: -5 },
    { pnl: 15, returnPct: 15 },
  ];

  const metrics = calculateMetrics(trades);

  assert.equal(metrics.tradeCount, 3);
  assert.equal(metrics.winCount, 2);
  assert.equal(metrics.lossCount, 1);
  assert.equal(metrics.winRatePct, 66.67);
  assert.equal(metrics.roiPct, 20);
  assert.equal(metrics.profitFactor, 5);
  assert.equal(metrics.maxDrawdownPct, 5);
});

test('scoreMetrics rewards profitable stable configs and penalizes too few trades', () => {
  const strong = scoreMetrics({
    tradeCount: 20,
    roiPct: 35,
    winRatePct: 60,
    maxDrawdownPct: 8,
    profitFactor: 2.5,
  });

  const weak = scoreMetrics({
    tradeCount: 2,
    roiPct: 35,
    winRatePct: 60,
    maxDrawdownPct: 8,
    profitFactor: 2.5,
  });

  assert.ok(strong > weak);
});

test('summarizeSignalDiagnostics counts raw intents, filters, gates, blockers, and fusion diagnostics', () => {
  const rows = [
    {
      timestamp: '2026-04-21T00:00:00.000Z',
      Close: 100,
      Feature_RawLongPrediction: 1,
      Feature_FilterAll: 0,
      Feature_FilterVolatility: 0,
      Feature_FilterRegime: 1,
      Feature_FilterAdx: 1,
      Feature_AtrFlipBull: 1,
      Feature_LongFusionScore: 1,
      Feature_LongFusionBonus: 0.25,
      Feature_LongFusionPenalty: 0.1,
      Feature_LongFusionV4Residual: -0.25,
      Feature_FusionV4Active: 1,
      Feature_EffectiveLongStrength: 0.65,
    },
    {
      timestamp: '2026-04-21T00:15:00.000Z',
      Close: 101,
      Feature_RawLongPrediction: 1,
      Feature_FilterAll: 1,
      Feature_LongPostFilter: 1,
      Feature_NewBuySignal: 1,
      Feature_BaseStartLong: 1,
      Feature_TrendXLongPass: 0,
      Feature_BlockLong_TrendX: 1,
      Feature_CooldownOk: 1,
      Feature_3LineBull: 1,
      Feature_EmaCrossBull: 1,
      Feature_LongFusionScore: 2,
      Feature_LongFusionBonus: 0.5,
      Feature_LongFusionPenalty: 0,
      Feature_LongFusionV4Residual: 0,
      Feature_EffectiveLongStrength: 1.5,
      Feature_LongFusionPass: 1,
    },
    {
      timestamp: '2026-04-21T00:30:00.000Z',
      Close: 102,
      Feature_RawShortPrediction: 1,
      Feature_FilterAll: 1,
      Feature_ShortPostFilter: 1,
      Feature_NewSellSignal: 1,
      Feature_BaseStartShort: 1,
      Feature_TrendXShortPass: 1,
      Feature_PredShortStrengthPass: 0,
      Feature_BlockShort_Pred: 1,
      Feature_CooldownOk: 1,
      Feature_EngulfingBear: 1,
      Feature_ShortFusionScore: 1,
      Feature_ShortFusionBonus: 0.25,
      Feature_ShortFusionPenalty: 0.2,
      Feature_ShortFusionV4Residual: -0.5,
      Feature_FusionV4Active: 1,
      Feature_EffectiveShortStrength: 0.2,
      Feature_BlockShort_Fusion: 1,
    },
  ];

  const diagnostics = summarizeSignalDiagnostics(rows);

  assert.equal(diagnostics.rawLongPredictionCount, 2);
  assert.equal(diagnostics.rawShortPredictionCount, 1);
  assert.equal(diagnostics.filterAllPassCount, 2);
  assert.equal(diagnostics.filterVolatilityPassCount, 0);
  assert.equal(diagnostics.longPostFilterCount, 1);
  assert.equal(diagnostics.shortPostFilterCount, 1);
  assert.equal(diagnostics.baseStartLongCount, 1);
  assert.equal(diagnostics.baseStartShortCount, 1);
  assert.equal(diagnostics.blockLongTrendXCount, 1);
  assert.equal(diagnostics.blockShortPredCount, 1);
  assert.equal(diagnostics.atrFlipBullCount, 1);
  assert.equal(diagnostics.line3BullCount, 1);
  assert.equal(diagnostics.emaCrossBullCount, 1);
  assert.equal(diagnostics.engulfingBearCount, 1);
  assert.equal(diagnostics.longFusionPassCount, 1);
  assert.equal(diagnostics.blockShortFusionCount, 1);
  assert.equal(diagnostics.longFusionScoreSum, 3);
  assert.equal(diagnostics.shortFusionScoreSum, 1);
  assert.equal(diagnostics.longFusionBonusSum, 0.75);
  assert.equal(diagnostics.shortFusionBonusSum, 0.25);
  assert.equal(diagnostics.longFusionPenaltySum, 0.1);
  assert.equal(diagnostics.shortFusionPenaltySum, 0.2);
  assert.equal(diagnostics.longFusionV4ResidualSum, -0.25);
  assert.equal(diagnostics.shortFusionV4ResidualSum, -0.5);
  assert.equal(diagnostics.fusionV4ActiveCount, 2);
  assert.equal(diagnostics.effectiveLongStrengthSum, 2.15);
  assert.equal(diagnostics.effectiveShortStrengthSum, 0.2);
});
