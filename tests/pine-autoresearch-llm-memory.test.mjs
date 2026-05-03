import assert from 'node:assert/strict';
import test from 'node:test';

import { pruneResearchMemory, updateResearchMemory } from '../scripts/lib/pine-autoresearch-llm-memory.mjs';

test('pruneResearchMemory respects count caps', () => {
  const memory = {
    recentCandidates: Array.from({ length: 25 }, (_, index) => ({ candidateId: `c${index}` })),
    topWinners: Array.from({ length: 12 }, (_, index) => ({ candidateId: `w${index}` })),
    rejectedFingerprints: Array.from({ length: 60 }, (_, index) => `r${index}`),
  };

  const pruned = pruneResearchMemory(memory, { recentCandidates: 20, topWinners: 10, tabuFingerprints: 50 });
  assert.equal(pruned.recentCandidates.length, 20);
  assert.equal(pruned.topWinners.length, 10);
  assert.equal(pruned.rejectedFingerprints.length, 50);
});

test('maxHotMemoryBytes trims additional hot memory when JSON exceeds cap', () => {
  const memory = {
    recentCandidates: [{ candidateId: 'c1', notes: 'x'.repeat(300) }],
    topWinners: [{ candidateId: 'w1', notes: 'y'.repeat(300) }],
    rejectedFingerprints: ['r1'],
  };

  const pruned = pruneResearchMemory(memory, {
    recentCandidates: 20,
    topWinners: 10,
    tabuFingerprints: 50,
    maxHotMemoryBytes: 120,
  });

  assert.ok(JSON.stringify(pruned).length <= 120);
  assert.ok(pruned.recentCandidates.length < memory.recentCandidates.length || pruned.topWinners.length < memory.topWinners.length || pruned.rejectedFingerprints.length < memory.rejectedFingerprints.length);
});

test('updateResearchMemory records candidate summary and pendingReviewCount', () => {
  const updated = updateResearchMemory({}, {
    candidateSummary: { candidateId: 'champ:cand', candidateFingerprint: 'fp1', score: 1.23 },
    pendingReviewCount: 3,
  });

  assert.equal(updated.pendingReviewCount, 3);
  assert.equal(updated.recentCandidates[0].candidateId, 'champ:cand');
});

test('updateResearchMemory records compact matrix blocker and failure lesson', () => {
  const next = updateResearchMemory({}, {
    type: 'completed',
    candidate: { params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 } },
    metricsDelta: {
      recommendation: 'hold',
      summary: 'Hold champion: matrix failed primaryPromote gate(s).',
      aggregateRoiDeltaPct: 15.15,
      aggregateDrawdownDeltaPct: 0.77,
      promotedLabCount: 3,
      labCount: 6,
    },
  }, { recentCandidates: 20, failureLessons: 20 });

  assert.equal(next.latestMatrixBlocker.recommendation, 'hold');
  assert.match(next.latestMatrixBlocker.reason, /primaryPromote/);
  assert.equal(next.latestMatrixBlocker.promotedLabCount, 3);
  assert.equal(next.failureLessons.length, 1);
  assert.match(next.failureLessons[0], /primaryPromote/);
});

test('updateResearchMemory records duplicate invalid response lesson', () => {
  const next = updateResearchMemory({}, {
    type: 'candidate_invalid',
    reason: 'duplicate candidate fingerprint',
    candidate: { params: { minPredSum: 1.2, riskRewardRatio: 2, stopLossPct: 1 } },
  }, { recentCandidates: 20, failureLessons: 20 });

  assert.equal(next.failureLessons.length, 1);
  assert.match(next.failureLessons[0], /duplicate candidate fingerprint/);
  assert.equal(next.recentCandidates[0].outcome, 'candidate_invalid');
});
