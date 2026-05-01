import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeJson,
  fingerprintCandidate,
  parseCandidateJson,
  validateCandidate,
} from '../scripts/lib/pine-autoresearch-llm-schema.mjs';

const allowlist = {
  version: 1,
  freezeArchitecture: true,
  maxChangedParams: 2,
  parameters: [
    { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
    { key: 'divRsiLen', type: 'int', min: 5, max: 50, step: 1, mutability: 'tunable', family: 'divergence' },
    { key: 'riskRewardRatio', type: 'float', min: 0.5, max: 5, step: 0.1, mutability: 'guarded', family: 'risk' },
    { key: 'useFusionV4', type: 'bool', mutability: 'forbidden', family: 'architecture' },
  ],
};

const champion = {
  minPredSum: 1.7,
  divRsiLen: 14,
  riskRewardRatio: 2,
  useFusionV4: true,
};

test('parseCandidateJson accepts one strict JSON object', () => {
  assert.deepEqual(parseCandidateJson('{"patch":{"minPredSum":1.8}}'), {
    patch: { minPredSum: 1.8 },
  });
});

test('parseCandidateJson rejects array batch output', () => {
  assert.throws(() => parseCandidateJson('[{"patch":{"minPredSum":1.8}}]'), /exactly one JSON object/);
});

test('parseCandidateJson rejects fenced markdown', () => {
  assert.throws(() => parseCandidateJson('```json\n{"patch":{"minPredSum":1.8}}\n```'), /JSON object only/);
});

test('validateCandidate accepts valid parameter-only patch', () => {
  const result = validateCandidate({
    candidate: { patch: { minPredSum: 1.8, divRsiLen: 15 } },
    allowlist,
    champion,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changedKeys.length, 2);
});

test('validateCandidate rejects unknown key', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { unknownParam: 1 } },
    allowlist,
    champion,
  }), /unknown parameter/);
});

test('validateCandidate rejects out-of-range value', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { minPredSum: 9 } },
    allowlist,
    champion,
  }), /outside range/);
});

test('validateCandidate rejects wrong int type', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { divRsiLen: 14.5 } },
    allowlist,
    champion,
  }), /expected int/);
});

test('validateCandidate rejects non-finite float', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { minPredSum: Infinity } },
    allowlist,
    champion,
  }), /expected float/);
});

test('validateCandidate rejects too many params', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { minPredSum: 1.8, divRsiLen: 15, riskRewardRatio: 2.1 } },
    allowlist,
    champion,
  }), /too many/);
});

test('validateCandidate rejects guarded param without manual override', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { riskRewardRatio: 2.1 } },
    allowlist,
    champion,
  }), /guarded/);
});

test('validateCandidate rejects forbidden architecture toggle', () => {
  assert.throws(() => validateCandidate({
    candidate: { patch: { useFusionV4: false } },
    allowlist,
    champion,
  }), /forbidden/);
});

test('validateCandidate rejects duplicate fingerprint', () => {
  const first = validateCandidate({
    candidate: { patch: { minPredSum: 1.8, divRsiLen: 15 } },
    allowlist,
    champion,
  });

  assert.throws(() => validateCandidate({
    candidate: { patch: { minPredSum: 1.8, divRsiLen: 15 } },
    allowlist,
    champion,
    recentFingerprints: new Set([first.fingerprint]),
  }), /duplicate/);
});

test('canonical fingerprints stable across key order', () => {
  assert.equal(canonicalizeJson({ b: 2, a: 1 }), '{"a":1,"b":2}');

  const left = fingerprintCandidate({ patch: { b: 2, a: 1 } });
  const right = fingerprintCandidate({ patch: { a: 1, b: 2 } });

  assert.equal(left, right);
});
