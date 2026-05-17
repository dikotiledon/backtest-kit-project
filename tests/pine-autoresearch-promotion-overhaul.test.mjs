import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoresearchOutcome, decideMatrixPromotion } from '../scripts/lib/pine-autoresearch.mjs';
import { loadConfig } from '../scripts/pine-autoresearch.mjs';
import { buildTrackCandidateBatch } from '../scripts/lib/pine-track-generators.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Real data values from task spec
const champion = {
  configId: 'test-config',
  score: 152.47,
  metrics: {
    roiPct: 91.7,
    profitFactor: 3.56,
    maxDrawdownPct: 2.88,
    tradeCount: 261,
  },
};

const challenger = {
  configId: 'test-config-v2',
  score: 172.33,
  metrics: {
    roiPct: 76.41,
    profitFactor: 9.14,
    maxDrawdownPct: 1.19,
    tradeCount: 245,
  },
};

// Thresholds that include roiRelaxation with tiered config
const thresholdsWithRelaxation = {
  minScoreDelta: 0.1,
  minRoiDeltaPct: 0,
  minProfitFactorDelta: 0,
  maxDrawdownDeltaPct: 0.75,
  minTradeCount: 150,
  minTradeRatioVsIncumbent: 0.75,
  roiRelaxation: {
    enabled: true,
    minScoreDeltaToRelax: 12,
    maxRoiRegressionPct: 20,
    tieredRelaxation: {
      enabled: true,
      pfMultiplierThreshold: 2,
      ddImprovementRequired: true,
      maxRoiRegressionPct: 20,
    },
  },
};

// Same thresholds but without roiRelaxation
const thresholdsWithoutRelaxation = {
  minScoreDelta: 0.1,
  minRoiDeltaPct: 0,
  minProfitFactorDelta: 0,
  maxDrawdownDeltaPct: 0.75,
  minTradeCount: 150,
  minTradeRatioVsIncumbent: 0.75,
};

describe('Promotion Overhaul - roiRelaxation passthrough', () => {
  it('promotes challenger via tiered ROI relaxation when roiRelaxation is present', () => {
    const result = decideAutoresearchOutcome({
      incumbent: champion,
      challenger,
      thresholds: thresholdsWithRelaxation,
    });

    assert.equal(result.recommendation, 'promote',
      `Expected promote but got ${result.recommendation}: ${result.summary}`);
    assert.equal(result.comparisons.roiRelaxationApplied, true,
      'Expected roiRelaxationApplied to be true');
    assert.equal(result.comparisons.roiRelaxationTier, 'tiered',
      'Expected tiered relaxation tier');
  });

  it('holds challenger when roiRelaxation is absent (roi gate fails)', () => {
    const result = decideAutoresearchOutcome({
      incumbent: champion,
      challenger,
      thresholds: thresholdsWithoutRelaxation,
    });

    assert.equal(result.recommendation, 'hold',
      `Expected hold but got ${result.recommendation}: ${result.summary}`);
  });

  it('integration: loadConfig normalizes primaryLab thresholds with roiRelaxation', async () => {
    const config = await loadConfig(projectRoot);
    const primaryThresholds = config.primaryLab.thresholds;

    assert.ok(primaryThresholds.roiRelaxation != null,
      'Expected primaryLab.thresholds.roiRelaxation to be present after loadConfig normalization');
    assert.equal(primaryThresholds.roiRelaxation.enabled, true,
      'Expected roiRelaxation.enabled to be true');
    assert.ok(primaryThresholds.roiRelaxation.tieredRelaxation != null,
      'Expected tieredRelaxation to be present');
    assert.equal(primaryThresholds.roiRelaxation.tieredRelaxation.enabled, true,
      'Expected tieredRelaxation.enabled to be true');
  });
});

import { nextTrackState } from '../scripts/lib/pine-autoresearch-tracks.mjs';

