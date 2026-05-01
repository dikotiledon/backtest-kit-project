import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLlmResearchContext } from '../scripts/lib/pine-autoresearch-llm-context.mjs';

test('buildLlmResearchContext includes champion allowlist memory and hard rules under cap', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.7, divRsiLen: 14 },
    allowlist: {
      version: 1,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
      ],
    },
    memory: {
      recentCandidates: [{ candidateId: 'c1', result: 'rejected_schema', reason: 'unknown' }],
      activeHypotheses: [{ family: 'signal', score: 1 }],
    },
    maxPromptBytes: 4096,
  });

  assert.equal(result.truncated, false);
  assert.ok(result.prompt.includes('exactly one JSON object'));
  assert.ok(result.prompt.includes('minPredSum'));
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 4096);
});

test('buildLlmResearchContext truncates recent memory under byte cap', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.7, divRsiLen: 14 },
    allowlist: {
      version: 1,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
      ],
    },
    memory: {
      recentCandidates: Array.from({ length: 200 }, (_, index) => ({
        candidateId: `c${index}`,
        result: 'rejected_schema',
        reason: 'x'.repeat(200),
      })),
      activeHypotheses: [{ family: 'signal', score: 1 }],
    },
    maxPromptBytes: 2000,
  });

  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 2000);
});
