import fs from 'node:fs/promises';
import path from 'node:path';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function isoNow() {
  return new Date().toISOString();
}

export function timestampId() {
  return isoNow().replace(/[:.]/g, '-');
}

export function configFingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
}

export function sameConfig(left, right) {
  return configFingerprint(left) === configFingerprint(right);
}

export function computeSweepOffset({ historyEvents = [], maxConfigs, totalCombos }) {
  if (!(Number.isFinite(maxConfigs) && maxConfigs > 0 && Number.isFinite(totalCombos) && totalCombos > 0)) {
    return 0;
  }
  const priorCycleCount = historyEvents.filter((event) => event?.type === 'cycle').length;
  return (priorCycleCount * maxConfigs) % totalCombos;
}

export function planArtifactPrune({
  manifestRunIds = [],
  sweepRunIds = [],
  evaluationRunIds = [],
  keepLatestRuns = 8,
} = {}) {
  const sortedManifestRunIds = [...manifestRunIds].sort();
  const keepRunIds = keepLatestRuns > 0 ? sortedManifestRunIds.slice(-keepLatestRuns) : [];
  const keepSet = new Set(keepRunIds);
  const manifestSet = new Set(sortedManifestRunIds);

  const partialSweepRunIds = [...sweepRunIds].filter((runId) => !manifestSet.has(runId)).sort();
  const oldSweepRunIds = [...sweepRunIds].filter((runId) => manifestSet.has(runId) && !keepSet.has(runId)).sort();
  const partialEvaluationRunIds = [...evaluationRunIds].filter((runId) => !manifestSet.has(runId)).sort();
  const oldEvaluationRunIds = [...evaluationRunIds].filter((runId) => manifestSet.has(runId) && !keepSet.has(runId)).sort();

  return {
    keepRunIds,
    partialSweepRunIds,
    oldSweepRunIds,
    partialEvaluationRunIds,
    oldEvaluationRunIds,
    deleteSweepRunIds: [...new Set([...partialSweepRunIds, ...oldSweepRunIds])].sort(),
    deleteEvaluationRunIds: [...new Set([...partialEvaluationRunIds, ...oldEvaluationRunIds])].sort(),
  };
}

function isSteadyStateCandidate(incumbent, challenger) {
  return Boolean(incumbent?.config && challenger?.config && sameConfig(incumbent.config, challenger.config));
}