describe('PF Gate Calibration - minProfitFactorDelta tolerance', () => {
  const incumbentPF = {
    configId: 'pf-incumbent',
    score: 152.47,
    metrics: {
      roiPct: 91.7,
      profitFactor: 3.56,
      maxDrawdownPct: 2.88,
      tradeCount: 261,
      winRate: 42.53,
      avgWin: 1.15,
      avgLoss: 0.24,
    },
  };

  const thresholdsPFTolerant = {
    minScoreDelta: 0.1,
    minRoiDeltaPct: 0,
    minProfitFactorDelta: -0.05,
    maxDrawdownDeltaPct: 0.75,
    minTradeCount: 150,
    minTradeRatioVsIncumbent: 0.75,
    significance: { minRelativeScoreDelta: 0, minTradeCount: 100 },
  };

  it('promotes candidate with marginal PF regression (-0.02) within tolerance', () => {
    const challengerMarginal = {
      configId: 'pf-challenger-marginal',
      score: 153.32,
      metrics: {
        roiPct: 92.84,
        profitFactor: 3.54,
        maxDrawdownPct: 3.12,
        tradeCount: 268,
        winRate: 42.54,
        avgWin: 1.14,
        avgLoss: 0.24,
      },
    };

    const result = decideAutoresearchOutcome({
      incumbent: incumbentPF,
      challenger: challengerMarginal,
      thresholds: thresholdsPFTolerant,
    });

    assert.equal(result.recommendation, 'promote',
      `Expected promote but got ${result.recommendation}: ${result.summary}`);
    // PF delta is -0.02, threshold is -0.05, so gate passes
    assert.equal(result.gates.profitFactor, true,
      'Expected PF gate to pass with marginal regression within tolerance');
  });

  it('holds candidate with PF regression exceeding tolerance (-0.10)', () => {
    const challengerExcessive = {
      configId: 'pf-challenger-excessive',
      score: 153.0,
      metrics: {
        roiPct: 92.0,
        profitFactor: 3.46,
        maxDrawdownPct: 3.0,
        tradeCount: 270,
        winRate: 41.0,
        avgWin: 1.12,
        avgLoss: 0.24,
      },
    };

    const result = decideAutoresearchOutcome({
      incumbent: incumbentPF,
      challenger: challengerExcessive,
      thresholds: thresholdsPFTolerant,
    });

    assert.equal(result.recommendation, 'hold',
      `Expected hold but got ${result.recommendation}: ${result.summary}`);
    // PF delta is -0.10, threshold is -0.05, so gate fails
    assert.equal(result.gates.profitFactor, false,
      'Expected PF gate to fail with regression exceeding tolerance');
  });
});

describe('Issue #4: track rotation off-by-one', () => {
  it('should trigger rotation when sameTrackCycleStreak equals maxCyclesPerTrack', () => {
    const result = nextTrackState({
      state: {
        activeTrackId: 'track-A',
        sameTrackCycleStreak: 8,
        noChangeStreak: 0,
        noNewCandidateStreak: 0,
        lowEmissionStreak: 0,
        noScoreImprovementStreak: 0,
        cycleIndex: 10,
        tabuRejectedFingerprints: [],
      },
      policy: {
        maxCyclesPerTrack: 8,
        noChangeStreakRotateAfter: 99,
        similarityRotateAbove: 0.99,
        zeroEmissionRotateAfter: 99,
      },
      manifest: {
        promotionEligible: false,
        activeTrackId: 'track-A',
        topCandidateSimilarity: 0.1,
        searchEfficiency: { emittedVariantCount: 10 },
      },
    });

    assert.equal(result.activeTrackId, null,
      'Expected activeTrackId to be null (rotation triggered) when streak equals max');
  });

  it('should NOT trigger rotation when streak is below max', () => {
    const result = nextTrackState({
      state: {
        activeTrackId: 'track-A',
        sameTrackCycleStreak: 7,
        noChangeStreak: 0,
        noNewCandidateStreak: 0,
        lowEmissionStreak: 0,
        noScoreImprovementStreak: 0,
        cycleIndex: 10,
        tabuRejectedFingerprints: [],
      },
      policy: {
        maxCyclesPerTrack: 8,
        noChangeStreakRotateAfter: 99,
        similarityRotateAbove: 0.99,
        zeroEmissionRotateAfter: 99,
      },
      manifest: {
        promotionEligible: false,
        activeTrackId: 'track-A',
        topCandidateSimilarity: 0.1,
        searchEfficiency: { emittedVariantCount: 10 },
      },
    });

    assert.notEqual(result.activeTrackId, null,
      'Expected activeTrackId to remain set (no rotation) when streak is below max');
  });
});

import { decideStagnationEscapePlan } from '../scripts/lib/pine-stagnation-escape.mjs';

