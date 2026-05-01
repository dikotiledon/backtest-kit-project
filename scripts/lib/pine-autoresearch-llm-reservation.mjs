import fs from 'node:fs/promises';
import path from 'node:path';

import { appendLlmLedgerEvent, readLlmLedger, summarizeLlmLedgerFingerprints } from './pine-autoresearch-llm-ledger.mjs';

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

function resolvePaths(paths = {}) {
  const ledgerPath = paths.ledgerPath ?? paths.ledger;
  if (!ledgerPath) {
    throw new Error('ledgerPath required');
  }

  const activeReservationsPath = paths.activeReservationsPath ?? path.join(path.dirname(ledgerPath), 'llm-active-reservations.json');
  return { ledgerPath, activeReservationsPath };
}

async function writeActiveReservations(activeReservationsPath, reservations) {
  await fs.mkdir(path.dirname(activeReservationsPath), { recursive: true });
  await fs.writeFile(activeReservationsPath, `${JSON.stringify(reservations, null, 2)}\n`, 'utf8');
}

export async function readActiveReservations(activeReservationsPath) {
  try {
    const raw = await fs.readFile(activeReservationsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (isMissingError(error) || error instanceof SyntaxError) {
      return [];
    }

    throw error;
  }
}

function isDuplicateCandidate({ activeReservations, ledgerSummary }, candidate) {
  const candidateId = candidate?.candidateId ?? null;
  const candidateFingerprint = candidate?.candidateFingerprint ?? null;

  for (const reservation of activeReservations) {
    if (candidateId && reservation?.candidateId === candidateId) {
      return true;
    }

    if (candidateFingerprint && reservation?.candidateFingerprint === candidateFingerprint) {
      return true;
    }
  }

  if (candidateId && ledgerSummary.candidateIds.has(candidateId)) {
    return true;
  }

  if (candidateFingerprint && ledgerSummary.fingerprints.has(candidateFingerprint)) {
    return true;
  }

  return false;
}

export async function reserveCandidate(paths, candidate) {
  const { ledgerPath, activeReservationsPath } = resolvePaths(paths);
  const activeReservations = await readActiveReservations(activeReservationsPath);
  const ledger = await readLlmLedger(ledgerPath);
  const ledgerSummary = summarizeLlmLedgerFingerprints(ledger);

  if (isDuplicateCandidate({ activeReservations, ledgerSummary }, candidate)) {
    return { reserved: false, reason: 'duplicate_candidate' };
  }

  const reservedEvent = await appendLlmLedgerEvent(ledgerPath, {
    type: 'reserved',
    candidateId: candidate?.candidateId,
    candidateFingerprint: candidate?.candidateFingerprint,
    parentChampionFingerprint: candidate?.parentChampionFingerprint ?? null,
    at: toIso(candidate?.at),
  });

  const reservation = {
    candidateId: candidate?.candidateId ?? null,
    candidateFingerprint: candidate?.candidateFingerprint ?? null,
    parentChampionFingerprint: candidate?.parentChampionFingerprint ?? null,
    reservedAt: reservedEvent.at,
  };

  await writeActiveReservations(activeReservationsPath, [...activeReservations, reservation]);
  return { reserved: true };
}

export async function finalizeReservation(paths, event) {
  const { ledgerPath, activeReservationsPath } = resolvePaths(paths);
  const record = await appendLlmLedgerEvent(ledgerPath, event);
  const activeReservations = await readActiveReservations(activeReservationsPath);
  const next = activeReservations.filter((reservation) => {
    if (event?.candidateId && reservation?.candidateId === event.candidateId) {
      return false;
    }

    if (event?.candidateFingerprint && reservation?.candidateFingerprint === event.candidateFingerprint) {
      return false;
    }

    return true;
  });

  await writeActiveReservations(activeReservationsPath, next);
  return record;
}