function findBestAlternative(primarySweep, champion) {
  const topConfigs = primarySweep?.topConfigs || [];
  return topConfigs.find((item) => !sameConfig(item?.config, champion?.config)) || null;
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function appendJsonl(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export async function readJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    (left.tradeCount ?? 0) >= (right.tradeCount ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    (left.tradeCount ?? 0) > (right.tradeCount ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}

export function buildParetoShortlist({ champion, rankedResults = [], limit = 4 }) {
  const pool = [champion, ...rankedResults].filter(Boolean);
  const frontier = pool.filter((candidate, index) => {
    return !pool.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate));
  });

  const unique = [];
  const seen = new Set();
  for (const item of frontier) {
    const key = item.configId || JSON.stringify(item.config || item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  if (champion && !unique.some((item) => item.configId === champion.configId)) {
    unique.unshift(champion);
  }

  return unique.slice(0, limit);
}

function robustnessScore(candidate) {
  const counts = candidate.matrixDecision?.counts || {};
  const robustness = candidate.robustness || {};
  return (
    (counts.allPassCount || 0) * 100 +
    (counts.shadowPassCount || 0) * 25 +
    (robustness.aggregateScoreDelta || 0) * 2 +
    (robustness.aggregateRoiDeltaPct || 0) * 3 +
    (robustness.aggregateProfitFactorDelta || 0) * 20 -
    (robustness.aggregateDrawdownDeltaPct || 0) * 10
  );
}

export function selectRobustMatrixCandidate({ candidates = [] }) {
  return [...candidates].sort((left, right) => robustnessScore(right) - robustnessScore(left))[0] || null;
}

export function summarizeResult(result) {
  if (!result) return null;
  return {
    label: result.label || result.configId || 'unknown',
    configId: result.configId,
    score: round(result.score, 2),
    tradeCount: result.metrics?.tradeCount ?? result.tradeCount ?? 0,
    roiPct: round(result.metrics?.roiPct ?? result.roiPct ?? 0, 2),
    winRatePct: round(result.metrics?.winRatePct ?? result.winRatePct ?? 0, 2),
    profitFactor: round(result.metrics?.profitFactor ?? result.profitFactor ?? 0, 2),
    maxDrawdownPct: round(result.metrics?.maxDrawdownPct ?? result.maxDrawdownPct ?? 0, 2),
    config: result.config || null,
  };
}

export function extractChampionBootstrapCandidate(payload) {
  if (!payload) return null;
  if (payload.config) return payload;
  if (payload.status?.config) return payload.status;
  if (payload.ranked?.[0]?.config) return payload.ranked[0];
  if (payload.champion?.config) return payload.champion;
  if (payload.incumbent?.config) return payload.incumbent;
  return null;
}

export function selectChampionBootstrapSource({ latestManifest, seedPayload } = {}) {
  const candidates = [];

  if (latestManifest?.matrixDecision?.recommendation === 'promote' && latestManifest?.challenger?.config) {
    candidates.push({ kind: 'latest-promoted-challenger', source: latestManifest.challenger });
  }
  if (latestManifest?.champion?.config) {
    candidates.push({ kind: 'latest-champion', source: latestManifest.champion });
  }
  if (latestManifest?.incumbent?.config) {
    candidates.push({ kind: 'latest-incumbent', source: latestManifest.incumbent });
  }

  const seedSource = extractChampionBootstrapCandidate(seedPayload);
  if (seedSource?.config) {
    candidates.push({ kind: 'seed-file', source: seedSource });
  }

  return candidates[0] || null;
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

  if (isSteadyStateCandidate(incumbent, challenger)) {
    return {
      recommendation: 'hold',
      summary: `No new candidate on ${incumbent.configId}: challenger matches incumbent, so this run is steady-state validation only.`,
      comparisons,
      gates: {
        candidateChanged: false,
      },
      failedGates: ['candidateChanged'],
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

export function decideMatrixPromotion({ labResults = [], policy = {}, champion, challenger }) {
  const primary = labResults[0] || null;
  const shadowLabs = labResults.slice(1);
  const shadowPassCount = shadowLabs.filter((item) => item.decision?.recommendation === 'promote').length;
  const allPassCount = labResults.filter((item) => item.decision?.recommendation === 'promote').length;
  const shadowPassRatio = shadowLabs.length ? round(shadowPassCount / shadowLabs.length, 3) : 1;
  const candidateChanged = !sameConfig(champion?.config, challenger?.config);

  const requirePrimaryPromote = policy.requirePrimaryPromote ?? true;
  const minShadowPassCount = policy.minShadowPassCount ?? 0;
  const minShadowPassRatio = policy.minShadowPassRatio ?? 0;
  const requireCandidateChange = policy.requireCandidateChange ?? true;

  const gates = {
    candidateChanged: requireCandidateChange ? candidateChanged : true,
    primaryPromote: requirePrimaryPromote ? primary?.decision?.recommendation === 'promote' : true,
    shadowPassCount: shadowPassCount >= minShadowPassCount,
    shadowPassRatio: shadowPassRatio >= minShadowPassRatio,
  };

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = !candidateChanged
    ? `No new candidate. Current champion ${champion?.configId} remains best on the pinned matrix.`
    : recommendation === 'promote'
      ? `Promote challenger ${challenger?.configId}: matrix guards passed (${allPassCount}/${labResults.length} labs promote).`
      : `Hold champion ${champion?.configId}: matrix failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    gates,
    failedGates,
    counts: {
      totalLabs: labResults.length,
      shadowLabs: shadowLabs.length,
      allPassCount,
      shadowPassCount,
      shadowPassRatio,
    },
    policy: {
      requirePrimaryPromote,
      minShadowPassCount,
      minShadowPassRatio,
      requireCandidateChange,
    },
  };
}

export function decideAutoPromotionAction({ latestManifest, historyEvents = [], championState, policy = {}, now = isoNow() }) {
  const enabled = policy.enabled ?? false;
  const cooldownHours = policy.cooldownHours ?? 24;
  const maxPromotionsPerDay = policy.maxPromotionsPerDay ?? 1;
  const requireMatrixPromotion = policy.requireMatrixPromotion ?? true;
  const decision = latestManifest?.matrixDecision || latestManifest?.decision || null;
  const candidate = latestManifest?.challenger || null;
  const candidateChanged = !sameConfig(championState?.config, candidate?.config);
  const matrixReady = requireMatrixPromotion ? decision?.recommendation === 'promote' : Boolean(candidate);

  const promotionEvents = historyEvents.filter((event) => event.type === 'promote' || event.type === 'autopromote');
  const lastPromotion = promotionEvents.at(-1) || null;
  const nowMs = Date.parse(now);
  const cooldownPassed = !lastPromotion
    ? true
    : ((nowMs - Date.parse(lastPromotion.timestamp)) / 3600000) >= cooldownHours;
  const dayStart = new Date(nowMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const promotionsToday = promotionEvents.filter((event) => Date.parse(event.timestamp) >= dayStart.getTime()).length;
  const dailyQuotaPassed = promotionsToday < maxPromotionsPerDay;

  const gates = {
    enabled,
    matrixReady,
    candidateChanged,
    cooldown: cooldownPassed,
    dailyQuota: dailyQuotaPassed,
  };

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = recommendation === 'promote'
    ? `Auto-promote challenger ${candidate?.configId}: guards passed.`
    : `Auto-promote hold: failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    gates,
    failedGates,
    policy: {
      enabled,
      cooldownHours,
      maxPromotionsPerDay,
      requireMatrixPromotion,
    },
  };
}

function renderLabRowTable(labResults) {
  const lines = [
    '| lab | incumbent | challenger | score Δ | ROI Δ | PF Δ | DD Δ | rec |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const item of labResults || []) {
    lines.push(`| ${item.lab.labId} | ${item.incumbent.configId} | ${item.challenger.configId} | ${item.decision.comparisons?.scoreDelta ?? 0} | ${item.decision.comparisons?.roiDeltaPct ?? 0}% | ${item.decision.comparisons?.profitFactorDelta ?? 0} | ${item.decision.comparisons?.drawdownDeltaPct ?? 0}% | ${item.decision.recommendation} |`);
  }

  return `${lines.join('\n')}\n`;
}

function appendTrackDiagnostics(lines, manifest) {
  lines.push('', '## Track rotation', '');
  lines.push(`- topCandidateSimilarity: ${manifest?.topCandidateSimilarity ?? 'n/a'}`);
  lines.push(`- rotationTrigger: ${manifest?.rotationTrigger ?? 'n/a'}`);
  lines.push(`- sameTrackCycleStreak: ${manifest?.sameTrackCycleStreak ?? 0}`);
  lines.push(`- promotionEligible: ${manifest?.promotionEligible ?? false}`);
  lines.push(`- promotionEligibleReason: ${manifest?.promotionEligibleReason ?? 'n/a'}`);
  lines.push(`- rotationReason: ${manifest?.rotationReason ?? 'n/a'}`);
}

export function renderScoutMarkdown({ config, manifest }) {
  const champion = manifest.champion || manifest.incumbent;
  const challenger = manifest.challenger;
  const decision = manifest.matrixDecision || manifest.decision;
  const steadyState = manifest.researchState?.steadyState || isSteadyStateCandidate(champion, challenger);
  const noChangeStreak = manifest.researchState?.noChangeStreak || 0;
  const bestAlternative = findBestAlternative(manifest.primarySweep, champion);
  const lines = [
    `# Pine Autoresearch Scout - ${config.matrixId}`,
    '',
    `- Generated: ${manifest.generatedAt}`,
    `- Run ID: ${manifest.runId}`,
    `- Primary run dir: \`${manifest.primarySweep?.runDir || manifest.runDir}\``,
    `- Grid: \`${manifest.primarySweep?.gridName || manifest.gridName}\``,
    `- Primary lab: ${manifest.primaryLab?.labId || config.primaryLab.labId}`,
    '',
    '## Champion',
    '',
    champion ? `- ${champion.configId}` : '- none',
    champion ? `- score ${champion.score}, trades ${champion.tradeCount}, ROI ${champion.roiPct}%, PF ${champion.profitFactor}, max DD ${champion.maxDrawdownPct}%` : '',
    '',
    '## Challenger',
    '',
    steadyState ? '- No new candidate. Latest scout matched the current champion.' : (challenger ? `- ${challenger.configId}` : '- none'),
    challenger ? `- score ${challenger.score}, trades ${challenger.tradeCount}, ROI ${challenger.roiPct}%, PF ${challenger.profitFactor}, max DD ${challenger.maxDrawdownPct}%` : '',
    '',
    '## Matrix decision',
    '',
    `- Recommendation: **${decision?.recommendation?.toUpperCase() || 'N/A'}**`,
    `- ${decision?.summary || 'No matrix decision.'}`,
  ];

  if (steadyState) {
    lines.push('- Mode: **STEADY STATE**');
    if (noChangeStreak > 0) {
      lines.push(`- No new candidate streak: ${noChangeStreak} cycle(s)`);
    }
    if (bestAlternative) {
      lines.push(`- Best alternate tested: ${bestAlternative.configId}`);
      lines.push(`- Best alternate metrics: score ${bestAlternative.score}, trades ${bestAlternative.tradeCount}, ROI ${bestAlternative.roiPct}%, PF ${bestAlternative.profitFactor}, max DD ${bestAlternative.maxDrawdownPct}%`);
      lines.push(`- Alternate delta vs champion: score ${round(bestAlternative.score - (champion?.score ?? 0), 2)}, ROI ${round(bestAlternative.roiPct - (champion?.roiPct ?? 0), 2)}%, PF ${round(bestAlternative.profitFactor - (champion?.profitFactor ?? 0), 2)}, DD ${round(bestAlternative.maxDrawdownPct - (champion?.maxDrawdownPct ?? 0), 2)}%`);
    } else {
      lines.push('- No alternate config beat or differentiated from the current champion in this scout window.');
    }
  }

  if (decision?.counts) {
    lines.push(`- Labs promoting: ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
    lines.push(`- Shadow pass ratio: ${decision.counts.shadowPassRatio}`);
  }

  if (manifest) {
    appendTrackDiagnostics(lines, manifest);
  }

  if (manifest.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${manifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${manifest.searchPlan.exploitRatio}`);
  }

  if (manifest.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of manifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (manifest.labResults?.length && !(steadyState && noChangeStreak >= 3)) {
    lines.push('', '## Lab matrix', '', renderLabRowTable(manifest.labResults));
  }

  if (manifest.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${manifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${manifest.searchPlan.exploitRatio}`);
  }

  if (manifest.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of manifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (manifest.primarySweep?.topConfigs?.length) {
    lines.push('', '## Primary sweep top configs', '');
    for (const item of manifest.primarySweep.topConfigs) {
      lines.push(`- ${item.configId}: score ${item.score}, trades ${item.tradeCount}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  return `${lines.filter(Boolean).join('\n')}\n`;
}

export function renderDigestMarkdown({ config, latestManifest, previousManifest, historyEvents = [], championState }) {
  const champion = latestManifest?.champion || championState || latestManifest?.incumbent;
  const challenger = latestManifest?.challenger;
  const decision = latestManifest?.matrixDecision || latestManifest?.decision;
  const previous = previousManifest?.challenger;
  const recentEvents = historyEvents.slice(-8).reverse();
  const steadyState = latestManifest?.researchState?.steadyState || isSteadyStateCandidate(champion, challenger);
  const noChangeStreak = latestManifest?.researchState?.noChangeStreak || 0;
  const bestAlternative = findBestAlternative(latestManifest?.primarySweep, champion);

  const lines = [
    `# Pine Autoresearch Digest - ${config.matrixId}`,
    '',
    `- Generated: ${isoNow()}`,
    `- Latest run: ${latestManifest?.runId || 'n/a'}`,
    `- Primary lab: ${config.primaryLab.labId}`,
    `- Shadow labs: ${config.shadowLabs.length}`,
    '',
    '## Current state',
    '',
    champion ? `- Champion: ${champion.configId} (score ${champion.score ?? 'n/a'}, ROI ${champion.roiPct ?? 'n/a'}%)` : '- Champion: n/a',
    steadyState
      ? '- Latest challenger: no new candidate, latest scout matched the current champion'
      : challenger ? `- Latest challenger: ${challenger.configId} (score ${challenger.score}, ROI ${challenger.roiPct}%)` : '- Latest challenger: none',
    decision ? `- Matrix recommendation: **${decision.recommendation.toUpperCase()}**` : '- Matrix recommendation: n/a',
  ];

  if (steadyState) {
    lines.push('- State: **STEADY STATE**');
    if (noChangeStreak > 0) {
      lines.push(`- No new candidate streak: ${noChangeStreak} cycle(s)`);
    }
    if (bestAlternative) {
      lines.push(`- Best alternate tested this cycle: ${bestAlternative.configId} (score ${bestAlternative.score}, ROI ${bestAlternative.roiPct}%)`);
      lines.push(`- Alternate delta vs champion: score ${round(bestAlternative.score - (champion?.score ?? 0), 2)}, ROI ${round(bestAlternative.roiPct - (champion?.roiPct ?? 0), 2)}%`);
    }
  }

  if (decision?.counts) {
    lines.push(`- Promote labs: ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
    lines.push(`- Shadow pass ratio: ${decision.counts.shadowPassRatio}`);
  }

  if (latestManifest) {
    appendTrackDiagnostics(lines, latestManifest);
  }

  if (latestManifest?.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${latestManifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${latestManifest.searchPlan.exploitRatio}`);
  }

  if (latestManifest?.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of latestManifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (latestManifest?.labResults?.length) {
    lines.push('', '## Latest matrix', '', renderLabRowTable(latestManifest.labResults));
  }

  if (challenger && previous && (!steadyState || !sameConfig(previous?.config, challenger?.config))) {
    lines.push('', '## Change since previous scout', '');
    lines.push(`- previous challenger: ${previous.configId} (score ${previous.score}, ROI ${previous.roiPct}%)`);
    lines.push(`- latest challenger: ${challenger.configId} (score ${challenger.score}, ROI ${challenger.roiPct}%)`);
    lines.push(`- challenger score delta: ${round(challenger.score - previous.score, 2)}`);
    lines.push(`- challenger ROI delta: ${round(challenger.roiPct - previous.roiPct, 2)}%`);
  } else if (steadyState) {
    lines.push('', '## Change since previous scout', '', '- No challenger change. This loop is currently acting as pinned-matrix regression validation.');
  }

  if (recentEvents.length) {
    lines.push('', '## Recent history', '');
    lines.push('| ts | type | detail |');
    lines.push('| --- | --- | --- |');
    for (const event of recentEvents) {
      lines.push(`| ${event.timestamp} | ${event.type} | ${event.summary || event.toConfigId || event.challengerConfigId || 'n/a'} |`);
    }
  }

  lines.push('', '## Recommendation', '', decision?.summary || 'No decision available.', '');
  return `${lines.join('\n')}\n`;
}

export function renderHistoryMarkdown({ config, championState, historyEvents = [] }) {
  const recent = historyEvents.slice(-20).reverse();
  const lines = [
    `# Pine Autoresearch History - ${config.matrixId}`,
    '',
    championState ? `- Champion: ${championState.configId}` : '- Champion: n/a',
    championState?.promotedAt ? `- Promoted at: ${championState.promotedAt}` : '- Promoted at: n/a',
    '',
    '| ts | type | champion | challenger | recommendation | note |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const event of recent) {
    lines.push(`| ${event.timestamp} | ${event.type} | ${event.championConfigId || event.fromConfigId || 'n/a'} | ${event.challengerConfigId || event.toConfigId || 'n/a'} | ${event.recommendation || 'n/a'} | ${event.summary || event.note || 'n/a'} |`);
  }

  return `${lines.join('\n')}\n`;
}

export function summarizeDigestAnnouncement({ latestManifest, previousManifest }) {
  const decision = latestManifest?.matrixDecision || latestManifest?.decision;
  const latest = latestManifest?.challenger;
  const previous = previousManifest?.challenger;
  const champion = latestManifest?.champion || latestManifest?.incumbent;
  const steadyState = latestManifest?.researchState?.steadyState || isSteadyStateCandidate(champion, latest);
  if (!latest || !decision) {
    return 'pine autoresearch digest: no challenger data yet';
  }

  if (steadyState) {
    const parts = [
      'pine autoresearch steady-state',
      `champion ${champion?.configId || 'n/a'}`,
      `score ${champion?.score ?? 'n/a'}`,
      `ROI ${champion?.roiPct ?? 'n/a'}%`,
    ];

    if (latestManifest?.researchState?.noChangeStreak) {
      parts.push(`streak ${latestManifest.researchState.noChangeStreak}`);
    }

    return parts.join(' | ');
  }

  const parts = [
    `pine autoresearch ${decision.recommendation}`,
    `${latest.configId}`,
    `score ${latest.score}`,
    `ROI ${latest.roiPct}%`,
  ];

  if (decision.counts) {
    parts.push(`labs ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
  }

  if (previous) {
    parts.push(`prev ${previous.configId} score ${previous.score}`);
  }

  return parts.join(' | ');
}

export {
  buildRegimeAnalysisArtifact,
  buildRegimeAnalysisMarkdown,
  classifyRegimeFromFeatures,
  detectThresholdAsymmetry,
  summarizeRegimeSlices,
  summarizeSideMetrics,
} from './pine-regime-analysis.mjs';
