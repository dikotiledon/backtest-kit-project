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

function normalizePendingItem(item, at) {
  return {
    ...item,
    status: item.status ?? 'pending',
    statusAt: item.statusAt ?? at ?? item.createdAt ?? null,
    reason: item.reason ?? null,
    appliedConfigId: item.appliedConfigId ?? null,
  };
}

function cloneJsonValue(value) {
  if (value == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

export function promotionQueuePath({ researchRoot }) {
  return path.join(researchRoot, 'state', 'promotion-queue.jsonl');
}

export function buildPromotionQueueItem({ manifest, createdAt } = {}) {
  const runId = manifest?.runId;
  const candidateFingerprint = manifest?.candidateFingerprint;

  if (!runId) {
    throw new Error('Cannot queue promotion without manifest.runId');
  }

  if (!candidateFingerprint) {
    throw new Error('Cannot queue promotion without manifest.candidateFingerprint');
  }

  if (manifest?.matrixDecision?.recommendation !== 'promote') {
    throw new Error(`Cannot queue non-promote manifest ${runId}`);
  }

  return {
    itemId: `${runId}:${candidateFingerprint}`,
    runId,
    manifestPath: manifest.manifestPath,
    candidateFingerprint,
    championFingerprintAtDecision: manifest.championFingerprint ?? null,
    candidateFamilyKey: manifest.candidateFamilyKey ?? null,
    championFamilyKeyAtDecision: manifest.championFamilyKey ?? null,
    robustness: cloneJsonValue(manifest.robustness),
    candidateConfigId: manifest.challenger?.configId ?? null,
    championConfigIdAtDecision: manifest.champion?.configId ?? null,
    createdAt: toIso(createdAt ?? manifest.generatedAt),
  };
}

export async function appendPromotionQueueEvent(queuePath, event) {
  await fs.mkdir(path.dirname(queuePath), { recursive: true });

  const record = {
    ...event,
    at: toIso(event?.at),
  };

  await fs.appendFile(queuePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readPromotionQueue(queuePath) {
  let raw = '';

  try {
    raw = await fs.readFile(queuePath, 'utf8');
  } catch (error) {
    if (isMissingError(error)) {
      return { events: [], items: [], pending: [], errors: [], orphanStatuses: [] };
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

  const itemsById = new Map();
  const orphanStatuses = [];

  for (const event of events) {
    if (event?.type === 'pending' && event.item?.itemId) {
      if (!itemsById.has(event.item.itemId)) {
        itemsById.set(event.item.itemId, normalizePendingItem(event.item, event.at));
      }
      continue;
    }

    if (event?.type === 'status' && event.itemId) {
      if (itemsById.has(event.itemId)) {
        const current = itemsById.get(event.itemId);
        itemsById.set(event.itemId, {
          ...current,
          status: event.status ?? current.status,
          statusAt: event.at ?? current.statusAt ?? null,
          reason: event.reason ?? null,
          appliedConfigId: event.appliedConfigId ?? current.appliedConfigId ?? null,
        });
      } else {
        orphanStatuses.push({
          itemId: event.itemId,
          status: event.status ?? null,
          reason: event.reason ?? null,
          appliedConfigId: event.appliedConfigId ?? null,
          at: event.at ?? null,
        });
      }
    }
  }

  const items = [...itemsById.values()].sort((left, right) => {
    const createdAtOrder = String(left.createdAt).localeCompare(String(right.createdAt));
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return String(left.itemId).localeCompare(String(right.itemId));
  });

  return {
    events,
    items,
    pending: items.filter((item) => item.status === 'pending'),
    errors,
    orphanStatuses,
  };
}

export function selectNextPendingPromotion(queue) {
  const pending = Array.isArray(queue?.pending) ? queue.pending : [];

  return [...pending].sort((left, right) => {
    const createdAtOrder = String(left?.createdAt).localeCompare(String(right?.createdAt));
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return String(left?.itemId).localeCompare(String(right?.itemId));
  })[0] ?? null;
}
