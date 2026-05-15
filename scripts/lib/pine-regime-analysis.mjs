function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sideOf(trade) {
  const side = String(trade?.side || trade?.direction || trade?.positionSide || '').toLowerCase();
  return side === 'short' ? 'short' : 'long';
}

function tradePnl(trade) {
  const value = trade?.returnPctExact ?? trade?.returnPct ?? trade?.pnlPct ?? trade?.pnl ?? trade?.profit ?? trade?.return ?? 0;
  return toNumber(value, 0);
}

function tradeMfe(trade) {
  const value = trade?.mfePct ?? trade?.mfe ?? trade?.maxFavorableExcursionPct ?? trade?.maxRunupPct ?? trade?.runupPct ?? null;
  return value !== null && value !== undefined ? Math.abs(toNumber(value, 0)) : null;
}

function tradeMae(trade) {
  const value = trade?.maePct ?? trade?.mae ?? trade?.maxAdverseExcursionPct ?? trade?.drawdownPct ?? null;
  return value !== null && value !== undefined ? Math.abs(toNumber(value, 0)) : null;
}

function summarizeBucket(trades) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const tradeCount = safeTrades.length;
  const wins = safeTrades.filter((trade) => tradePnl(trade) > 0);
  const losses = safeTrades.filter((trade) => tradePnl(trade) < 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const winTotal = wins.reduce((sum, trade) => sum + tradePnl(trade), 0);
  const lossTotalAbs = Math.abs(losses.reduce((sum, trade) => sum + tradePnl(trade), 0));
  const totalPnl = safeTrades.reduce((sum, trade) => sum + tradePnl(trade), 0);
  const mfeValues = safeTrades.map(tradeMfe).filter(v => v !== null);
  const maeValues = safeTrades.map(tradeMae).filter(v => v !== null);
  const mfeTotal = mfeValues.reduce((sum, v) => sum + v, 0);
  const maeTotal = maeValues.reduce((sum, v) => sum + v, 0);
  const hasMfe = mfeValues.length > 0;
  const hasMae = maeValues.length > 0;

  return {
    tradeCount,
    winCount,
    lossCount,
    winRate: tradeCount ? round(winCount / tradeCount, 4) : 0,
    avgWin: winCount ? round(winTotal / winCount, 4) : 0,
    avgLoss: lossCount ? round(lossTotalAbs / lossCount, 4) : 0,
    profitFactor: lossTotalAbs === 0 ? (winTotal > 0 ? Number.POSITIVE_INFINITY : 0) : round(winTotal / lossTotalAbs, 4),
    mfePct: hasMfe ? round(mfeTotal / mfeValues.length, 4) : null,
    maePct: hasMae ? round(maeTotal / maeValues.length, 4) : null,
    MFE: hasMfe ? round(mfeTotal / mfeValues.length, 4) : null,
    MAE: hasMae ? round(maeTotal / maeValues.length, 4) : null,
    avgPnl: tradeCount ? round(totalPnl / tradeCount, 4) : 0,
    totalPnl: round(totalPnl, 4),
  };
}

function pickFeatureRow(featureRows, trade, index) {
  if (trade?.regimeFeatureUnmatched === true) return null;
  const candidates = [trade?.featureIndex, trade?.featureRowIndex, trade?.entryIndex, trade?.barIndex, index];
  for (const candidate of candidates) {
    const resolved = Number(candidate);
    if (Number.isInteger(resolved) && resolved >= 0 && resolved < featureRows.length) {
      return featureRows[resolved];
    }
  }
  return null;
}

function positiveCount(...values) {
  return values.reduce((sum, value) => sum + (Number(value) > 0 ? 1 : 0), 0);
}

export function summarizeSideMetrics({ trades = [] } = {}) {
  const longTrades = [];
  const shortTrades = [];

  for (const trade of trades || []) {
    (sideOf(trade) === 'short' ? shortTrades : longTrades).push(trade);
  }

  return {
    long: summarizeBucket(longTrades),
    short: summarizeBucket(shortTrades),
  };
}

