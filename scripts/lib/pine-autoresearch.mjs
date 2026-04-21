import fs from 'node:fs/promises';
import path from 'node:path';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isoNow() {
  return new Date().toISOString();
}

export function timestampId() {
  return isoNow().replace(/[:.]/g, '-');
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export function summarizeResult(result) {
  if (!result) return null;
  return {
    label: result.label || result.configId || 'unknown',
    configId: result.configId,
    score: round(result.score, 2),
    tradeCount: result.metrics?.tradeCount ?? 0,
    roiPct: round(result.metrics?.roiPct ?? 0, 2),
    winRatePct: round(result.metrics?.winRatePct ?? 0, 2),
    profitFactor: round(result.metrics?.profitFactor ?? 0, 2),
    maxDrawdownPct: round(result.metrics?.maxDrawdownPct ?? 0, 2),
    config: result.config || null,
  };
}

export function decideAutoresearchOutcome({ incumbent, challenger, thresholds = {} }) {
  if (!incumbent) {
    throw new Error('Incumbent result is required');
  }

  if (!challenger) {
    return {
      recommendation: 'hold',
      summary: 'No successful challenger found.',
      comparisons: null,
      gates: {
        challengerPresent: false,
      },
      failedGates: ['challengerPresent'],
    };
  }

  const minScoreDelta = thresholds.minScoreDelta ?? 0.25;
  const minRoiDeltaPct = thresholds.minRoiDeltaPct ?? 0;
  const minProfitFactorDelta = thresholds.minProfitFactorDelta ?? 0;
  const maxDrawdownDeltaPct = thresholds.maxDrawdownDeltaPct ?? 0.75;
  const minTradeCount = thresholds.minTradeCount ?? 100;
  const minTradeRatioVsIncumbent = thresholds.minTradeRatioVsIncumbent ?? 0.75;

  const comparisons = {
    scoreDelta: round((challenger.score ?? 0) - (incumbent.score ?? 0), 2),
    roiDeltaPct: round((challenger.metrics?.roiPct ?? 0) - (incumbent.metrics?.roiPct ?? 0), 2),
    profitFactorDelta: round((challenger.metrics?.profitFactor ?? 0) - (incumbent.metrics?.profitFactor ?? 0), 2),
    drawdownDeltaPct: round((challenger.metrics?.maxDrawdownPct ?? 0) - (incumbent.metrics?.maxDrawdownPct ?? 0), 2),
    tradeDelta: (challenger.metrics?.tradeCount ?? 0) - (incumbent.metrics?.tradeCount ?? 0),
    tradeRatioVsIncumbent: round((challenger.metrics?.tradeCount ?? 0) / Math.max(1, incumbent.metrics?.tradeCount ?? 0), 3),
  };

  const gates = {
    score: comparisons.scoreDelta >= minScoreDelta,
    roi: comparisons.roiDeltaPct >= minRoiDeltaPct,
    profitFactor: comparisons.profitFactorDelta >= minProfitFactorDelta,
    drawdown: comparisons.drawdownDeltaPct <= maxDrawdownDeltaPct,
    tradeFloor: (challenger.metrics?.tradeCount ?? 0) >= minTradeCount,
    tradeRatio: comparisons.tradeRatioVsIncumbent >= minTradeRatioVsIncumbent,
  };

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = recommendation === 'promote'
    ? `Promote challenger ${challenger.configId}: all promotion gates passed.`
    : `Hold incumbent ${incumbent.configId}: challenger ${challenger.configId} failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    comparisons,
    gates,
    failedGates,
    thresholds: {
      minScoreDelta,
      minRoiDeltaPct,
      minProfitFactorDelta,
      maxDrawdownDeltaPct,
      minTradeCount,
      minTradeRatioVsIncumbent,
    },
  };
}

export function renderScoutMarkdown({ config, manifest }) {
  const incumbent = manifest.incumbent;
  const challenger = manifest.challenger;
  const decision = manifest.decision;
  const lines = [
    `# Pine Autoresearch Scout - ${config.labId}`,
    '',
    `- Generated: ${manifest.generatedAt}`,
    `- Run ID: ${manifest.runId}`,
    `- Run dir: \`${manifest.runDir}\``,
    `- Grid: \`${manifest.gridName}\``,
    `- Symbol/timeframe: ${manifest.symbol} ${manifest.timeframe}`,
    `- Bars: ${manifest.limit}`,
    `- Anchor: ${manifest.when || 'latest available window'}`,
    '',
    '## Incumbent',
    '',
    `- ${incumbent.configId}`,
    `- score ${incumbent.score}, trades ${incumbent.tradeCount}, ROI ${incumbent.roiPct}%, win rate ${incumbent.winRatePct}%, PF ${incumbent.profitFactor}, max DD ${incumbent.maxDrawdownPct}%`,
    '',
    '## Best challenger',
    '',
    challenger
      ? `- ${challenger.configId}`
      : '- none',
    challenger
      ? `- score ${challenger.score}, trades ${challenger.tradeCount}, ROI ${challenger.roiPct}%, win rate ${challenger.winRatePct}%, PF ${challenger.profitFactor}, max DD ${challenger.maxDrawdownPct}%`
      : '',
    '',
    '## Decision',
    '',
    `- Recommendation: **${decision.recommendation.toUpperCase()}**`,
    `- ${decision.summary}`,
  ];

  if (decision.comparisons) {
    lines.push('', '## Deltas', '');
    lines.push(`- score delta: ${decision.comparisons.scoreDelta}`);
    lines.push(`- ROI delta: ${decision.comparisons.roiDeltaPct}%`);
    lines.push(`- profit factor delta: ${decision.comparisons.profitFactorDelta}`);
    lines.push(`- drawdown delta: ${decision.comparisons.drawdownDeltaPct}%`);
    lines.push(`- trade ratio vs incumbent: ${decision.comparisons.tradeRatioVsIncumbent}`);
    lines.push('', '## Gates', '');
    for (const [gate, passed] of Object.entries(decision.gates)) {
      lines.push(`- ${gate}: ${passed ? 'PASS' : 'FAIL'}`);
    }
  }

  if (manifest.topConfigs?.length) {
    lines.push('', '## Top configs', '');
    for (const item of manifest.topConfigs) {
      lines.push(`- ${item.configId}: score ${item.score}, trades ${item.tradeCount}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  return `${lines.filter(Boolean).join('\n')}\n`;
}

export function renderDigestMarkdown({ config, latestManifest, previousManifest }) {
  const latest = latestManifest?.challenger;
  const incumbent = latestManifest?.incumbent;
  const decision = latestManifest?.decision;
  const previous = previousManifest?.challenger;
  const lines = [
    `# Pine Autoresearch Digest - ${config.labId}`,
    '',
    `- Generated: ${isoNow()}`,
    `- Latest run: ${latestManifest?.runId || 'n/a'}`,
    `- Window: ${config.symbol} ${config.timeframe} ${config.limit} bars @ ${config.when || 'latest available window'}`,
    '',
    '## Current state',
    '',
    incumbent ? `- Incumbent: ${incumbent.configId} (score ${incumbent.score}, ROI ${incumbent.roiPct}%)` : '- Incumbent: n/a',
    latest ? `- Latest challenger: ${latest.configId} (score ${latest.score}, ROI ${latest.roiPct}%)` : '- Latest challenger: none',
    decision ? `- Recommendation: **${decision.recommendation.toUpperCase()}**` : '- Recommendation: n/a',
  ];

  if (decision?.comparisons) {
    lines.push('', '## Latest run deltas', '');
    lines.push(`- score delta vs incumbent: ${decision.comparisons.scoreDelta}`);
    lines.push(`- ROI delta vs incumbent: ${decision.comparisons.roiDeltaPct}%`);
    lines.push(`- PF delta vs incumbent: ${decision.comparisons.profitFactorDelta}`);
    lines.push(`- max DD delta vs incumbent: ${decision.comparisons.drawdownDeltaPct}%`);
    lines.push(`- trade ratio vs incumbent: ${decision.comparisons.tradeRatioVsIncumbent}`);
  }

  if (latest && previous) {
    lines.push('', '## Change since previous scout', '');
    lines.push(`- previous challenger: ${previous.configId} (score ${previous.score}, ROI ${previous.roiPct}%)`);
    lines.push(`- latest challenger: ${latest.configId} (score ${latest.score}, ROI ${latest.roiPct}%)`);
    lines.push(`- challenger score delta: ${round(latest.score - previous.score, 2)}`);
    lines.push(`- challenger ROI delta: ${round(latest.roiPct - previous.roiPct, 2)}%`);
  }

  lines.push('', '## Recommendation', '', decision?.summary || 'No decision available.', '');
  return `${lines.join('\n')}\n`;
}

export function summarizeDigestAnnouncement({ latestManifest, previousManifest }) {
  const decision = latestManifest?.decision;
  const latest = latestManifest?.challenger;
  const previous = previousManifest?.challenger;
  if (!latest || !decision) {
    return 'pine autoresearch digest: no challenger data yet';
  }

  const parts = [
    `pine autoresearch ${decision.recommendation}`,
    `${latest.configId}`,
    `score ${latest.score}`,
    `ROI ${latest.roiPct}%`,
  ];

  if (decision.comparisons) {
    parts.push(`vs incumbent score ${decision.comparisons.scoreDelta >= 0 ? '+' : ''}${decision.comparisons.scoreDelta}`);
  }

  if (previous) {
    parts.push(`prev ${previous.configId} score ${previous.score}`);
  }

  return parts.join(' | ');
}
