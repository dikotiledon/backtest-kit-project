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

test('updateResearchMemory records candidate summary and pendingReviewCount', () => {
  const updated = updateResearchMemory({}, {
    candidateSummary: { candidateId: 'champ:cand', candidateFingerprint: 'fp1', score: 1.23 },
    pendingReviewCount: 3,
  });

  assert.equal(updated.pendingReviewCount, 3);
  assert.equal(updated.recentCandidates[0].candidateId, 'champ:cand');
});
