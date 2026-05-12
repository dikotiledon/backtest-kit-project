import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationCacheKey, createEvaluationCache } from '../scripts/lib/pine-evaluation-cache.mjs';

test('buildEvaluationCacheKey is stable for same config/lab role', () => {
  const fields = {
    runId: 'run-1',
    labId: 'primary',
    variantKey: 'champion',
    configFingerprint: 'fp-1',
  };

  assert.equal(buildEvaluationCacheKey(fields), buildEvaluationCacheKey({ ...fields }));
  assert.equal(
    buildEvaluationCacheKey(fields),
    '["run-1","primary","champion","fp-1"]',
  );
});

test('buildEvaluationCacheKey treats missing fields as deterministic nulls', () => {
  assert.equal(
    buildEvaluationCacheKey({ runId: 'run-1', variantKey: 'champion' }),
    '["run-1",null,"champion",null]',
  );
  assert.equal(buildEvaluationCacheKey(), '[null,null,null,null]');
});

test('buildEvaluationCacheKey keeps delimiter-containing fields distinct', () => {
  const left = buildEvaluationCacheKey({
    runId: 'r',
    labId: 'x',
    variantKey: 'champion',
    configFingerprint: 'y|champion|z',
  });
  const right = buildEvaluationCacheKey({
    runId: 'r',
    labId: 'x|champion|y',
    variantKey: 'champion',
    configFingerprint: 'z',
  });

  assert.notEqual(left, right);
});

test('createEvaluationCache reuses in-flight evaluations', async () => {
  let calls = 0;
  const cache = createEvaluationCache();
  const key = buildEvaluationCacheKey({
    runId: 'run-1',
    labId: 'primary',
    variantKey: 'champion',
    configFingerprint: 'fp-1',
  });
  const [left, right] = await Promise.all([
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
  ]);
  assert.deepEqual(left, { score: 1 });
  assert.deepEqual(right, { score: 1 });
  assert.equal(calls, 1);
});

test('createEvaluationCache does not reuse entries for distinct field tuples', async () => {
  const base = {
    runId: 'run-1',
    labId: 'primary',
    variantKey: 'champion',
    configFingerprint: 'fp-1',
  };
  const variants = [
    ['runId', { ...base, runId: 'run-2' }],
    ['labId', { ...base, labId: 'shadow' }],
    ['variantKey', { ...base, variantKey: 'challenger' }],
    ['configFingerprint', { ...base, configFingerprint: 'fp-2' }],
  ];

  for (const [fieldName, variant] of variants) {
    const cache = createEvaluationCache();
    let calls = 0;
    const baseKey = buildEvaluationCacheKey(base);
    const variantKey = buildEvaluationCacheKey(variant);

    assert.notEqual(baseKey, variantKey);

    const baseResult = await cache.getOrCompute(baseKey, async () => {
      calls += 1;
      return { label: 'base' };
    });
    const variantResult = await cache.getOrCompute(variantKey, async () => {
      calls += 1;
      return { label: fieldName };
    });

    assert.deepEqual(baseResult, { label: 'base' });
    assert.deepEqual(variantResult, { label: fieldName });
    assert.equal(calls, 2);
    assert.equal(cache.size(), 2);
  }
});

test('createEvaluationCache reports cached entry count', async () => {
  const cache = createEvaluationCache();
  assert.equal(cache.size(), 0);
  await cache.getOrCompute(
    buildEvaluationCacheKey({
      runId: 'run-1',
      labId: 'primary',
      variantKey: 'champion',
      configFingerprint: 'fp-1',
    }),
    async () => ({ score: 1 }),
  );
  assert.equal(cache.size(), 1);
});

test('createEvaluationCache evicts rejected evaluations so callers can retry', async () => {
  let calls = 0;
  const cache = createEvaluationCache();
  const key = buildEvaluationCacheKey({
    runId: 'run-1',
    labId: 'primary',
    variantKey: 'champion',
    configFingerprint: 'fp-1',
  });

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
