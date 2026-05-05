import fs from 'node:fs/promises';
import path from 'node:path';

export function buildCheckpointKey({ runId, lane, candidateId, labId, stage }) {
  return [runId, lane, candidateId, labId, stage].join('|');
}

export async function appendCheckpointEvent(filePath, event) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function readCheckpointState(filePath) {
  let content;

  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return new Map();
    }

    throw error;
  }

  const state = new Map();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!event?.key) {
      continue;
    }

    state.set(event.key, event);
  }

  return state;
}

export function selectIncompleteStages(plannedStages, state) {
  return plannedStages.filter((stage) => state.get(stage.key)?.status !== 'completed');
}
