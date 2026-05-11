const REQUIRED_BACKTEST_METRICS = [
  'roiPct',
  'profitFactor',
  'tradeCount',
  'maxDrawdownPct',
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteMetric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Number(trimmed));
}

function hasBacktestMetrics(value) {
  if (!isRecord(value)) return false;
  return REQUIRED_BACKTEST_METRICS.every((metric) => isFiniteMetric(value[metric]));
}

function labIdFor(result, index) {
  return result?.lab?.labId
    ?? result?.labId
    ?? result?.id
    ?? `lab-${index + 1}`;
}

export function validateLlmMatrixEvidence(input = {}) {
  const source = isRecord(input) ? input : {};
  const { matrixDecision = null } = source;
  const labResults = Array.isArray(source.labResults) ? source.labResults : [];

  if (matrixDecision?.recommendation !== 'promote') {
    return { ok: true, reason: 'not_promoting', invalidLabIds: [] };
  }

  const promotedLabs = labResults
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result?.decision?.recommendation === 'promote');

  if (promotedLabs.length === 0) {
    return { ok: false, reason: 'missing_backtest_evidence', invalidLabIds: [] };
  }

  const invalidLabIds = promotedLabs
    .filter(({ result }) => !hasBacktestMetrics(result?.incumbent) || !hasBacktestMetrics(result?.challenger))
    .map(({ result, index }) => String(labIdFor(result, index)));

  if (invalidLabIds.length > 0) {
    return { ok: false, reason: 'missing_backtest_evidence', invalidLabIds };
  }

  return { ok: true, reason: 'backtest_evidence_present', invalidLabIds: [] };
}