describe('Gate-stagnation escape path', () => {
  it('activates widen-architecture at level 3+ with gateStagnation and generation healthy', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 3,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    assert.equal(result.mode, 'widen-architecture');
    assert.equal(result.reason, 'gate-stagnation');
    assert.equal(result.allowArchitectureKeys, true);
    assert.equal(result.multiKeyMutationCount, 3);
    assert.equal(result.ladderScale, 2);
  });

  it('uses progressive-widen with higher mutation at level 5+ with gateStagnation', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 5,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    assert.equal(result.mode, 'progressive-widen');
    assert.equal(result.reason, 'gate-stagnation');
    assert.equal(result.allowArchitectureKeys, true);
    assert.equal(result.multiKeyMutationCount, 4);
    assert.equal(result.ladderScale, 2.5);
  });

  it('remains not-eligible at level 2 with gateStagnation (too early)', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 2,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    assert.equal(result.mode, 'none');
    assert.equal(result.reason, 'not-eligible');
  });

  it('uses existing exhaustion path when generatedLanesExhausted even with gateStagnation', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 4,
      generatedLanesExhausted: true,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    // Should hit exploit-deepen (existing path), NOT gate-stagnation
    assert.equal(result.mode, 'exploit-deepen');
    assert.equal(result.reason, 'exploit-still-available');
  });
});

describe('Issue #6: scoreImproved circular dependency', () => {
  const baseState = {
    activeTrackId: 'track-A',
    sameTrackCycleStreak: 2,
    noChangeStreak: 0,
    noNewCandidateStreak: 0,
    lowEmissionStreak: 0,
    noScoreImprovementStreak: 4,
    cycleIndex: 10,
    tabuRejectedFingerprints: [],
  };

  const basePolicy = {
    maxCyclesPerTrack: 99,
    noChangeStreakRotateAfter: 99,
    similarityRotateAbove: 0.99,
    zeroEmissionRotateAfter: 99,
  };

  it('should reset noScoreImprovementStreak when best candidate beats champion score even if primary lab holds', () => {
    const result = nextTrackState({
      state: baseState,
      policy: basePolicy,
      manifest: {
        promotionEligible: false,
        primaryLabPassed: false,
        activeTrackId: 'track-A',
        topCandidateSimilarity: 0.1,
        searchEfficiency: { emittedVariantCount: 10 },
        bestScoreDelta: 5.2, // positive: candidate beats champion
      },
    });

    assert.equal(result.noScoreImprovementStreak, 0,
      'Expected noScoreImprovementStreak to reset to 0 when bestScoreDelta > 0 regardless of primaryLabPassed');
  });

  it('should increment noScoreImprovementStreak when no candidate beats champion score', () => {
    const result = nextTrackState({
      state: baseState,
      policy: basePolicy,
      manifest: {
        promotionEligible: false,
        primaryLabPassed: false,
        activeTrackId: 'track-A',
        topCandidateSimilarity: 0.1,
        searchEfficiency: { emittedVariantCount: 10 },
        bestScoreDelta: -1.3, // negative: no improvement
      },
    });

    assert.equal(result.noScoreImprovementStreak, 5,
      'Expected noScoreImprovementStreak to increment from 4 to 5 when bestScoreDelta <= 0');
  });
});

import { nextStagnationState } from '../scripts/lib/pine-autoresearch-tracks.mjs';

describe('Issue #7: de-escalation yo-yo prevention', () => {
  it('should NOT de-escalate when noScoreImprovementStreak exceeds threshold', () => {
    const result = nextStagnationState({
      previousLevel: 4,
      noNewCandidateStreak: 0,
      noScoreImprovementStreak: 3,
      noChangeStreak: 0,
      lowEmissionStreak: 0,
      promotionEligible: false,
      topCandidateSimilarity: 0.5,
      policy: {
        enabled: true,
        maxStagnationLevel: 6,
        noScoreImprovementEscalateAfter: 2,
        deescalation: { enabled: true, consecutiveHealthyCycles: 2 },
        _healthyCycleCount: 3,
      },
    });
    assert.equal(result.stagnationLevel, 4,
      'Should NOT de-escalate while noScoreImprovementStreak is high');
  });

  it('should de-escalate when noScoreImprovementStreak is below threshold', () => {
    const result = nextStagnationState({
      previousLevel: 4,
      noNewCandidateStreak: 0,
      noScoreImprovementStreak: 1,
      noChangeStreak: 0,
      lowEmissionStreak: 0,
      promotionEligible: false,
      topCandidateSimilarity: 0.5,
      policy: {
        enabled: true,
        maxStagnationLevel: 6,
        noScoreImprovementEscalateAfter: 2,
        deescalation: { enabled: true, consecutiveHealthyCycles: 2 },
        _healthyCycleCount: 3,
      },
    });
    assert.equal(result.stagnationLevel, 3,
      'Should de-escalate when noScoreImprovementStreak is low');
  });
});

