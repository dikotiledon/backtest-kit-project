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
