import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLlmChallengerSummary,
  summarizeLlmMatrixDelta,
  shouldEnqueueLlmCandidate,
} from '../scripts/lib/pine-autoresearch-llm-evaluator.mjs';

test('buildLlmChallengerSummary merges LLM patch over champion config', () => {
  const championState = {
    configId: 'champion-a',
    label: 'Champion A',
    config: {
      minPredSum: 2,
      divRsiLen: 14,
      useFusionV4: true,
    },
  };

  const challenger = buildLlmChallengerSummary({
    championState,
    candidate: {
      patch: {
        minPredSum: 2.3,
        divRsiLen: 21,
      },
      rationale: 'Raise selectivity and lengthen divergence lookback.',
    },
    candidateFingerprint: 'abcdef1234567890',
  });

  assert.equal(challenger.label, 'llm-abcdef123456');
  assert.equal(challenger.source, 'llm');
  assert.equal(challenger.parentConfigId, 'champion-a');
  assert.deepEqual(challenger.patch, { minPredSum: 2.3, divRsiLen: 21 });
  assert.deepEqual(challenger.config, {
    minPredSum: 2.3,
    divRsiLen: 21,
    useFusionV4: true,
  });
  assert.notEqual(challenger.configId, 'champion-a');
});

test('summarizeLlmMatrixDelta uses aggregate matrix comparisons', () => {
  const delta = summarizeLlmMatrixDelta({
    labResults: [
      {
        lab: { labId: 'primary' },
        decision: {
          recommendation: 'promote',
          comparisons: {
            scoreDelta: 1.5,
            roiDeltaPct: 4.2,
            profitFactorDelta: 0.3,
            drawdownDeltaPct: -0.5,
          },
        },
      },
      {
        lab: { labId: 'shadow' },
        decision: {
          recommendation: 'hold',
          comparisons: {
            scoreDelta: -0.25,
            roiDeltaPct: 1.1,
            profitFactorDelta: 0.05,
            drawdownDeltaPct: 0.2,
          },
        },
      },
    ],
    matrixDecision: {
      recommendation: 'hold',
      summary: '1/2 labs passed.',
    },
  });

  assert.deepEqual(delta, {
    recommendation: 'hold',
    summary: '1/2 labs passed.',
    labCount: 2,
    promotedLabCount: 1,
    aggregateScoreDelta: 1.25,
    aggregateRoiDeltaPct: 5.3,
    aggregateProfitFactorDelta: 0.35,
    aggregateDrawdownDeltaPct: -0.3,
  });
});

test('shouldEnqueueLlmCandidate only allows matrix promote recommendation', () => {
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: { recommendation: 'promote' } }), true);
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: { recommendation: 'hold' } }), false);
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: null }), false);
});
