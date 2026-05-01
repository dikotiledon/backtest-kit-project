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

function buildHardRules(maxPromptBytes) {
  return [
    'Output must be exactly one JSON object.',
    'No markdown.',
    'No batch envelopes.',
    'No code fences.',
    'No extra commentary.',
    `Keep prompt within ${Number.isFinite(maxPromptBytes) ? maxPromptBytes : 16384} bytes.`,
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

function buildFullPrompt({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    budget: {
      maxPromptBytes: Number.isFinite(maxPromptBytes) && maxPromptBytes > 0 ? maxPromptBytes : 16384,
    },
    champion: isPlainObject(champion) ? { ...champion } : {},
    allowlist: isPlainObject(allowlist) ? { ...allowlist } : {},
    memory,
  };
}

function buildOverflowPrompt({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    budget: {
      maxPromptBytes: Number.isFinite(maxPromptBytes) && maxPromptBytes > 0 ? maxPromptBytes : 16384,
    },
    overflow: true,
    truncated: true,
    champion: summarizeSection(champion),
    allowlist: summarizeSection(allowlist),
    memory: summarizeSection(memory),
  };
}

function buildEmergencyPrompt() {
  return { overflow: true, truncated: true };
}

export function buildLlmResearchContext({
  champion = {},
  allowlist = {},
  memory = {},
  maxPromptBytes = 16384,
} = {}) {
  const promptMemory = cloneMemory(memory);
  const cap = Number.isFinite(maxPromptBytes) && maxPromptBytes > 0 ? maxPromptBytes : 16384;

  const candidates = [
    { payload: buildFullPrompt({ champion, allowlist, memory: promptMemory, maxPromptBytes: cap }), truncated: false, overflow: false },
    { payload: buildOverflowPrompt({ champion, allowlist, memory: promptMemory, maxPromptBytes: cap }), truncated: true, overflow: true },
    { payload: buildEmergencyPrompt(), truncated: true, overflow: true },
    { payload: {}, truncated: true, overflow: true },
  ];

  for (const candidate of candidates) {
    const prompt = serializePrompt(candidate.payload);
    if (Buffer.byteLength(prompt, 'utf8') <= cap) {
      return {
        prompt,
        truncated: candidate.truncated,
        overflow: candidate.overflow,
      };
    }
  }

  return {
    prompt: '',
    truncated: true,
    overflow: true,
  };
}
