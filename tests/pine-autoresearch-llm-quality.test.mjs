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
