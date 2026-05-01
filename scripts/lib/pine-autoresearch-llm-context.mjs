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

function buildPromptObject({ champion, allowlist, memory, maxPromptBytes }) {
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

function serializePrompt(payload) {
  return JSON.stringify(payload);
}

function promptByteLength(payload) {
  return Buffer.byteLength(serializePrompt(payload), 'utf8');
}

export function buildLlmResearchContext({
  champion = {},
  allowlist = {},
  memory = {},
  maxPromptBytes = 16384,
} = {}) {
  const promptMemory = cloneMemory(memory);
  const cap = Number.isFinite(maxPromptBytes) && maxPromptBytes > 0 ? maxPromptBytes : 16384;
  let promptObject = buildPromptObject({ champion, allowlist, memory: promptMemory, maxPromptBytes: cap });
  let truncated = false;

  const trimQueues = [
    promptMemory.recentCandidates,
    promptMemory.topWinners,
    promptMemory.rejectedFingerprints,
    promptMemory.activeHypotheses,
  ];

  while (promptByteLength(promptObject) > cap) {
    let trimmed = false;

    for (const queue of trimQueues) {
      if (Array.isArray(queue) && queue.length > 0) {
        queue.shift();
        truncated = true;
        trimmed = true;
        break;
      }
    }

    if (!trimmed) {
      break;
    }

    promptObject = buildPromptObject({ champion, allowlist, memory: promptMemory, maxPromptBytes: cap });
  }

  return {
    prompt: serializePrompt(promptObject),
    truncated,
  };
}
