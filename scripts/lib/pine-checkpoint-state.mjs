import fs from 'node:fs/promises';
import path from 'node:path';

const CHECKPOINT_KEY_SEPARATOR = '|';
const CHECKPOINT_KEY_FIELDS = ['runId', 'lane', 'candidateId', 'labId', 'stage'];

export const CHECKPOINT_JSONL_DURABILITY_NOTE =
  'Checkpoint JSONL is append-only and assumes one scheduler writer per run; readers tolerate malformed tail lines via parseErrors.';

function createCheckpointState() {
  const state = new Map();
  Object.defineProperty(state, 'parseErrors', {
    value: [],
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return state;
}

function normalizeCheckpointKeyPart(name, value) {
  if (value === null || value === undefined) {
    throw new Error(`Invalid checkpoint key part "${name}": value is required`);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid checkpoint key part "${name}": expected string or number`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`Invalid checkpoint key part "${name}": value must be non-empty`);
  }

  if (normalized.includes(CHECKPOINT_KEY_SEPARATOR)) {
    throw new Error(`Invalid checkpoint key part "${name}": value must not contain "${CHECKPOINT_KEY_SEPARATOR}"`);
  }

  return normalized;
}

export function buildCheckpointKey(parts) {
  const normalizedParts = CHECKPOINT_KEY_FIELDS.map((field) => normalizeCheckpointKeyPart(field, parts?.[field]));
  return normalizedParts.join(CHECKPOINT_KEY_SEPARATOR);
}

// Checkpoint JSONL is append-only and assumes one scheduler writer per run;
// readers tolerate malformed tail lines via parseErrors.
export async function appendCheckpointEvent(filePath, event) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function readCheckpointState(filePath) {
  let content;
  const state = createCheckpointState();

  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return state;
    }

    throw error;
  }

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      state.parseErrors.push({ lineNumber, error: `invalid-json: ${error.message}` });
      continue;
    }

    if (!event?.key || typeof event.key !== 'string' || !event.key.trim()) {
      state.parseErrors.push({ lineNumber, error: 'missing-key' });
      continue;
    }

    state.set(event.key, event);
  }

  return state;
}

export function selectIncompleteStages(plannedStages, state) {
  return plannedStages.filter((stage) => state.get(stage.key)?.status !== 'completed');
}
