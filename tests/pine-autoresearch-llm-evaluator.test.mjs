import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLlmChallengerSummary,
  executeLlmMatrixCandidate,
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

test('executeLlmMatrixCandidate evaluates one LLM patch through injected matrix evaluator', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-evaluator-'));

  try {
    const baseConfig = {
      matrixId: 'matrix-a',
      researchRoot: path.join(dir, 'pine/autoresearch/matrix-a'),
    };
    const championState = {
      configId: 'champion-a',
      config: { minPredSum: 2, divRsiLen: 14, useFusionV4: true },
    };

    const result = await executeLlmMatrixCandidate({
      candidate: { patch: { minPredSum: 2.2 }, rationale: 'raise selectivity' },
      candidateFingerprint: 'abc123def456999',
      config: { baseConfigPath: './config/pine-autoresearch.default.json' },
      repoRoot: dir,
      loadBaseConfig: async () => baseConfig,
      loadChampionState: async () => championState,
      evaluateMatrixCandidate: async (resolvedConfig, runId, incumbent, challengerSummary) => ({
        labResults: [{
          lab: { labId: 'primary' },
          decision: {
            recommendation: 'promote',
            comparisons: {
              scoreDelta: 2,
              roiDeltaPct: 3,
              profitFactorDelta: 0.4,
              drawdownDeltaPct: -0.1,
            },
          },
          challenger: { config: challengerSummary.config },
          analysis: {
            incumbent: { trades: [{ id: 1 }], rows: [{ bar: 1 }] },
            challenger: { trades: [{ id: 2 }], rows: [{ bar: 2 }] },
          },
        }],
        matrixDecision: { recommendation: 'promote', summary: 'primary passed' },
      }),
      nowId: () => '2026-05-02T00-00-00-000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.promotable, true);
    assert.equal(result.runId, 'llm-matrix-a-2026-05-02T00-00-00-000Z-abc123def456');
    assert.equal(result.metricsDelta.recommendation, 'promote');
    assert.equal(result.metricsDelta.aggregateScoreDelta, 2);
    assert.match(result.evaluationManifestPath, /llm-matrix-a-2026-05-02T00-00-00-000Z-abc123def456\.json$/);

    const manifest = JSON.parse(await fs.readFile(result.evaluationManifestPath, 'utf8'));
    assert.equal(manifest.lane, 'llm-evaluator-bridge');
    assert.equal(manifest.matrixDecision.recommendation, 'promote');
    assert.equal(manifest.challenger.config.minPredSum, 2.2);
    assert.equal(manifest.challenger.config.useFusionV4, true);
    assert.equal(manifest.labResults[0].analysis, undefined);
    assert.equal(manifest.matrixCandidates[0].labResults[0].analysis, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
