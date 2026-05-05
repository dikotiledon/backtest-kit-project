import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOfflineDataPlan, summarizeOfflineDataPlan } from '../scripts/lib/pine-offline-data-plan.mjs';

test('buildOfflineDataPlan requires local cache in offline-strict mode', () => {
  const plan = buildOfflineDataPlan({
    matrixId: 'matrix-a',
    pinnedData: { enabled: true, cacheRoot: '/cache', sourceMode: 'local-cache', exchangeName: 'ccxt-exchange' },
    labs: [{ labId: 'primary', symbol: 'XRPUSDT', timeframe: '15m', limit: 1000, when: '2026-04-21T00:00:00Z' }],
    offline: { mode: 'offline-strict' },
  });

  assert.equal(plan.mode, 'offline-strict');
  assert.equal(plan.networkAllowed, false);
  assert.equal(plan.requiredLabs.length, 1);
  assert.equal(plan.requiredLabs[0].requiresCacheComplete, true);
});

test('summarizeOfflineDataPlan records missing cache as offlineDataMissing', () => {
  const summary = summarizeOfflineDataPlan({
    mode: 'offline-strict',
    networkAllowed: false,
    requiredLabs: [{ labId: 'primary', complete: false, missingCount: 2 }],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.reason, 'offlineDataMissing');
  assert.equal(summary.missingLabs[0].labId, 'primary');
});

test('summarizeOfflineDataPlan compacts missing timestamps preview to first five', () => {
  const summary = summarizeOfflineDataPlan({
    mode: 'offline-strict',
    networkAllowed: false,
    requiredLabs: [{
      labId: 'primary',
      symbol: 'XRPUSDT',
      timeframe: '15m',
      complete: false,
      missingCount: 8,
      missingTimestamps: [
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:15:00.000Z',
        '2026-05-01T00:30:00.000Z',
        '2026-05-01T00:45:00.000Z',
        '2026-05-01T01:00:00.000Z',
        '2026-05-01T01:15:00.000Z',
      ],
    }],
  });

  assert.equal(summary.missingLabs[0].missingCount, 8);
  assert.deepEqual(summary.missingLabs[0].missingTimestamps, [
    '2026-05-01T00:00:00.000Z',
    '2026-05-01T00:15:00.000Z',
    '2026-05-01T00:30:00.000Z',
    '2026-05-01T00:45:00.000Z',
    '2026-05-01T01:00:00.000Z',
  ]);
});
