function normalizeInput(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);

  if (safeLevel < 2 || !generatedExhausted) {
    return { mode: 'none', reason: 'not-eligible' };
  }

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
