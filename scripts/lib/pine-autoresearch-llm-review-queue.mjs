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

function normalizeStatus(status) {
  return typeof status === 'string' && status ? status : 'pending_review';
}

function buildItemFromInput(input = {}, at) {
  const parentChampionFingerprint = input.parentChampionFingerprint ?? input.parentChampionId ?? null;
  const candidateFingerprint = input.candidateFingerprint ?? null;
  const itemId = input.candidateId ?? (parentChampionFingerprint && candidateFingerprint ? `${parentChampionFingerprint}:${candidateFingerprint}` : null);

  if (!itemId) {
    throw new Error('Cannot build review queue item without candidateId');
  }

  return {
    ...input,
    itemId,
    candidateId: input.candidateId ?? itemId,
    parentChampionFingerprint,
    candidateFingerprint,
    status: 'pending_review',
    statusAt: at ?? input.statusAt ?? input.createdAt ?? null,
    reason: input.reason ?? null,
    createdAt: input.createdAt ?? at ?? null,
  };
}

function applyStatus(item, event) {
  return {
    ...item,
    status: normalizeStatus(event?.status),
    statusAt: event?.at ?? item.statusAt ?? item.createdAt ?? null,
    reason: event?.reason ?? null,
  };
}

export function buildReviewQueueItem(input) {
  return buildItemFromInput(input, input?.createdAt ?? null);
}

export async function appendReviewQueueEvent(queuePathValue, event) {
  await fs.mkdir(path.dirname(queuePathValue), { recursive: true });

  const record = {
    ...event,
    at: toIso(event?.at),
  };

  await fs.appendFile(queuePathValue, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readReviewQueue(queuePathValue) {
  let raw = '';

  try {
    raw = await fs.readFile(queuePathValue, 'utf8');
  } catch (error) {
    if (isMissingError(error)) {
      return { events: [], items: [], errors: [] };
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

  for (const event of events) {
    if (event?.item && event.item.itemId) {
      const item = buildItemFromInput(event.item, event.at);
      itemsById.set(item.itemId, {
        ...itemsById.get(item.itemId),
        ...item,
        status: normalizeStatus(item.status),
      });
      continue;
    }

    if (event?.type === 'status' && event.itemId) {
      const current = itemsById.get(event.itemId) ?? { itemId: event.itemId, candidateId: event.itemId };
      itemsById.set(event.itemId, applyStatus(current, event));
      continue;
    }

    if (event?.itemId && event?.status) {
      const current = itemsById.get(event.itemId) ?? { itemId: event.itemId, candidateId: event.itemId };
      itemsById.set(event.itemId, applyStatus(current, event));
    }
  }

  const items = [...itemsById.values()].sort((left, right) => {
    const createdAtOrder = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return String(left.itemId).localeCompare(String(right.itemId));
  });

  return { events, items, errors };
}

export function unresolvedReviewItems(queue) {
  const items = Array.isArray(queue?.items) ? queue.items : [];
  return items.filter((item) => {
    const status = normalizeStatus(item?.status);
    return status === 'pending_review' || status === 'accepted_for_manual_promotion';
  });
}

export async function resolveReviewItem(queuePathValue, input) {
  return appendReviewQueueEvent(queuePathValue, {
    type: 'status',
    itemId: input?.itemId,
    status: input?.status,
    reason: input?.reason ?? null,
    at: input?.at,
  });
}

export async function markStaleReviewItems(queuePathValue, { currentChampionFingerprint, at } = {}) {
  const queue = await readReviewQueue(queuePathValue);
  const unresolved = unresolvedReviewItems(queue);
  const marked = [];

  for (const item of unresolved) {
    if (item?.parentChampionFingerprint && item.parentChampionFingerprint === currentChampionFingerprint) {
      continue;
    }

    marked.push(item.itemId);
    await appendReviewQueueEvent(queuePathValue, {
      type: 'status',
      itemId: item.itemId,
      status: 'stale',
      reason: 'parent_champion_changed',
      at,
    });
  }

  return marked;
}