export function classifyRegimeFromFeatures(featureRow = {}) {
  const squeezeActive = positiveCount(featureRow.featureSqueezeState, featureRow.featureFusionV4Active) > 0;
  const squeezeRelease = positiveCount(
    featureRow.featureSqueezeReleaseBull,
    featureRow.featureSqueezeReleaseBear,
    featureRow.featureSqueezeLongBoost,
    featureRow.featureSqueezeShortBoost,
  ) > 0;
  const compressionScore = Math.max(
    toNumber(featureRow.featureChannelCompressionScore, 0),
    toNumber(featureRow.featureCompressionState, 0),
  );
  const trendStrength = Math.max(
    positiveCount(featureRow.featureTrendX, featureRow.featureTrendStrengthState),
    positiveCount(featureRow.featureTrendXLongPass, featureRow.featureTrendXShortPass),
    Math.abs(toNumber(featureRow.featureEffectiveLongStrength, 0) - toNumber(featureRow.featureEffectiveShortStrength, 0)),
  );
  const cautionDensity = Math.max(
    positiveCount(featureRow.featureLongContextCaution, featureRow.featureShortContextCaution),
    positiveCount(featureRow.featureSqueezeLongCaution, featureRow.featureSqueezeShortCaution),
    positiveCount(featureRow.featureDivLongCaution, featureRow.featureDivShortCaution),
  );

  let regime = 'chop';
  if (squeezeRelease || positiveCount(featureRow.featureExpansionState, featureRow.featureSqueezeReleaseBull, featureRow.featureSqueezeReleaseBear) > 0) {
    regime = 'expansion';
  } else if (squeezeActive || compressionScore >= 0.6) {
    regime = 'compression';
  } else if (trendStrength > 0 && cautionDensity === 0) {
    regime = 'trend';
  }

  return {
    regime,
    squeezeActive,
    squeezeRelease,
    compressionScore,
    trendStrength,
    cautionDensity,
  };
}

export function summarizeRegimeSlices({ trades = [], featureRows = [] } = {}) {
  const slices = {
    trend: [],
    chop: [],
    compression: [],
    expansion: [],
  };
  let unmatchedTradeCount = 0;

  (trades || []).forEach((trade, index) => {
    const row = pickFeatureRow(featureRows, trade, index);
    if (!row) {
      unmatchedTradeCount += 1;
      return;
    }

    const classification = classifyRegimeFromFeatures(row);
    slices[classification.regime].push(trade);
  });

  const summary = {};
  for (const [regime, regimeTrades] of Object.entries(slices)) {
    const sideSummary = summarizeSideMetrics({ trades: regimeTrades });
    const aggregate = summarizeBucket(regimeTrades);
    summary[regime] = {
      ...aggregate,
      ...sideSummary,
      tradeCount: aggregate.tradeCount,
    };
  }

  summary.totals = {
    tradeCount: (trades || []).length,
    matchedTradeCount: (trades || []).length - unmatchedTradeCount,
    unmatchedTradeCount,
  };

  return summary;
}

function extractThresholdSurface(metrics = {}) {
  const surface = metrics.thresholdSurface || metrics.sideThresholdSurface || metrics.optimalThresholds || metrics.thresholds || metrics.surface || null;
  if (surface && typeof surface === 'object') {
    const long = toNumber(
      surface.long ?? surface.longThreshold ?? surface.buy ?? surface.longOptimum ?? surface.longBest ?? surface.longSide,
      Number.NaN,
    );
    const short = toNumber(
      surface.short ?? surface.shortThreshold ?? surface.sell ?? surface.shortOptimum ?? surface.shortBest ?? surface.shortSide,
      Number.NaN,
    );

    if (Number.isFinite(long) && Number.isFinite(short)) {
      return { long, short };
    }
  }

  const longMetric = metrics.long || {};
  const shortMetric = metrics.short || {};
  const hasLongEvidence = toNumber(longMetric.tradeCount, 0) > 0;
  const hasShortEvidence = toNumber(shortMetric.tradeCount, 0) > 0;
  if (!hasLongEvidence || !hasShortEvidence) {
    return null;
  }

  const long = toNumber(longMetric.winRate ?? longMetric.profitFactor ?? longMetric.avgWin ?? longMetric.avgPnl, Number.NaN);
  const short = toNumber(shortMetric.winRate ?? shortMetric.profitFactor ?? shortMetric.avgWin ?? shortMetric.avgPnl, Number.NaN);

  if (Number.isFinite(long) && Number.isFinite(short)) {
    return { long, short };
  }

  return null;
}

