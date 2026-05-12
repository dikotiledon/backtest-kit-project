import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateFamilyKey,
  summarizePromotionLineage,
  detectPingPongRisk,
  decideLineagePromotionGate,
} from '../scripts/lib/pine-autoresearch-lineage.mjs';

const baseConfig = {
  useSignalFusion: true,
  useFusionV4: true,
  useDivergenceContext: true,
  useSqueezeContext: true,
  minPredSum: 1.8,
  tpAtrMult: 6.85,
  slAtrMult: 0.5,
  trailAtrMult: 1,
};

test('buildCandidateFamilyKey ignores tiny numeric tuning but preserves structural switches', () => {
  const left = buildCandidateFamilyKey({
    config: { ...baseConfig, minPredSum: 1.8, tpAtrMult: 6.85 },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });
  const right = buildCandidateFamilyKey({
    config: { ...baseConfig, minPredSum: 1.6, tpAtrMult: 6.65 },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });
  const structuralChange = buildCandidateFamilyKey({
    config: { ...baseConfig, useSqueezeContext: false },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });

  assert.equal(left, right);
  assert.notEqual(left, structuralChange);
});



test('buildCandidateFamilyKey handles null config safely', () => {
  const key = buildCandidateFamilyKey({ config: null });
  assert.equal(key, '{}');
});

test('summarizePromotionLineage handles null or malformed history events safely', () => {
  const nullSummary = summarizePromotionLineage({ historyEvents: null });
  assert.deepEqual(nullSummary.recentTransitions, []);
  assert.deepEqual(nullSummary.recentPromotedFingerprints, []);
  assert.deepEqual(nullSummary.recentDemotedFingerprints, []);
  assert.deepEqual(nullSummary.recentPromotedFamilies, []);
  assert.deepEqual(nullSummary.recentDemotedFamilies, []);

  const malformedSummary = summarizePromotionLineage({
    historyEvents: [null, 'bad', {}, { type: 'noop' }],
  });
  assert.deepEqual(malformedSummary.recentTransitions, []);
  assert.deepEqual(malformedSummary.recentPromotedFingerprints, []);
  assert.deepEqual(malformedSummary.recentDemotedFingerprints, []);
  assert.deepEqual(malformedSummary.recentPromotedFamilies, []);
  assert.deepEqual(malformedSummary.recentDemotedFamilies, []);
});

test('summarizePromotionLineage returns recent promoted and demoted fingerprints newest first', () => {
  const summary = summarizePromotionLineage({
    historyEvents: [
      { type: 'promote', timestamp: '2026-05-01T00:00:00.000Z', fromFingerprint: 'a', toFingerprint: 'b', fromFamilyKey: 'fam-a', toFamilyKey: 'fam-b' },
      { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
    ],
    limit: 4,
  });

  assert.deepEqual(summary.recentPromotedFingerprints, ['c', 'b']);
  assert.deepEqual(summary.recentDemotedFingerprints, ['b', 'a']);
  assert.deepEqual(summary.recentTransitions.map((item) => `${item.fromFingerprint}->${item.toFingerprint}`), ['b->c', 'a->b']);
});

test('detectPingPongRisk catches direct reversal to recently demoted champion', () => {
  const risk = detectPingPongRisk({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage: summarizePromotionLineage({
      historyEvents: [
        { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
      ],
    }),
    policy: { lookbackPromotions: 5 },
  });

  assert.equal(risk.level, 'direct-reversal');
  assert.equal(risk.blocked, true);
  assert.match(risk.reason, /recently demoted/);
});

test('summarizePromotionLineage preserves configs for numeric reversal checks', () => {
  const fromConfig = { tpAtrMult: 10.6, slAtrMult: 0.5 };
  const toConfig = { tpAtrMult: 7.6, slAtrMult: 0.5 };
  const summary = summarizePromotionLineage({
    historyEvents: [{ type: 'promote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'a', toFingerprint: 'b', fromConfig, toConfig }],
  });

  assert.deepEqual(summary.recentTransitions[0].fromConfig, fromConfig);
  assert.deepEqual(summary.recentTransitions[0].toConfig, toConfig);
});

test('detectPingPongRisk catches numeric return to recently demoted values', () => {
  const risk = detectPingPongRisk({
    candidateFingerprint: 'cand-10.6',
    candidateFamilyKey: '{"useFusionV4":true}',
    currentChampionFingerprint: 'champ-7.6',
    currentChampionFamilyKey: '{"useFusionV4":true}',
    candidateConfig: { tpAtrMult: 10.6, slAtrMult: 0.5 },
    currentChampionConfig: { tpAtrMult: 7.6, slAtrMult: 0.5 },
    lineage: {
      recentTransitions: [
        {
          fromFingerprint: 'cand-10.6',
          toFingerprint: 'champ-7.6',
          fromFamilyKey: '{"useFusionV4":true}',
          toFamilyKey: '{"useFusionV4":true}',
          fromConfig: { tpAtrMult: 10.6, slAtrMult: 0.5 },
          toConfig: { tpAtrMult: 7.6, slAtrMult: 0.5 },
        },
      ],
    },
    policy: {
      lookbackPromotions: 6,
      numericKeys: ['tpAtrMult', 'slAtrMult'],
    },
  });

  assert.equal(risk.blocked, true);
  assert.equal(risk.level, 'numeric-reversal');
});

test('detectPingPongRisk does not match numeric reversal when configured keys are missing', () => {
  const risk = detectPingPongRisk({
    candidateConfig: { tpAtrMult: 10.6 },
    currentChampionConfig: { tpAtrMult: 7.6 },
    lineage: {
      recentTransitions: [
        {
          fromConfig: { tpAtrMult: 10.6 },
          toConfig: { tpAtrMult: 7.6 },
        },
      ],
    },
    policy: { numericKeys: ['tpAtrMult', 'slAtrMult'] },
  });

  assert.equal(risk.blocked, false);
  assert.equal(risk.level, 'none');
});

test('decideLineagePromotionGate allows risky reversal only with configured extra proof margin', () => {
  const lineage = summarizePromotionLineage({
    historyEvents: [
      { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
    ],
  });

  const blocked = decideLineagePromotionGate({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage,
    matrixDecision: { recommendation: 'promote', counts: { shadowPassCount: 3, shadowPassRatio: 0.6 } },
    robustness: { aggregateScoreDelta: 1.2, aggregateRoiDeltaPct: 2.5, aggregateProfitFactorDelta: 0.05 },
    policy: { enabled: true, lookbackPromotions: 5, directReversalExtraShadowPasses: 1, minExtraAggregateScoreDelta: 5 },
  });

  const allowed = decideLineagePromotionGate({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage,
    matrixDecision: { recommendation: 'promote', counts: { shadowPassCount: 5, shadowPassRatio: 1 } },
    robustness: { aggregateScoreDelta: 8, aggregateRoiDeltaPct: 10, aggregateProfitFactorDelta: 0.2 },
    policy: { enabled: true, lookbackPromotions: 5, directReversalExtraShadowPasses: 1, minExtraAggregateScoreDelta: 5 },
  });

  assert.equal(blocked.passed, false);
  assert.equal(blocked.failedGates.includes('lineagePingPong'), true);
  assert.equal(allowed.passed, true);
});
