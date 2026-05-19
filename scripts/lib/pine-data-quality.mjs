export function validateOhlcRow(row) {
  const errors = [];

  if (!row?.timestamp || typeof row.timestamp !== 'string') {
    errors.push('Missing or invalid timestamp');
  }

  const open = Number(row?.Open);
  const high = Number(row?.High);
  const low = Number(row?.Low);
  const close = Number(row?.Close);

  if (!Number.isFinite(open)) errors.push('Open is not finite');
  if (!Number.isFinite(high)) errors.push('High is not finite');
  if (!Number.isFinite(low)) errors.push('Low is not finite');
  if (!Number.isFinite(close)) errors.push('Close is not finite');

  if (Number.isFinite(high) && Number.isFinite(low) && high < low) {
    errors.push('High < Low');
  }

  if (Number.isFinite(close) && Number.isFinite(high) && Number.isFinite(low)) {
    if (close > high) errors.push('Close > High');
    if (close < low) errors.push('Close < Low');
  }

  if (Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low)) {
    if (open > high) errors.push('Open > High');
    if (open < low) errors.push('Open < Low');
  }

  return { valid: errors.length === 0, errors };
}

export function detectGaps(rows, { expectedIntervalMs } = {}) {
  if (!expectedIntervalMs || rows.length < 2) return [];
  const gaps = [];
  const tolerance = expectedIntervalMs * 1.5;

  for (let i = 1; i < rows.length; i++) {
    const prev = Date.parse(rows[i - 1]?.timestamp);
    const curr = Date.parse(rows[i]?.timestamp);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const diff = curr - prev;
    if (diff > tolerance) {
      gaps.push({
        afterIndex: i - 1,
        expectedMs: expectedIntervalMs,
        actualMs: diff,
        missedBars: Math.round((diff - expectedIntervalMs) / expectedIntervalMs),
      });
    }
  }

  return gaps;
}

export function validateDataset(rows, { timeframeMinutes = 15 } = {}) {
  let invalidRows = 0;
  const invalidDetails = [];

  for (let i = 0; i < rows.length; i++) {
    const result = validateOhlcRow(rows[i]);
    if (!result.valid) {
      invalidRows++;
      if (invalidDetails.length < 10) {
        invalidDetails.push({ index: i, errors: result.errors });
      }
    }
  }

  const gaps = detectGaps(rows, { expectedIntervalMs: timeframeMinutes * 60 * 1000 });

  return {
    totalRows: rows.length,
    invalidRows,
    invalidDetails,
    gaps: gaps.length,
    gapDetails: gaps.slice(0, 10),
    valid: invalidRows === 0 && gaps.length === 0,
  };
}

export function buildDataQualityReport(rows, options = {}) {
  const base = validateDataset(rows, options);
  const errorDensity = base.totalRows > 0 ? base.invalidRows / base.totalRows : 0;

  let severity = 'ok';
  if (errorDensity > 0.1) severity = 'critical';
  else if (errorDensity > 0.02) severity = 'warning';
  else if (base.invalidRows > 0 || base.gaps > 0) severity = 'minor';

  return { ...base, severity, errorDensity: Number(errorDensity.toFixed(4)) };
}
