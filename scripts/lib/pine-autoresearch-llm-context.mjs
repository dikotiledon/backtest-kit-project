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
    recentCandidates: cloneArray(memory?.recentCandidates),
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
    'Output must be exactly one JSON object.',
    'No markdown.',
    'No batch envelopes.',
    'No code fences.',
    'No extra commentary.',
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

function buildFullPromptPayload({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    budget: {
      maxPromptBytes,
    },
    champion: isPlainObject(champion) ? { ...champion } : {},
    allowlist: isPlainObject(allowlist) ? { ...allowlist } : {},
    memory,
  };
}

function buildOverflowPromptPayload({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    budget: {
      maxPromptBytes,
    },
    overflow: true,
    truncated: true,
    champion: summarizeSection(champion),
    allowlist: summarizeSection(allowlist),
    memory: summarizeSection(memory),
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

  return buildPromptResult('', true, true);
}
