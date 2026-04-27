import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExpectancy, evaluateExpectancyGuard } from '../scripts/lib/pine-expectancy.mjs';

test('computeExpectancy converts win rate, avg win, and avg loss into expectancy', () => {
  const result = computeExpectancy({ winRatePct: 40, avgWin: 2.5, avgLoss: 1.0 });

  assert.equal(result.expectancy, 0.4);
  assert.equal(result.winRatePct, 40);
});

test('rejects win-rate improvement that compresses avg winner', () => {
  const result = evaluateExpectancyGuard({
    champion: { winRatePct: 32, avgWin: 2.4, avgLoss: 1.0 },
    challenger: { winRatePct: 41, avgWin: 1.7, avgLoss: 0.9 },
    policy: { rejectWrGainAvgWinLoss: true, requireExpectancyNonRegression: true },
  });

  assert.equal(result.passed, false);
  assert.match(result.failedGates.join(','), /avgWinCompression/);
  assert.match(result.summary, /Expectancy gate failed/i);
});

test('rejects challenger when decomposed expectancy is worse even with higher win rate', () => {
  const result = evaluateExpectancyGuard({
    champion: { winRatePct: 32, avgWin: 2.4, avgLoss: 1.0 },
    challenger: { winRatePct: 41, avgWin: 1.5, avgLoss: 1.2 },
    policy: { rejectWrGainAvgWinLoss: true, requireExpectancyNonRegression: true },
  });

  assert.equal(result.passed, false);
  assert.match(result.failedGates.join(','), /expectancyNonRegression/);
  assert.ok(result.comparisons.expectancyDelta < 0);
  assert.ok(result.diagnostics.wrDecompositionRequired);
});

test('allows lower win rate when expectancy improves', () => {
  const result = evaluateExpectancyGuard({
    champion: { winRatePct: 52, avgWin: 1.2, avgLoss: 1.1 },
    challenger: { winRatePct: 44, avgWin: 2.0, avgLoss: 0.8 },
    policy: { rejectWrGainAvgWinLoss: true, requireExpectancyNonRegression: true },
  });

  assert.equal(result.passed, true);
  assert.ok(result.comparisons.expectancyDelta > 0);
  assert.equal(result.diagnostics.wrDecompositionRequired, false);
});
