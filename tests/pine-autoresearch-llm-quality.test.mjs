import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQualityFeedbackPrompt,
  scoreCandidateQuality,
} from '../scripts/lib/pine-autoresearch-llm-quality.mjs';

const champion = {
  minPredSum: 1.8,
  riskRewardRatio: 2,
  stopLossPct: 1,
  divRsiLen: 21,
};

const memory = {
  latestMatrixBlocker: {
    recommendation: 'hold',
    reason: 'matrix failed primaryPromote gate(s)',
    aggregateScoreDelta: 13.28,
    aggregateRoiDeltaPct: 15.15,
    promotedLabCount: 3,
    labCount: 6,
  },
  recentCandidates: [
    {
      params: { minPredSum: 1.2, riskRewardRatio: 2, stopLossPct: 1 },
      outcome: 'candidate_invalid',
      reason: 'duplicate candidate fingerprint',
    },
  ],
  failureLessons: [
    'Avoid generic lower-threshold plus tighter-stop patches unless matrix evidence supports churn reduction.',
  ],
};

test('scoreCandidateQuality flags generic lower-threshold tighter-stop candidate', () => {
  const result = scoreCandidateQuality({
    candidate: {
      params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
      rationale:
        'Lower minPredSum increases entry frequency while staying selective; higher riskRewardRatio improves profit potential; tighter stopLossPct reduces losses.',
    },
    champion,
    memory,
    config: { quality: { minScore: 70 } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.score < 70, true);
  assert.equal(result.flags.includes('generic_threshold_rr_stop_pattern'), true);
  assert.equal(result.flags.includes('missing_matrix_blocker_reference'), true);
  assert.equal(result.flags.includes('missing_champion_baseline_reference'), true);
});

test('scoreCandidateQuality accepts matrix-aware candidate with modest scoped patch', () => {
  const result = scoreCandidateQuality({
    candidate: {
      params: { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 },
      rationale:
        'Champion minPredSum 1.8 held because primaryPromote failed despite positive aggregate ROI delta. This patch modestly increases entries without tightening stops, improves reward asymmetry, and shortens divergence sensitivity to test whether primary labs catch more valid reversals while shadow risk stays bounded.',
    },
    champion,
    memory,
    config: { quality: { minScore: 70 } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.score >= 70, true);
  assert.deepEqual(result.flags, []);
});

test('buildQualityFeedbackPrompt gives actionable re-ask instructions', () => {
  const quality = {
    ok: false,
    score: 42,
    flags: [
      'generic_threshold_rr_stop_pattern',
      'missing_matrix_blocker_reference',
      'missing_champion_baseline_reference',
    ],
    notes: [
      'Candidate looks like generic trading advice instead of matrix-aware research.',
    ],
  };

  const prompt = buildQualityFeedbackPrompt('BASE PROMPT', {
    quality,
    candidate: { params: { minPredSum: 1.2 } },
  });

  assert.match(
    prompt,
    /Previous candidate passed JSON schema but failed quality preflight/,
  );
  assert.match(prompt, /generic_threshold_rr_stop_pattern/);
  assert.match(prompt, /latest matrix blocker/);
  assert.match(prompt, /current champion baseline/);
  assert.match(prompt, /Return exactly one JSON object/);
});

test('scoreCandidateQuality handles missing args and malformed nested values without throw', () => {
  assert.doesNotThrow(() => scoreCandidateQuality());

  const result = scoreCandidateQuality({
    candidate: { params: { minPredSum: { nested: true } }, rationale: null },
    champion: { minPredSum: [1, 2, 3] },
    memory: { recentCandidates: 'not-an-array' },
    config: { quality: { minScore: 'bad' } },
  });

  assert.equal(typeof result, 'object');
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.score, 'number');
  assert.equal(Array.isArray(result.flags), true);
  assert.equal(Array.isArray(result.notes), true);
});

test('buildQualityFeedbackPrompt handles circular + BigInt candidate safely', () => {
  const circular = { params: { minPredSum: 1.2 } };
  circular.self = circular;
  circular.big = 12n;

  const prompt = buildQualityFeedbackPrompt('BASE', {
    quality: { score: 10, flags: ['x'], notes: ['y'] },
    candidate: circular,
  });

  assert.match(prompt, /Rejected candidate preview:/);
  assert.match(prompt, /Return exactly one JSON object/);

  const previewLine = prompt
    .split('\n')
    .find((line) => line.startsWith('Rejected candidate preview: '));
  assert.equal(Boolean(previewLine), true);
  assert.equal(previewLine.length <= 1028, true);
});

test('scoreCandidateQuality handles Symbol param values without throw', () => {
  assert.doesNotThrow(() =>
    scoreCandidateQuality({
      candidate: {
        params: {
          minPredSum: Symbol('min'),
          riskRewardRatio: Symbol('rr'),
          stopLossPct: Symbol('sl'),
        },
        rationale:
          'Champion baseline context with matrix primary promote and ROI note for robustness.',
      },
      champion,
      memory,
      config: { quality: { minScore: 70 } },
    }),
  );

  const result = scoreCandidateQuality({
    candidate: {
      params: {
        minPredSum: Symbol('min'),
        riskRewardRatio: Symbol('rr'),
        stopLossPct: Symbol('sl'),
      },
      rationale:
        'Champion baseline context with matrix primary promote and ROI note for robustness.',
    },
    champion,
    memory,
    config: { quality: { minScore: 70 } },
  });

  assert.equal(typeof result, 'object');
  assert.equal(Array.isArray(result.flags), true);
});
