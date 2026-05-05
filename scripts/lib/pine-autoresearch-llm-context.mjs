function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneArray(value) {
  return Array.isArray(value)
    ? value.map((item) => (isPlainObject(item) ? { ...item } : item))
    : [];
}

function cloneMemory(memory) {
  return {
    ...(isPlainObject(memory) ? memory : {}),
    latestMatrixBlocker: isPlainObject(memory?.latestMatrixBlocker) ? { ...memory.latestMatrixBlocker } : null,
    recentCandidates: cloneArray(memory?.recentCandidates),
    failureLessons: Array.isArray(memory?.failureLessons) ? [...memory.failureLessons] : [],
    topWinners: cloneArray(memory?.topWinners),
    rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? [...memory.rejectedFingerprints] : [],
    activeHypotheses: cloneArray(memory?.activeHypotheses),
  };
}

function resolvePromptCap(maxPromptBytes) {
  if (Number.isFinite(maxPromptBytes)) {
    return Math.max(0, maxPromptBytes);
  }

  return 16384;
}

function buildHardRules(maxPromptBytes) {
  return [
    'Return exactly one JSON object (strict) matching requiredOutput schema.',
    'No markdown.',
    'No batch envelopes.',
    'No code fences.',
    'No extra commentary.',
    'Propose one falsifiable candidate patch targeting latest matrix blocker.',
    'Reference current champion baseline and current parameter values.',
    'Use primary/shadow and hold/promote gate evidence when available (ROI, drawdown, profit factor, trade count, primaryPromote).',
    'Avoid generic lower-threshold + higher-RR + tighter-stop advice unless matrix evidence supports it.',
    'Avoid recent duplicate/rejected candidate families and explain novelty versus recent candidates.',
    'Prefer no more than 3 changed params even when maxChangedParams allows 4.',
    `Keep prompt within ${maxPromptBytes} bytes.`,
  ];
}

function serializePrompt(payload) {
  return JSON.stringify(payload);
}

function promptByteLength(payload) {
  return Buffer.byteLength(serializePrompt(payload), 'utf8');
}

function summarizeSection(value) {
  const bytes = promptByteLength(value);

  if (Array.isArray(value)) {
    return {
      truncated: true,
      bytes,
      kind: 'array',
      items: value.length,
    };
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const summary = {
      truncated: true,
      bytes,
      kind: 'object',
      keys: keys.slice(0, 6),
    };

    if (keys.length > 6) {
      summary.moreKeys = keys.length - 6;
    }

    return summary;
  }

  return {
    truncated: true,
    bytes,
    kind: value === null ? 'null' : typeof value,
  };
}

function buildResearchContext(memory) {
  return {
    latestMatrixBlocker: isPlainObject(memory?.latestMatrixBlocker) ? { ...memory.latestMatrixBlocker } : null,
    recentCandidates: cloneArray(memory?.recentCandidates),
    failureLessons: Array.isArray(memory?.failureLessons) ? [...memory.failureLessons] : [],
    topWinners: cloneArray(memory?.topWinners),
    rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? [...memory.rejectedFingerprints] : [],
    activeHypotheses: cloneArray(memory?.activeHypotheses),
  };
}

function buildRequiredOutput() {
  return {
    params: 'Object of changed parameter values only. Keep same keys/types as allowlist. Prefer <=3 changed params unless strong matrix evidence justifies 4.',
    rationale: 'Short explanation of falsifiable hypothesis, novelty versus recent/rejected candidate families, expected matrix impact, and evidence against current champion baseline.',
  };
}

function buildFullPromptPayload({ champion, allowlist, memory, maxPromptBytes }) {
  const championPayload = isPlainObject(champion) ? { ...champion } : {};
  const allowlistPayload = isPlainObject(allowlist) ? { ...allowlist } : {};
  const researchContext = buildResearchContext(memory);

  return {
    instructions: buildHardRules(maxPromptBytes),
    requiredOutput: buildRequiredOutput(),
    budget: {
      maxPromptBytes,
    },
    champion: championPayload,
    allowlist: allowlistPayload,
    memory,
    researchContext,
  };
}

function buildOverflowPromptPayload({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    requiredOutput: buildRequiredOutput(),
    budget: {
      maxPromptBytes,
    },
    overflow: true,
    truncated: true,
    champion: isPlainObject(champion) ? { ...champion } : {},
    allowlist: isPlainObject(allowlist) ? { ...allowlist } : {},
    memorySummary: summarizeSection(memory),
    researchContext: buildResearchContext(memory),
  };
}

function buildPromptResult(payload, truncated, overflow) {
  return {
    prompt: typeof payload === 'string' ? payload : serializePrompt(payload),
    truncated,
    overflow,
  };
}

export function buildLlmResearchContext({
  champion = {},
  allowlist = {},
  memory = {},
  maxPromptBytes = 16384,
} = {}) {
  const cap = resolvePromptCap(maxPromptBytes);
  const promptMemory = cloneMemory(memory);
  let truncated = false;

  const fullPrompt = buildFullPromptPayload({
    champion,
    allowlist,
    memory: promptMemory,
    maxPromptBytes: cap,
  });

  if (promptByteLength(fullPrompt) <= cap) {
    return buildPromptResult(fullPrompt, false, false);
  }

  while (Array.isArray(promptMemory.recentCandidates) && promptMemory.recentCandidates.length > 0) {
    const current = promptMemory.recentCandidates;
    const nextCount = current.length === 1 ? 0 : Math.max(1, Math.floor(current.length / 2));
    const nextRecentCandidates = nextCount > 0 ? current.slice(-nextCount) : [];

    if (nextRecentCandidates.length === current.length) {
      break;
    }

    promptMemory.recentCandidates = nextRecentCandidates;
    truncated = true;

    const trimmedPrompt = buildFullPromptPayload({
      champion,
      allowlist,
      memory: promptMemory,
      maxPromptBytes: cap,
    });

    if (promptByteLength(trimmedPrompt) <= cap) {
      return buildPromptResult(trimmedPrompt, true, false);
    }
  }

  const overflowPrompt = buildOverflowPromptPayload({
    champion,
    allowlist,
    memory: promptMemory,
    maxPromptBytes: cap,
  });

  if (promptByteLength(overflowPrompt) <= cap) {
    return buildPromptResult(overflowPrompt, true, true);
  }

  const minimalOverflowPrompt = {
    overflow: true,
    truncated: true,
    message: 'overflow',
  };

  if (promptByteLength(minimalOverflowPrompt) <= cap) {
    return buildPromptResult(minimalOverflowPrompt, true, true);
  }

  return buildPromptResult('', true, true);
}
