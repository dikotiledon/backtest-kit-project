export function buildEvaluationCacheKey({ runId, labId, variantKey, configFingerprint } = {}) {
  return [runId, labId, variantKey, configFingerprint]
    .map((value) => value == null ? '' : String(value))
    .join('|');
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
