export async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const workerCount = Math.min(list.length, Math.max(1, Number(limit) || 1));
  const results = new Array(list.length);
  let nextIndex = 0;
  let firstError = null;

  async function worker() {
    while (!firstError && nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(list[index], index, list);
      } catch (error) {
        firstError ||= error;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;
  return results;
}
