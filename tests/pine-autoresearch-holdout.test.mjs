import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatrix } from '../scripts/pine-autoresearch.mjs';

test('evaluateMatrix runs holdout labs when matrix recommends promote', async () => {
  const labCalls = [];
  const evaluateConfigOnLab = async ({ lab, variantKey }) => {
    labCalls.push({ labId: lab.labId, variantKey });
    return {
      label: `${variantKey}-label`,
      configId: `${variantKey}-id`,
      config: variantKey === 'champion' ? { a: 1 } : { a: 2 },
      score: variantKey === 'champion' ? 100 : 110,
      metrics: { tradeCount: 200, roiPct: 20, profitFactor: 3, maxDrawdownPct: 2, winRatePct: 50, avgWin: 1.5, avgLoss: 0.5 },
      trades: [],
      rows: [],
    };
  };
  const config = {
    primaryLab: { labId: 'primary', thresholds: { minScoreDelta: 0.1, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5, significance: { minRelativeScoreDelta: 0.01, minTradeCount: 50 } } },
    shadowLabs: [{ labId: 'shadow1', thresholds: { minScoreDelta: 0.1, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5, significance: { minRelativeScoreDelta: 0.01, minTradeCount: 50 } } }],
    blindHoldoutLabs: [{ labId: 'holdout1', thresholds: { minScoreDelta: 0, minRoiDeltaPct: 5, minProfitFactorDelta: 0.1, maxDrawdownDeltaPct: 0.75, minTradeCount: 60, minTradeRatioVsIncumbent: 0.75, significance: { minRelativeScoreDelta: 0.01, minTradeCount: 50 } } }],
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 0.5, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    complexityPolicy: { enabled: false },
  };
  const out = await evaluateMatrix(config, 'run-1', { configId: 'champ', config: { a: 1 } }, { configId: 'chal', config: { a: 2 } }, { evaluateConfigOnLab });
  const holdoutCalls = labCalls.filter(c => c.labId === 'holdout1');
  assert.ok(holdoutCalls.length > 0, 'holdout lab was evaluated');
  assert.ok(out.holdoutVerdict != null, 'holdoutVerdict is populated');
  assert.equal(typeof out.holdoutVerdict.passed, 'boolean');
});

test('evaluateMatrix does not run holdout when matrix holds', async () => {
  const labCalls = [];
  const evaluateConfigOnLab = async ({ lab, variantKey }) => {
    labCalls.push({ labId: lab.labId, variantKey });
    return {
      label: `${variantKey}-label`,
      configId: `${variantKey}-id`,
      config: variantKey === 'champion' ? { a: 1 } : { a: 2 },
      score: variantKey === 'champion' ? 100 : 100.01,
      metrics: { tradeCount: 200, roiPct: 10, profitFactor: 2, maxDrawdownPct: 3, winRatePct: 45, avgWin: 1, avgLoss: 0.5 },
      trades: [],
      rows: [],
    };
  };
  const config = {
    primaryLab: { labId: 'primary', thresholds: { minScoreDelta: 5, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5, significance: { minRelativeScoreDelta: 0.02, minTradeCount: 50 } } },
    shadowLabs: [{ labId: 'shadow1', thresholds: { minScoreDelta: 5, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5 } }],
    blindHoldoutLabs: [{ labId: 'holdout1', thresholds: { minScoreDelta: 0, minRoiDeltaPct: 5 } }],
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 0.5, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    complexityPolicy: { enabled: false },
  };
  const out = await evaluateMatrix(config, 'run-1', { configId: 'champ', config: { a: 1 } }, { configId: 'chal', config: { a: 2 } }, { evaluateConfigOnLab });
  const holdoutCalls = labCalls.filter(c => c.labId === 'holdout1');
  assert.equal(holdoutCalls.length, 0, 'holdout lab was NOT evaluated');
  assert.equal(out.holdoutVerdict, null);
});
