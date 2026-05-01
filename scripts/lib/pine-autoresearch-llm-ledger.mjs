import fs from 'node:fs/promises';
import path from 'node:path';

function isMissingError(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function toIso(value) {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

export async function appendLlmLedgerEvent(ledgerPath, event) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });

  const record = {
    ...event,
    at: toIso(event?.at),
  };

  await fs.appendFile(ledgerPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readLlmLedger(ledgerPath) {
  let raw = '';

  try {
    raw = await fs.readFile(ledgerPath, 'utf8');
  } catch (error) {
    if (isMissingError(error)) {
      return { events: [], errors: [] };
    }

    throw error;
  }

  const events = [];
  const errors = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (!line || !line.trim()) {
      continue;
    }

    try {
      events.push(JSON.parse(line));
    } catch (error) {
      errors.push({
        lineNumber: index + 1,
        reason: error?.message ?? String(error),
      });
    }
  }

  return { events, errors };
}

export function summarizeLlmLedgerFingerprints(ledger) {
  const events = Array.isArray(ledger?.events) ? ledger.events : Array.isArray(ledger) ? ledger : [];
  const candidateIds = new Set();
  const fingerprints = new Set();

  for (const event of events) {
    if (event?.candidateId) {
      candidateIds.add(event.candidateId);
    }

    if (event?.candidateFingerprint) {
      fingerprints.add(event.candidateFingerprint);
    }
  }

  return { candidateIds, fingerprints };
}