function surfaceBias(surface, tolerance = 0.25) {
  if (!surface) return 'unknown';
  const gap = surface.long - surface.short;
  if (gap > tolerance) return 'long';
  if (gap < -tolerance) return 'short';
  return 'balanced';
}

export function detectThresholdAsymmetry({ championMetrics = {}, candidateMetrics = {}, tolerance = 0.25 } = {}) {
  const championSurface = extractThresholdSurface(championMetrics);
  const candidateSurface = extractThresholdSurface(candidateMetrics);
  const championGap = championSurface ? Math.abs(championSurface.long - championSurface.short) : 0;
  const candidateGap = candidateSurface ? Math.abs(candidateSurface.long - candidateSurface.short) : 0;
  const gapDelta = round(candidateGap - championGap, 4);
  const championShift = championSurface && candidateSurface
    ? Math.max(
        Math.abs(candidateSurface.long - championSurface.long),
        Math.abs(candidateSurface.short - championSurface.short),
      )
    : 0;

  const hasEvidence = Boolean(championSurface && candidateSurface);
  const sideSurfaceDiverged = candidateSurface ? candidateGap > tolerance : false;
  const widened = candidateSurface ? candidateGap >= championGap + tolerance : false;
  const surfaceShifted = championShift > tolerance;
  const candidateBias = surfaceBias(candidateSurface, tolerance);
  const championBias = surfaceBias(championSurface, tolerance);
  const isAsymmetric = hasEvidence && (widened || surfaceShifted || sideSurfaceDiverged);
  const nextTrack = !hasEvidence
    ? 'continue unified track'
    : isAsymmetric
      ? (candidateBias === 'long'
        ? 'split long/short tracks with long-side emphasis'
        : candidateBias === 'short'
          ? 'split long/short tracks with short-side emphasis'
          : 'split long/short tracks')
      : 'continue unified track';

  return {
    isAsymmetric,
    recommendation: !hasEvidence
      ? 'limited-evidence'
      : isAsymmetric
        ? 'split-long-short-track'
        : 'keep-unified',
    nextTrack,
    championSurface,
    candidateSurface,
    championGap: round(championGap, 4),
    candidateGap: round(candidateGap, 4),
    gapDelta,
    championBias,
    candidateBias,
    flags: {
      hasEvidence,
      sideSurfaceDiverged,
      widened,
      surfaceShifted,
    },
  };
}

function formatPct(value) {
  if (value === Infinity) return '∞';
  if (value === null || value === undefined) return 'n/a';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'n/a';
  return `${round(numeric, 2)}`;
}

function formatSideRow(name, metrics) {
  return `| ${name} | ${metrics.tradeCount} | ${formatPct(metrics.winRate * 100)}% | ${formatPct(metrics.avgWin)} | ${formatPct(metrics.avgLoss)} | ${formatPct(metrics.profitFactor)} | ${formatPct(metrics.mfePct)} | ${formatPct(metrics.maePct)} |`;
}

function formatRegimeRow(name, metrics) {
  return `| ${name} | ${metrics.tradeCount} | ${formatPct(metrics.winRate * 100)}% | ${formatPct(metrics.profitFactor)} | ${formatPct(metrics.mfePct)} | ${formatPct(metrics.maePct)} |`;
}

function formatSurfaceRow(name, surface, bias = 'unknown') {
  if (!surface) {
    return `| ${name} | n/a | n/a | n/a | ${bias} |`;
  }

  const gap = Math.abs(surface.long - surface.short);
  return `| ${name} | ${formatPct(surface.long)} | ${formatPct(surface.short)} | ${formatPct(gap)} | ${bias} |`;
}

