export function buildEvaluationCacheKey({ runId, labId, variantKey, configFingerprint } = {}) {
  return JSON.stringify([
    runId ?? null,
    labId ?? null,
    variantKey ?? null,
    configFingerprint ?? null,
  ]);
}

export function createEvaluationCache({ cacheVersion = 1 } = {}) {
  const entries = new Map();

  return {
    getOrCompute(key, compute) {
      if (entries.has(key)) {
        const stored = entries.get(key);
        if (stored._cacheVersion === cacheVersion) return stored.promise;
        // Version mismatch — discard stale entry
        entries.delete(key);
      }

      const promise = Promise.resolve()
        .then(compute)
        .catch((error) => {
          entries.delete(key);
          throw error;
        });
      entries.set(key, { promise, _cacheVersion: cacheVersion });
      return promise;
    },
    size() {
      return entries.size;
    },
  };
}