describe('Issue #8: gateAwareFilter compatibility with tiered relaxation', () => {
  const incumbent = {
    slAtrMult: 0.5,
    minBarsBetween: 1,
    minPredSum: 1.8,
    tpAtrMult: 6.85,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    useSupertrendFilter: true,
    supertrendAtrLen: 10,
    supertrendFactor: 1.5,
  };

  it('should generate candidates with slAtrMultMinRatio 0.15', () => {
    const batch = buildTrackCandidateBatch({
      track: { trackId: 'risk-tuning', sourceFamily: 'incumbent-local' },
      incumbent,
      maxConfigs: 12,
      historyEvents: [],
      budgetPolicy: {
        searchPolicy: {
          gateAwareFilter: { enabled: true, slAtrMultMinRatio: 0.15 },
        },
        selfLoopEscape: { enabled: false },
      },
      schedulerState: { cycleIndex: 0, tabuRejectedFingerprints: [] },
    });
    assert.ok(batch.length > 0, 'Should generate candidates with ratio 0.15');
  });

  it('should filter degenerate slAtrMult below floor (champion * 0.15)', () => {
    const batch = buildTrackCandidateBatch({
      track: { trackId: 'risk-tuning', sourceFamily: 'incumbent-local' },
      incumbent,
      maxConfigs: 12,
      historyEvents: [],
      budgetPolicy: {
        searchPolicy: {
          gateAwareFilter: { enabled: true, slAtrMultMinRatio: 0.15 },
        },
        selfLoopEscape: { enabled: false },
      },
      schedulerState: { cycleIndex: 0, tabuRejectedFingerprints: [] },
    });
    const hasDegenerateSl = batch.some(v =>
      v.config && Number.isFinite(v.config.slAtrMult) && v.config.slAtrMult < 0.075
    );
    assert.equal(hasDegenerateSl, false, 'Should filter degenerate slAtrMult below 0.075');
  });
});

