import test from 'node:test';
import assert from 'node:assert/strict';

import { detectEntryParameterInvariance } from '../scripts/lib/pine-entry-invariance.mjs';

const entryKeys = ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'];

test('detectEntryParameterInvariance flags exit-only drift with constant challenger signal metrics', () => {
  const recentCycles = Array.from({ length: 5 }, (_, index) => ({
    touchedKeys: ['tpAtrMult'],
    challenger: {
      tradeCount: 261,
      winRatePct: 42.53 + (index % 2 === 0 ? 0 : 0.001),
    },
  }));

  const verdict = detectEntryParameterInvariance({
    recentCycles,
    policy: { minCycles: 5, entryKeys },
  });

  assert.equal(verdict.flagged, true);
  assert.equal(verdict.reason, 'exit_only_drift');
  assert.equal(verdict.cyclesConsidered, 5);
  assert.deepEqual(verdict.untouchedEntryKeys, entryKeys);
});

test('detectEntryParameterInvariance stays silent when entry keys move and signal metrics vary', () => {
  const recentCycles = [
    { touchedKeys: ['tpAtrMult'], challenger: { tradeCount: 261, winRatePct: 42.53 } },
    { touchedKeys: ['adxThreshold'], challenger: { tradeCount: 264, winRatePct: 43.1 } },
    { touchedKeys: ['minPredSum'], challenger: { tradeCount: 259, winRatePct: 41.9 } },
    { touchedKeys: ['tpAtrMult', 'minBarsBetween'], challenger: { tradeCount: 270, winRatePct: 44.2 } },
    { touchedKeys: ['neighborsCount'], challenger: { tradeCount: 252, winRatePct: 40.8 } },
  ];

  const verdict = detectEntryParameterInvariance({
    recentCycles,
    policy: { minCycles: 5, entryKeys },
  });

  assert.deepEqual(verdict, {
    flagged: false,
    reason: 'entry_keys_active_or_signal_varying',
    cyclesConsidered: 5,
  });
});
