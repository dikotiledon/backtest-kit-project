export function buildEvaluationCacheKey({ runId, labId, variantKey, configFingerprint } = {}) {
  return JSON.stringify([
    runId ?? null,
    labId ?? null,
    variantKey ?? null,
    configFingerprint ?? null,
  ]);
}

export function createEvaluationCache() {
  const entries = new Map();

  return {
    getOrCompute(key, compute) {
      if (entries.has(key)) return entries.get(key);

      const promise = Promise.resolve()
        .then(compute)
        .catch((error) => {
          entries.delete(key);
          throw error;
        });
      entries.set(key, promise);
      return promise;
    },
    size() {
      return entries.size;
    },
  };
}
