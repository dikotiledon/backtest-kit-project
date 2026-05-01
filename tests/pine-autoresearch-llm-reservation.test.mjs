import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  finalizeReservation,
  readActiveReservations,
  reserveCandidate,
} from '../scripts/lib/pine-autoresearch-llm-reservation.mjs';
import { readLlmLedger } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-llm-reservation-'));
}

test('readActiveReservations returns empty array for missing file', async () => {
  const dir = await tempDir();
  const activeReservationsPath = path.join(dir, 'missing', 'llm-active-reservations.json');

  try {
    assert.deepEqual(await readActiveReservations(activeReservationsPath), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readActiveReservations returns empty array for malformed or non-array file', async () => {
  const dir = await tempDir();
  const malformedPath = path.join(dir, 'malformed.json');
  const nonArrayPath = path.join(dir, 'non-array.json');

  try {
    await writeFile(malformedPath, '{not json}', 'utf8');
    await writeFile(nonArrayPath, '{"ok":true}', 'utf8');

    assert.deepEqual(await readActiveReservations(malformedPath), []);
    assert.deepEqual(await readActiveReservations(nonArrayPath), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reserveCandidate writes reserved before execution and blocks duplicates', async () => {
  const dir = await tempDir();
  const ledgerPath = path.join(dir, 'state', 'llm-ledger.jsonl');
  const activeReservationsPath = path.join(dir, 'state', 'llm-active-reservations.json');

  try {
    const first = await reserveCandidate({ ledgerPath, activeReservationsPath }, {
      candidateId: 'champ:cand',
      candidateFingerprint: 'fp1',
    });
    const second = await reserveCandidate({ ledgerPath, activeReservationsPath }, {
      candidateId: 'champ:cand',
      candidateFingerprint: 'fp1',
    });

    assert.deepEqual(first, { reserved: true });
    assert.deepEqual(second, { reserved: false, reason: 'duplicate_candidate' });

    const ledger = await readLlmLedger(ledgerPath);
    assert.equal(ledger.events[0].type, 'reserved');
    assert.equal(ledger.events[0].candidateId, 'champ:cand');
    assert.equal((await readActiveReservations(activeReservationsPath)).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('finalizeReservation appends final event and clears active reservation', async () => {
  const dir = await tempDir();
  const ledgerPath = path.join(dir, 'state', 'llm-ledger.jsonl');
  const activeReservationsPath = path.join(dir, 'state', 'llm-active-reservations.json');

  try {
    await reserveCandidate({ ledgerPath, activeReservationsPath }, {
      candidateId: 'champ:cand',
      candidateFingerprint: 'fp1',
    });

    await finalizeReservation({ ledgerPath, activeReservationsPath }, {
      type: 'completed',
      candidateId: 'champ:cand',
      candidateFingerprint: 'fp1',
      at: '2026-05-01T02:00:00.000Z',
    });

    const ledger = await readLlmLedger(ledgerPath);
    assert.equal(ledger.events.at(-1).type, 'completed');
    assert.equal((await readActiveReservations(activeReservationsPath)).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