describe('Issue #5: Shadow labs activation (end-to-end)', () => {
  it('full pipeline: tiered relaxation + shadows = promotion', () => {
    const incumbent = {
      configId: 'original-153-champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 12,
        maxRoiRegressionPct: 10,
        tieredRelaxation: {
          enabled: true,
          pfMultiplierThreshold: 2,
          ddImprovementRequired: true,
          maxRoiRegressionPct: 20,
        },
      },
    };

    // Step 1: Primary lab decision
    const primaryDecision = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(primaryDecision.recommendation, 'promote',
      `Primary should promote via tiered relaxation. Failed: ${primaryDecision.failedGates?.join(', ')}`);
    assert.equal(primaryDecision.comparisons.roiRelaxationApplied, true);
    assert.equal(primaryDecision.comparisons.roiRelaxationTier, 'tiered');

    // Step 2: Matrix decision with shadows (3/5 pass = 60%)
    const labResults = [
      { lab: { labId: 'primary' }, decision: primaryDecision },
      { lab: { labId: 'shadow-1' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-2' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-3' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-4' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-5' }, decision: { recommendation: 'hold' } },
    ];
    const matrixResult = decideMatrixPromotion({
      labResults,
      policy: {
        requirePrimaryPromote: true,
        minShadowPassCount: 3,
        minShadowPassRatio: 0.6,
        requireCandidateChange: true,
      },
      champion: incumbent,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(matrixResult.recommendation, 'promote',
      `Matrix should promote. Failed: ${matrixResult.failedGates?.join(', ')}`);
  });

  it('should hold when shadows do not meet minimum pass count', () => {
    const incumbent = {
      configId: 'original-153-champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 12,
        maxRoiRegressionPct: 10,
        tieredRelaxation: {
          enabled: true,
          pfMultiplierThreshold: 2,
          ddImprovementRequired: true,
          maxRoiRegressionPct: 20,
        },
      },
    };

    const primaryDecision = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(primaryDecision.recommendation, 'promote');

    // Only 2/5 shadows pass (below minShadowPassCount: 3)
    const labResults = [
      { lab: { labId: 'primary' }, decision: primaryDecision },
      { lab: { labId: 'shadow-1' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-2' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-3' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-4' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-5' }, decision: { recommendation: 'hold' } },
    ];
    const matrixResult = decideMatrixPromotion({
      labResults,
      policy: {
        requirePrimaryPromote: true,
        minShadowPassCount: 3,
        minShadowPassRatio: 0.6,
        requireCandidateChange: true,
      },
      champion: incumbent,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(matrixResult.recommendation, 'hold');
    assert.ok(
      matrixResult.failedGates?.includes('shadowPassCount') || matrixResult.failedGates?.includes('shadowPassRatio'),
      'Should fail shadow gate'
    );
  });

  it('should hold when primary does not promote (no relaxation)', () => {
    const incumbent = {
      configId: 'original-153-champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    // No roiRelaxation → primary holds
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    };

    const primaryDecision = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(primaryDecision.recommendation, 'hold');

    // Even if all shadows would pass, matrix should hold because primary holds
    const labResults = [
      { lab: { labId: 'primary' }, decision: primaryDecision },
      { lab: { labId: 'shadow-1' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-2' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-3' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-4' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-5' }, decision: { recommendation: 'promote' } },
    ];
    const matrixResult = decideMatrixPromotion({
      labResults,
      policy: {
        requirePrimaryPromote: true,
        minShadowPassCount: 3,
        minShadowPassRatio: 0.6,
        requireCandidateChange: true,
      },
      champion: incumbent,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(matrixResult.recommendation, 'hold');
    assert.ok(matrixResult.failedGates?.includes('primaryPromote'),
      'Should fail primaryPromote gate');
  });
});

describe('Promotion Overhaul - profitabilityFloor vs tiered relaxation', () => {
  const incumbent = {
    configId: 'incumbent-floor-test',
    score: 152.47,
    metrics: {
      roiPct: 91.7,
      profitFactor: 3.56,
      maxDrawdownPct: 2.88,
      tradeCount: 261,
    },
  };

  const thresholds = {
    minScoreDelta: 0.1,
    minRoiDeltaPct: 0,
    minProfitFactorDelta: 0,
    maxDrawdownDeltaPct: 0.75,
    minTradeCount: 150,
    minTradeRatioVsIncumbent: 0.75,
    roiRelaxation: {
      enabled: true,
      minScoreDeltaToRelax: 12,
      maxRoiRegressionPct: 12,
      tieredRelaxation: {
        enabled: true,
        pfMultiplierThreshold: 2,
        ddImprovementRequired: true,
        maxRoiRegressionPct: 12,
      },
    },
  };

  const promotionPolicy = {
    minRoiDeltaPct: 3,
    minProfitFactorDelta: 0.1,
    minTradeCount: 60,
  };

  it('should promote when tiered relaxation applied — skip profitabilityFloor', () => {
    const challenger = {
      configId: 'challenger-relaxed',
      score: 165.0,
      metrics: {
        roiPct: 80.0,
        profitFactor: 8.0,
        maxDrawdownPct: 1.5,
        tradeCount: 250,
      },
    };

    const result = decideAutoresearchOutcome({
      incumbent,
      challenger,
      thresholds,
      promotionPolicy,
    });

    assert.equal(result.comparisons.roiRelaxationApplied, true,
      'Expected roiRelaxationApplied to be true');
    assert.equal(result.comparisons.roiRelaxationTier, 'tiered',
      'Expected tiered relaxation tier');
    assert.equal(result.recommendation, 'promote',
      'Should promote — profitabilityFloor must be skipped when tiered relaxation fires');
  });

  it('should still apply profitabilityFloor when relaxation NOT applied', () => {
    const challenger = {
      configId: 'challenger-no-relaxation',
      score: 156.0,
      metrics: {
        roiPct: 92.5,
        profitFactor: 3.58,
        maxDrawdownPct: 2.85,
        tradeCount: 265,
      },
    };

    const result = decideAutoresearchOutcome({
      incumbent,
      challenger,
      thresholds: { ...thresholds, significance: { minRelativeScoreDelta: 0 } },
      promotionPolicy,
    });

    assert.equal(result.comparisons.roiRelaxationApplied, false,
      'Expected roiRelaxationApplied to be false — ROI improved, no relaxation needed');
    assert.equal(result.recommendation, 'hold',
      'Should hold — ROI delta +0.8 < minRoiDeltaPct 3, profitabilityFloor blocks');
    assert.ok(result.failedGates?.includes('profitabilityFloor'),
      'Should fail profitabilityFloor gate');
  });
});
