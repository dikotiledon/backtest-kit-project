import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockedChallengerEntry, shouldRequeueBlockedChallenger, filterRequeueCandidates } from '../scripts/lib/pine-autoresearch.mjs';

test('buildBlockedChallengerEntry creates entry from held manifest with score-passing challenger', () => {
  const manifest = {
    runId: 'run-blocked',
    challenger: { configId: 'cand-a', config: { riskAtrLen: 7 }, score: 147.9 },
    champion: { configId: 'champ', config: { riskAtrLen: 14 } },
    matrixDecision: { recommendation: 'hold', failedGates: ['expectancy'] },
    candidateFingerprint: 'fp-cand-a',
    championFingerprint: 'fp-champ',
  };
  const entry = buildBlockedChallengerEntry(manifest);
  assert.equal(entry.configFingerprint, 'fp-cand-a');
  assert.equal(entry.score, 147.9);
  assert.deepEqual(entry.config, { riskAtrLen: 7 });
  assert.deepEqual(entry.failedGates, ['expectancy']);
  assert.equal(entry.championFingerprintAtBlock, 'fp-champ');
});

test('buildBlockedChallengerEntry returns null when failed gates include hard gates', () => {
  const manifest = {
    runId: 'run-hard',
    challenger: { configId: 'cand-b', config: { riskAtrLen: 7 }, score: 140 },
    matrixDecision: { recommendation: 'hold', failedGates: ['score', 'significance'] },
    candidateFingerprint: 'fp-cand-b',
    championFingerprint: 'fp-champ',
  };
  const entry = buildBlockedChallengerEntry(manifest);
  assert.equal(entry, null);
});

test('buildBlockedChallengerEntry returns null when no failed gates', () => {
  const manifest = {
    runId: 'run-none',
    challenger: { configId: 'cand-c', config: { riskAtrLen: 7 }, score: 150 },
    matrixDecision: { recommendation: 'hold', failedGates: [] },
    candidateFingerprint: 'fp-cand-c',
    championFingerprint: 'fp-champ',
  };
  const entry = buildBlockedChallengerEntry(manifest);
  assert.equal(entry, null);
});

test('buildBlockedChallengerEntry returns null when manifest is missing challenger config', () => {
  const manifest = {
    runId: 'run-missing',
    challenger: { configId: 'cand-d' },
    matrixDecision: { recommendation: 'hold', failedGates: ['expectancy'] },
    candidateFingerprint: 'fp-cand-d',
    championFingerprint: 'fp-champ',
  };
  const entry = buildBlockedChallengerEntry(manifest);
  assert.equal(entry, null);
});

test('shouldRequeueBlockedChallenger returns true when failed gate is now disabled', () => {
  const entry = {
    configFingerprint: 'fp-a',
    config: { riskAtrLen: 7 },
    score: 147.9,
    failedGates: ['expectancy'],
    championFingerprintAtBlock: 'fp-champ',
  };
  const currentPolicy = { requireExpectancyNonRegression: false, rejectWrGainAvgWinLoss: false };
  assert.equal(shouldRequeueBlockedChallenger(entry, { expectancyPolicy: currentPolicy }), true);
});

test('shouldRequeueBlockedChallenger returns false when failed gate is still active', () => {
  const entry = {
    configFingerprint: 'fp-a',
    config: { riskAtrLen: 7 },
    score: 147.9,
    failedGates: ['expectancy'],
    championFingerprintAtBlock: 'fp-champ',
  };
  const currentPolicy = { requireExpectancyNonRegression: true, rejectWrGainAvgWinLoss: true };
  assert.equal(shouldRequeueBlockedChallenger(entry, { expectancyPolicy: currentPolicy }), false);
});

test('shouldRequeueBlockedChallenger returns false for null entry', () => {
  assert.equal(shouldRequeueBlockedChallenger(null, { expectancyPolicy: {} }), false);
});

test('filterRequeueCandidates excludes entries blocked for hard gates', () => {
  const entries = [
    { configFingerprint: 'fp-a', failedGates: ['score', 'significance'] },
    { configFingerprint: 'fp-b', failedGates: ['expectancy'] },
    { configFingerprint: 'fp-c', failedGates: ['tradeFloor'] },
  ];
  const requeue = filterRequeueCandidates(entries);
  assert.deepEqual(requeue.map(e => e.configFingerprint), ['fp-b']);
});

test('filterRequeueCandidates returns empty array for non-array input', () => {
  assert.deepEqual(filterRequeueCandidates(null), []);
  assert.deepEqual(filterRequeueCandidates(undefined), []);
});

test('filterRequeueCandidates excludes entries with mixed soft and hard gates', () => {
  const entries = [
    { configFingerprint: 'fp-mixed', failedGates: ['expectancy', 'tradeFloor'] },
    { configFingerprint: 'fp-soft', failedGates: ['expectancy'] },
  ];
  const requeue = filterRequeueCandidates(entries);
  assert.deepEqual(requeue.map(e => e.configFingerprint), ['fp-soft']);
});