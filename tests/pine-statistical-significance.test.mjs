import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapMeanDifference,
  permutationTest,
  isStatisticallySignificant,
  createSeededRng,
} from '../scripts/lib/pine-statistical-significance.mjs';

describe('pine-statistical-significance', () => {
  describe('createSeededRng', () => {
    it('produces deterministic sequence from same seed', () => {
      const rng1 = createSeededRng(42);
      const rng2 = createSeededRng(42);
      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());
      assert.deepEqual(seq1, seq2);
    });

    it('produces different sequence from different seed', () => {
      const rng1 = createSeededRng(42);
      const rng2 = createSeededRng(99);
      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());
      assert.notDeepEqual(seq1, seq2);
    });

    it('produces values in [0, 1) range', () => {
      const rng = createSeededRng(123);
      for (let i = 0; i < 1000; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1);
      }
    });
  });

  describe('bootstrapMeanDifference', () => {
    it('returns significant for clearly different groups (seeded)', () => {
      const groupA = Array.from({ length: 100 }, (_, i) => 1.0 + (i % 10) * 0.02);
      const groupB = Array.from({ length: 100 }, (_, i) => 2.0 + (i % 10) * 0.02);
      const result = bootstrapMeanDifference(groupA, groupB, { iterations: 1000, seed: 42 });
      assert.ok(result.lowerBound > 0);
      assert.ok(result.upperBound > result.lowerBound);
      assert.ok(result.meanDifference > 0.8);
      assert.equal(result.significant, true);
    });

    it('returns non-significant for overlapping distributions (seeded)', () => {
      const groupA = Array.from({ length: 50 }, (_, i) => 1.0 + (i % 50) * 0.1);
      const groupB = Array.from({ length: 50 }, (_, i) => 1.05 + (i % 50) * 0.1);
      const result = bootstrapMeanDifference(groupA, groupB, { iterations: 1000, seed: 42 });
      assert.equal(result.significant, false);
    });

    it('is deterministic with same seed', () => {
      const groupA = Array.from({ length: 30 }, (_, i) => i * 0.1);
      const groupB = Array.from({ length: 30 }, (_, i) => i * 0.1 + 0.5);
      const r1 = bootstrapMeanDifference(groupA, groupB, { iterations: 500, seed: 77 });
      const r2 = bootstrapMeanDifference(groupA, groupB, { iterations: 500, seed: 77 });
      assert.equal(r1.lowerBound, r2.lowerBound);
      assert.equal(r1.upperBound, r2.upperBound);
    });
  });

  describe('permutationTest', () => {
    it('returns low p-value for clearly different groups (seeded)', () => {
      const groupA = Array.from({ length: 50 }, (_, i) => 1.0 + (i % 5) * 0.02);
      const groupB = Array.from({ length: 50 }, (_, i) => 2.0 + (i % 5) * 0.02);
      const result = permutationTest(groupA, groupB, { iterations: 1000, seed: 42 });
      assert.ok(result.pValue < 0.05);
      assert.equal(result.significant, true);
    });

    it('returns high p-value for interleaved same-distribution data (seeded)', () => {
      // Even indices vs odd indices of same linear sequence
      const all = Array.from({ length: 100 }, (_, i) => i * 0.01);
      const gA = all.filter((_, i) => i % 2 === 0);
      const gB = all.filter((_, i) => i % 2 === 1);
      const result = permutationTest(gA, gB, { iterations: 1000, seed: 42 });
      assert.ok(result.pValue > 0.05);
      assert.equal(result.significant, false);
    });

    it('is deterministic with same seed', () => {
      const groupA = [1, 2, 3, 4, 5];
      const groupB = [6, 7, 8, 9, 10];
      const r1 = permutationTest(groupA, groupB, { iterations: 500, seed: 99 });
      const r2 = permutationTest(groupA, groupB, { iterations: 500, seed: 99 });
      assert.equal(r1.pValue, r2.pValue);
    });
  });

  describe('isStatisticallySignificant', () => {
    it('combines bootstrap CI and permutation test', () => {
      const incumbentReturns = Array.from({ length: 80 }, (_, i) => 0.1 + (i % 8) * 0.01);
      const challengerReturns = Array.from({ length: 80 }, (_, i) => 0.3 + (i % 8) * 0.01);
      const result = isStatisticallySignificant(incumbentReturns, challengerReturns, { seed: 42 });
      assert.equal(result.significant, true);
      assert.ok(result.bootstrapCI.lowerBound > 0);
      assert.ok(result.permutation.pValue < 0.05);
    });

    it('rejects when sample too small', () => {
      const result = isStatisticallySignificant([1, 2], [3, 4], { minSampleSize: 10, seed: 42 });
      assert.equal(result.significant, false);
      assert.equal(result.reason, 'insufficient_sample');
    });
  });
});
