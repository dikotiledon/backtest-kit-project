// scripts/lib/pine-statistical-significance.mjs

// Mulberry32 — fast, deterministic 32-bit PRNG
export function createSeededRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithReplacement(arr, size, rng) {
  const result = new Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = arr[Math.floor(rng() * arr.length)];
  }
  return result;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function bootstrapMeanDifference(groupA, groupB, options = {}) {
  const iterations = options.iterations ?? 2000;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const alpha = 1 - confidenceLevel;
  const rng = createSeededRng(options.seed ?? Date.now());

  const observedDiff = mean(groupB) - mean(groupA);
  const diffs = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    const sampleA = sampleWithReplacement(groupA, groupA.length, rng);
    const sampleB = sampleWithReplacement(groupB, groupB.length, rng);
    diffs[i] = mean(sampleB) - mean(sampleA);
  }

  diffs.sort((a, b) => a - b);
  const lowerBound = Number(percentile(diffs, alpha / 2).toFixed(6));
  const upperBound = Number(percentile(diffs, 1 - alpha / 2).toFixed(6));
  const significant = lowerBound > 0 || upperBound < 0;

  return {
    meanDifference: Number(observedDiff.toFixed(6)),
    lowerBound,
    upperBound,
    confidenceLevel,
    iterations,
    significant,
  };
}

export function permutationTest(groupA, groupB, options = {}) {
  const iterations = options.iterations ?? 2000;
  const alpha = options.alpha ?? 0.05;
  const rng = createSeededRng(options.seed ?? Date.now());

  const observedDiff = Math.abs(mean(groupB) - mean(groupA));
  const combined = [...groupA, ...groupB];
  const nA = groupA.length;
  let extremeCount = 0;

  for (let i = 0; i < iterations; i++) {
    // Fisher-Yates partial shuffle
    const shuffled = [...combined];
    for (let j = 0; j < nA; j++) {
      const k = j + Math.floor(rng() * (shuffled.length - j));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const permDiff = Math.abs(mean(shuffled.slice(nA)) - mean(shuffled.slice(0, nA)));
    if (permDiff >= observedDiff) extremeCount++;
  }

  const pValue = Number(((extremeCount + 1) / (iterations + 1)).toFixed(6));
  return {
    pValue,
    observedDifference: Number(observedDiff.toFixed(6)),
    iterations,
    significant: pValue < alpha,
    alpha,
  };
}

export function isStatisticallySignificant(incumbentReturns, challengerReturns, options = {}) {
  const minSampleSize = options.minSampleSize ?? 20;
  const iterations = options.iterations ?? 2000;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? Date.now();

  if (incumbentReturns.length < minSampleSize || challengerReturns.length < minSampleSize) {
    return {
      significant: false,
      reason: 'insufficient_sample',
      incumbentN: incumbentReturns.length,
      challengerN: challengerReturns.length,
      minSampleSize,
    };
  }

  const bootstrapCI = bootstrapMeanDifference(incumbentReturns, challengerReturns, {
    iterations, confidenceLevel, seed,
  });

  const permutation = permutationTest(incumbentReturns, challengerReturns, {
    iterations, alpha, seed: seed + 1,
  });

  const significant = bootstrapCI.significant && permutation.significant;

  return {
    significant,
    reason: significant ? 'statistically_significant' : 'not_significant',
    bootstrapCI,
    permutation,
    incumbentN: incumbentReturns.length,
    challengerN: challengerReturns.length,
  };
}
