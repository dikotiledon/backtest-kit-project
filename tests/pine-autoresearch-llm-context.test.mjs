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

test('buildLlmResearchContext includes matrix-aware research rules and blockers', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.8, riskRewardRatio: 2, stopLossPct: 1 },
    allowlist: { parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1 }] },
    memory: {
      latestMatrixBlocker: {
        recommendation: 'hold',
        reason: 'matrix failed primaryPromote gate(s)',
        aggregateRoiDeltaPct: 15.15,
        promotedLabCount: 3,
        labCount: 6,
      },
      failureLessons: [
        'Avoid generic lower-threshold plus tighter-stop patches unless matrix evidence supports churn reduction.',
      ],
    },
    maxPromptBytes: 16384,
  });

  assert.match(result.prompt, /falsifiable candidate patch/i);
  assert.match(result.prompt, /latest matrix blocker/i);
  assert.match(result.prompt, /current champion baseline/i);
  assert.match(result.prompt, /primary\/shadow/i);
  assert.match(result.prompt, /generic lower-threshold/i);
  assert.match(result.prompt, /primaryPromote/);
});

test('buildLlmResearchContext trims recent memory before overflow fallback', () => {
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
    maxPromptBytes: 4096,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.overflow, false);
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 4096);

  const parsed = JSON.parse(result.prompt);
  assert.equal(parsed.champion.minPredSum, 1.7);
  assert.equal(parsed.allowlist.parameters[0].key, 'minPredSum');
  assert.ok(Array.isArray(parsed.memory.recentCandidates));
  assert.ok(parsed.memory.recentCandidates.length < 200);
});

test('buildLlmResearchContext hard caps oversized champion and allowlist', () => {
  const result = buildLlmResearchContext({
    champion: {
      minPredSum: 1.7,
      divRsiLen: 14,
      payload: 'x'.repeat(5000),
    },
    allowlist: {
      version: 1,
      parameters: Array.from({ length: 40 }, (_, index) => ({
        key: `p${index}`,
        type: 'float',
        min: 0,
        max: 5,
        step: 0.1,
        mutability: 'tunable',
        family: 'signal',
        rationale: 'x'.repeat(80),
      })),
    },
    memory: {
      recentCandidates: [],
      activeHypotheses: [],
    },
    maxPromptBytes: 1000,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.overflow, true);
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 1000);
  assert.match(result.prompt, /truncated|overflow/i);
});


test('buildLlmResearchContext honors tiny caps', () => {
  for (const cap of [1, 0]) {
    const result = buildLlmResearchContext({
      champion: {},
      allowlist: {},
      memory: {},
      maxPromptBytes: cap,
    });

    assert.equal(result.truncated, true);
    assert.equal(result.overflow, true);
    assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= cap);
  }
});