export function buildRegimeAnalysisMarkdown({ matrixId = 'pine-autoresearch', runId = 'run', sideMetrics = null, regimeSlices = null, asymmetry = null, trackHint = null } = {}) {
  const long = sideMetrics?.long || summarizeBucket([]);
  const short = sideMetrics?.short || summarizeBucket([]);
  const regimes = regimeSlices || {};
  const flags = asymmetry?.flags || {};
  const recommendation = asymmetry?.recommendation || 'keep-unified';
  const nextTrack = asymmetry?.nextTrack || 'continue unified track';
  const championSurface = asymmetry?.championSurface || null;
  const candidateSurface = asymmetry?.candidateSurface || null;
  const evidenceNotes = [];
  if (!flags.hasEvidence) {
    evidenceNotes.push('Limited evidence: no matched champion/candidate threshold surfaces were available.');
  }
  if ((long.tradeCount + short.tradeCount) === 0) {
    evidenceNotes.push('No qualifying trade rows were captured for this scout cycle.');
  }

  return [
    `# Pine asymmetry analysis - ${matrixId}`,
    '',
    `- runId: ${runId}`,
    `- recommendation: ${recommendation}`,
    `- nextTrack: ${nextTrack}`,
    ...(evidenceNotes.length ? ['', '## Evidence quality', '', ...evidenceNotes.map((line) => `- ${line}`)] : []),
    '',
    '## Threshold surfaces',
    '',
    '| side | long | short | gap | bias |',
    '| --- | ---: | ---: | ---: | --- |',
    formatSurfaceRow('champion', championSurface, asymmetry?.championBias || 'unknown'),
    formatSurfaceRow('candidate', candidateSurface, asymmetry?.candidateBias || 'unknown'),
    '',
    '## Side metrics',
    '',
    '| side | trades | winRate | avgWin | avgLoss | profitFactor | MFE | MAE |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    formatSideRow('long', long),
    formatSideRow('short', short),
    '',
    '## Regime slices',
    '',
    '| regime | trades | winRate | profitFactor | MFE | MAE |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    formatRegimeRow('trend', regimes.trend || summarizeBucket([])),
    formatRegimeRow('chop', regimes.chop || summarizeBucket([])),
    formatRegimeRow('compression', regimes.compression || summarizeBucket([])),
    formatRegimeRow('expansion', regimes.expansion || summarizeBucket([])),
    '',
    '## Asymmetry flags',
    '',
    `- sideSurfaceDiverged: ${Boolean(flags.sideSurfaceDiverged)}`,
    `- widened: ${Boolean(flags.widened)}`,
    `- surfaceShifted: ${Boolean(flags.surfaceShifted)}`,
    `- championGap: ${asymmetry?.championGap ?? 'n/a'}`,
    `- candidateGap: ${asymmetry?.candidateGap ?? 'n/a'}`,
    `- gapDelta: ${asymmetry?.gapDelta ?? 'n/a'}`,
  ].join('\n') + '\n';
}

export function buildRegimeAnalysisArtifact({ matrixId, runId, trades = [], featureRows = [], championMetrics = {}, candidateMetrics = null, trackHint = null } = {}) {
  const sideMetrics = summarizeSideMetrics({ trades });
  const regimeSlices = summarizeRegimeSlices({ trades, featureRows });
  const resolvedChampionMetrics = championMetrics ?? sideMetrics;
  const resolvedCandidateMetrics = candidateMetrics ?? sideMetrics;
  const asymmetry = detectThresholdAsymmetry({ championMetrics: resolvedChampionMetrics, candidateMetrics: resolvedCandidateMetrics });
  const evidence = {
    tradeCount: trades.length,
    featureRowCount: featureRows.length,
    hasChampionSurface: Boolean(extractThresholdSurface(resolvedChampionMetrics)),
    hasCandidateSurface: Boolean(extractThresholdSurface(resolvedCandidateMetrics)),
  };
  return {
    matrixId,
    runId,
    sideMetrics,
    regimeSlices,
    asymmetry,
    recommendation: asymmetry.recommendation,
    nextTrack: asymmetry.nextTrack || 'continue unified track',
    evidence,
    markdown: buildRegimeAnalysisMarkdown({ matrixId, runId, sideMetrics, regimeSlices, asymmetry, trackHint }),
  };
}
