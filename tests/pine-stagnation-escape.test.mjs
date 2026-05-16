import test from 'node:test';
import assert from 'node:assert/strict';

import { decideStagnationEscapePlan } from '../scripts/lib/pine-stagnation-escape.mjs';

test('decideStagnationEscapePlan ignores shallow or unexhausted stagnation', () => {
  assert.deepEqual(decideStagnationEscapePlan(), { mode: 'none', reason: 'not-eligible' });
  assert.deepEqual(decideStagnationEscapePlan(null), { mode: 'none', reason: 'not-eligible' });
  assert.deepEqual(decideStagnationEscapePlan({ stagnationLevel: 1, generatedLanesExhausted: true }), { mode: 'none', reason: 'not-eligible' });
  assert.deepEqual(decideStagnationEscapePlan({ stagnationLevel: 3, generatedLanesExhausted: false, exploitExhausted: true }), { mode: 'none', reason: 'not-eligible' });
});

test('decideStagnationEscapePlan widens bounds after generated lanes exhaust at level 2', () => {
  assert.deepEqual(decideStagnationEscapePlan({
    stagnationLevel: 2,
    generatedLanesExhausted: true,
  }), {
    mode: 'widen-bounds',
    reason: 'generated-lanes-exhausted',
    allowArchitectureKeys: false,
    multiKeyMutationCount: 2,
    ladderScale: 1.5,
  });
});

test('decideStagnationEscapePlan deepens exploit while exploit remains available', () => {
  assert.deepEqual(decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: true,
    exploitExhausted: false,
  }), {
    mode: 'exploit-deepen',
    reason: 'exploit-still-available',
    allowArchitectureKeys: false,
    multiKeyMutationCount: 2,
    ladderScale: 1.25,
  });
});

test('decideStagnationEscapePlan progressively widens once generated and exploit lanes are exhausted', () => {
  assert.deepEqual(decideStagnationEscapePlan({
    stagnationLevel: 4,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  }), {
    mode: 'progressive-widen',
    reason: 'all-lanes-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  });
});

test('decideStagnationEscapePlan allows architecture keys at level 2 when both lanes exhausted', () => {
  const result = decideStagnationEscapePlan({
    stagnationLevel: 2,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  });
  assert.equal(result.allowArchitectureKeys, true);
  assert.equal(result.mode, 'widen-architecture');
  assert.equal(result.reason, 'all-lanes-exhausted-at-level-2');
});

test('decideStagnationEscapePlan returns widen-bounds at level 2 when only generated exhausted', () => {
  const result = decideStagnationEscapePlan({
    stagnationLevel: 2,
    generatedLanesExhausted: true,
    exploitExhausted: false,
  });
  assert.equal(result.mode, 'widen-bounds');
  assert.equal(result.allowArchitectureKeys, false);
});

test('decideStagnationEscapePlan reaches progressive-widen at level 3', () => {
  const result = decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  });
  assert.equal(result.mode, 'progressive-widen');
  assert.equal(result.allowArchitectureKeys, true);
  assert.equal(result.multiKeyMutationCount, 3);
});

test('decideStagnationEscapePlan treats zero-emission exploit exhaustion as eligible at level 2+', () => {
  assert.deepEqual(decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: false,
    exploitExhausted: true,
    zeroEmissionExhausted: true,
  }), {
    mode: 'progressive-widen',
    reason: 'zero-emission-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  });
});

test('decideStagnationEscapePlan tolerates malformed inputs', () => {
  assert.deepEqual(decideStagnationEscapePlan('bad'), { mode: 'none', reason: 'not-eligible' });
  assert.deepEqual(decideStagnationEscapePlan({ stagnationLevel: '3', generatedLanesExhausted: 1, exploitExhausted: 1 }), {
    mode: 'progressive-widen',
    reason: 'all-lanes-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  });
});
