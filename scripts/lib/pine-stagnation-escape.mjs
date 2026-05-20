function normalizeInput(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function checkQualityFloors(championQuality, qualityFloors) {
  if (!championQuality || !qualityFloors) return { passed: true, failed: [] };
  const failed = [];
  const q = championQuality;
  const f = qualityFloors;

  if (Number.isFinite(f.minRoiPct) && (q.roiPct ?? 0) < f.minRoiPct) failed.push('roiFloor');
  if (Number.isFinite(f.minProfitFactor) && (q.profitFactor ?? 0) < f.minProfitFactor) failed.push('profitFactorFloor');
  if (Number.isFinite(f.maxDrawdownPct) && (q.maxDrawdownPct ?? 100) > f.maxDrawdownPct) failed.push('drawdownCeiling');
  if (Number.isFinite(f.minTradeCount) && (q.tradeCount ?? 0) < f.minTradeCount) failed.push('tradeCountFloor');

  return { passed: failed.length === 0, failed };
}

export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
    zeroEmissionExhausted = false,
    gateStagnation = false,
    convergencePolicy = {},
    championQuality = null,
    qualityFloors = null,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);
  const zeroEmissionDone = isTruthy(zeroEmissionExhausted);
  const gateStuck = isTruthy(gateStagnation);

  // Quality-aware convergence acceptance
  const convergenceEnabled = convergencePolicy?.enabled === true;
  const maxLevel = Number(convergencePolicy?.maxStagnationLevel ?? 6);
  if (convergenceEnabled && safeLevel >= maxLevel && generatedExhausted && exploitDone) {
    const qualityCheck = checkQualityFloors(championQuality, qualityFloors);
    if (qualityCheck.passed) {
      return {
        mode: 'converged',
        reason: 'convergence-accepted',
        recommendation: 'stop-research',
        allowArchitectureKeys: false,
        multiKeyMutationCount: 0,
        ladderScale: 0,
      };
    }
    return {
      mode: 'progressive-widen',
      reason: 'convergence-blocked-by-quality',
      qualityGatesFailed: qualityCheck.failed,
      allowArchitectureKeys: true,
      multiKeyMutationCount: 4,
      ladderScale: 3,
    };
  }

  if (safeLevel < 2) return { mode: 'none', reason: 'not-eligible' };

  if (!generatedExhausted && zeroEmissionDone) {
    return {
      mode: 'progressive-widen',
      reason: 'zero-emission-exhausted',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  // Gate-stagnation escape — generating candidates but none pass promotion gates
  if (!generatedExhausted && !zeroEmissionDone && gateStuck && safeLevel >= 3) {
    if (safeLevel >= 5) {
      return {
        mode: 'progressive-widen',
        reason: 'gate-stagnation',
        allowArchitectureKeys: true,
        multiKeyMutationCount: 4,
        ladderScale: 2.5,
      };
    }
    return {
      mode: 'widen-architecture',
      reason: 'gate-stagnation',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  if (!generatedExhausted) return { mode: 'none', reason: 'not-eligible' };

  // Level 2 + both exhausted → allow architecture mutation
  if (safeLevel === 2 && exploitDone) {
    return {
      mode: 'widen-architecture',
      reason: 'all-lanes-exhausted-at-level-2',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 2,
      ladderScale: 1.5,
    };
  }

  if (safeLevel === 2) {
    return {
      mode: 'widen-bounds',
      reason: 'generated-lanes-exhausted',
      allowArchitectureKeys: false,
      multiKeyMutationCount: 2,
      ladderScale: 1.5,
    };
  }

  if (!exploitDone) {
    return {
      mode: 'exploit-deepen',
      reason: 'exploit-still-available',
      allowArchitectureKeys: false,
      multiKeyMutationCount: 2,
      ladderScale: 1.25,
    };
  }

  return {
    mode: 'progressive-widen',
    reason: 'all-lanes-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  };
}
