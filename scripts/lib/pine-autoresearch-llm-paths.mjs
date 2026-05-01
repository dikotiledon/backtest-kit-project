import path from 'node:path';

const SAFE_MATRIX_ID = /^[A-Za-z0-9._-]+$/;

export function normalizeMatrixId(matrixId) {
  if (typeof matrixId !== 'string' || !SAFE_MATRIX_ID.test(matrixId) || matrixId.includes('..')) {
    throw new Error(`unsafe matrixId: ${matrixId}`);
  }

  return matrixId;
}

export function buildLlmLaneNamespace(matrixId) {
  return `llm-${normalizeMatrixId(matrixId)}`;
}

export function buildLlmLanePaths({ repoRoot = process.cwd(), matrixId }) {
  const normalizedMatrixId = normalizeMatrixId(matrixId);
  const namespace = buildLlmLaneNamespace(normalizedMatrixId);
  const root = path.join(repoRoot, 'pine', 'autoresearch-llm', namespace);
  const state = path.join(root, 'state');
  const manifests = path.join(root, 'manifests');
  const runs = path.join(root, 'runs');
  const archive = path.join(root, 'archive');

  return {
    matrixId: normalizedMatrixId,
    namespace,
    root,
    state,
    manifests,
    runs,
    archive,
    schedulerLock: path.join(state, 'llm-scheduler.lock'),
    stateLock: path.join(state, 'llm-state.lock'),
    reservationLock: path.join(state, 'llm-reservation.lock'),
    ledger: path.join(state, 'llm-ledger.jsonl'),
    memory: path.join(state, 'llm-research-memory.json'),
    reviewQueue: path.join(state, 'llm-manual-review-queue.jsonl'),
    tabu: path.join(state, 'llm-tabu-fingerprints.json'),
    providerStatus: path.join(state, 'llm-provider-status.json'),
    mutexName: `Global\\BacktestKit-Pine-LLM-Autoresearch-${normalizedMatrixId}`,
  };
}
