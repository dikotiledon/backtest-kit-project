import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationCacheKey, createEvaluationCache } from '../scripts/lib/pine-evaluation-cache.mjs';

test('buildEvaluationCacheKey is stable for same config/lab role', () => {
  assert.equal(
    buildEvaluationCacheKey({ runId: 'run-1', labId: 'primary', variantKey: 'champion', configFingerprint: 'fp-1' }),
    'run-1|primary|champion|fp-1',
  );
});

test('buildEvaluationCacheKey treats missing fields as empty strings', () => {
  assert.equal(buildEvaluationCacheKey({ runId: 'run-1', variantKey: 'champion' }), 'run-1||champion|');
  assert.equal(buildEvaluationCacheKey(), '|||');
});

test('createEvaluationCache reuses in-flight evaluations', async () => {
  let calls = 0;
  const cache = createEvaluationCache();
  const key = 'run-1|primary|champion|fp-1';
  const [left, right] = await Promise.all([
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
  ]);
  assert.deepEqual(left, { score: 1 });
  assert.deepEqual(right, { score: 1 });
  assert.equal(calls, 1);
});

test('createEvaluationCache reports cached entry count', async () => {
  const cache = createEvaluationCache();
  assert.equal(cache.size(), 0);
  await cache.getOrCompute('run-1|primary|champion|fp-1', async () => ({ score: 1 }));
  assert.equal(cache.size(), 1);
});

test('createEvaluationCache evicts rejected evaluations so callers can retry', async () => {
  let calls = 0;
  const cache = createEvaluationCache();
  const key = 'run-1|primary|champion|fp-1';

  await assert.rejects(
    cache.getOrCompute(key, () => {
      calls += 1;
      throw new Error('temporary evaluation failure');
    }),
    /temporary evaluation failure/,
  );
  assert.equal(cache.size(), 0);

  const result = await cache.getOrCompute(key, async () => {
    calls += 1;
    return { score: 2 };
  });

  assert.deepEqual(result, { score: 2 });
  assert.equal(calls, 2);
  assert.equal(cache.size(), 1);
});
