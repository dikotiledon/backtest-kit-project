import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades } from '../scripts/lib/pine-optimizer.mjs';
import { filterSweepCombos } from '../scripts/lib/pine-tuner.mjs';

function row({ timestamp, Close, Signal, StopLoss, TakeProfit, Feature_SimPos, EstimatedTime = 240 }) {
  return { timestamp, Close, Signal, StopLoss, TakeProfit, Feature_SimPos, EstimatedTime };
}

test('simulateTrades updates active stop from later rows when Feature_SimPos stays open', () => {
  const rows = [
    row({ timestamp: '2026-04-21T09:45:00.000Z', Close: 100, Signal: 1, StopLoss: 95, TakeProfit: 120, Feature_SimPos: 1 }),
    row({ timestamp: '2026-04-21T10:00:00.000Z', Close: 104, Signal: 0, StopLoss: 103, TakeProfit: 120, Feature_SimPos: 1 }),
    row({ timestamp: '2026-04-21T10:15:00.000Z', Close: 102, Signal: 0, StopLoss: 103, TakeProfit: 120, Feature_SimPos: 1 }),
  ];

  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].exitPrice, 103);
  assert.equal(trades[0].pnl, 3);
});

test('filterSweepCombos collapses equivalent disabled phase3 parameter combos', () => {
  const combos = [
    {
      useSupertrendFilter: false,
      useSupertrendEntryConfirm: false,
      supertrendAtrLen: 14,
      supertrendFactor: 2.0,
      useTrailingStop: false,
      trailAtrLen: 14,
      trailAtrMult: 1.5,
      trailActivateR: 1.0,
    },
    {
      useSupertrendFilter: false,
      useSupertrendEntryConfirm: true,
      supertrendAtrLen: 10,
      supertrendFactor: 1.5,
      useTrailingStop: false,
      trailAtrLen: 7,
      trailAtrMult: 1.0,
      trailActivateR: 0.5,
    },
  ];

  const filtered = filterSweepCombos(combos);
  assert.equal(filtered.length, 1);
});
