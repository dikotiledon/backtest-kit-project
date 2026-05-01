import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  appendLlmLedgerEvent,
  readLlmLedger,
  summarizeLlmLedgerFingerprints,
} from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-llm-ledger-'));
}

test('appendLlmLedgerEvent appends JSONL and readLlmLedger returns events', async () => {
  const dir = await tempDir();
  const ledgerPath = path.join(dir, 'state', 'llm-ledger.jsonl');

  try {
    await appendLlmLedgerEvent(ledgerPath, { type: 'reserved', candidateId: 'champ:cand', candidateFingerprint: 'fp1' });
    await appendLlmLedgerEvent(ledgerPath, { type: 'completed', candidateId: 'champ:cand', candidateFingerprint: 'fp1' });

    const ledger = await readLlmLedger(ledgerPath);
    assert.equal(ledger.errors.length, 0);
    assert.equal(ledger.events.length, 2);
    assert.equal(ledger.events[0].type, 'reserved');
    assert.equal(ledger.events[1].type, 'completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readLlmLedger skips malformed lines with line numbers', async () => {
  const dir = await tempDir();
  const ledgerPath = path.join(dir, 'llm-ledger.jsonl');

  try {
    await writeFile(ledgerPath, '{bad json}\n{"type":"reserved"}\n', 'utf8');

    const ledger = await readLlmLedger(ledgerPath);
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.errors.length, 1);
    assert.equal(ledger.errors[0].lineNumber, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('summarizeLlmLedgerFingerprints collects candidate ids and fingerprints', () => {
  const summary = summarizeLlmLedgerFingerprints({
    events: [
      { candidateId: 'champ:a', candidateFingerprint: 'fp-a' },
      { candidateId: 'champ:b', candidateFingerprint: 'fp-b' },
      { candidateId: 'champ:a', candidateFingerprint: 'fp-a' },
    ],
  });

  assert.deepEqual([...summary.candidateIds].sort(), ['champ:a', 'champ:b']);
  assert.deepEqual([...summary.fingerprints].sort(), ['fp-a', 'fp-b']);
});
