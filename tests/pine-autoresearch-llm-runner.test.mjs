import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runLlmAutoresearch } from '../scripts/lib/pine-autoresearch-llm-runner.mjs';
import { readLlmLedger } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';
import { appendReviewQueueEvent, buildReviewQueueItem } from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-runner-'));
  const configPath = path.join(dir, 'llm.json');
  const allowlistPath = path.join(dir, 'allowlist.json');

  await fs.writeFile(allowlistPath, JSON.stringify({
    version: 1,
    freezeArchitecture: true,
    maxChangedParams: 2,
    parameters: [
      { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
      { key: 'useFusionV4', type: 'bool', mutability: 'forbidden', family: 'architecture' },
    ],
  }), 'utf8');

  await fs.writeFile(configPath, JSON.stringify({
    matrixId: 'matrix-a',
    allowlistPath,
    provider: { mode: 'disabled' },
    memory: {
      maxPromptBytes: 4096,
      maxHotMemoryBytes: 262144,
      recentCandidates: 20,
      topWinners: 10,
      tabuFingerprints: 50,
    },
    candidate: { maxChangedParams: 2 },
  }), 'utf8');

  return { dir, configPath, allowlistPath };
}

test('scheduled disabled provider exits soft-success and writes provider status', async () => {
  const { dir, configPath } = await fixture();

  try {
    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'proposal_unavailable');

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'proposal_unavailable');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('scheduled openclaw provider is hard rejected', async () => {
  const { dir, configPath, allowlistPath } = await fixture();

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'openclaw' },
      memory: { maxPromptBytes: 4096 },
    }), 'utf8');

    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'openclaw_rejected_in_scheduled_mode');

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'openclaw_rejected_in_scheduled_mode');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('scheduled openclaw rejects even with pending review blockers', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'openclaw' },
      memory: { maxPromptBytes: 4096 },
    }), 'utf8');

    await seedReviewBlocker(reviewQueuePath, 'pending_review');

    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'openclaw_rejected_in_scheduled_mode');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function seedReviewBlocker(queuePath, status = 'pending_review') {
  const item = buildReviewQueueItem({
    parentChampionFingerprint: 'champ',
    candidateFingerprint: 'cand',
    createdAt: '2026-05-01T00:00:00.000Z',
  });

  await appendReviewQueueEvent(queuePath, item);

  if (status !== 'pending_review') {
    await appendReviewQueueEvent(queuePath, {
      type: 'status',
      itemId: item.itemId,
      status,
      at: '2026-05-01T00:30:00.000Z',
    });
  }
}

test('pending review blocks non-scheduled file provider before execution', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      hypothesis: 'raise threshold',
      patch: { minPredSum: 1.8 },
      expectedEffect: 'fewer trades',
      risk: 'count',
    }), 'utf8');

    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7, useFusionV4: true },
      memory: {
        maxPromptBytes: 4096,
        maxHotMemoryBytes: 262144,
        recentCandidates: 20,
        topWinners: 10,
        tabuFingerprints: 50,
      },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    await seedReviewBlocker(reviewQueuePath, 'pending_review');

    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'run-a', manifestPath: path.join(dir, 'manifest.json'), metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'pending_review_block');
    assert.equal(executeCalled, false);

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'pending_review_block');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('accepted_for_manual_promotion also blocks proposal paths', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      hypothesis: 'raise threshold',
      patch: { minPredSum: 1.8 },
      expectedEffect: 'fewer trades',
      risk: 'count',
    }), 'utf8');

    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7, useFusionV4: true },
      memory: {
        maxPromptBytes: 4096,
        maxHotMemoryBytes: 262144,
        recentCandidates: 20,
        topWinners: 10,
        tabuFingerprints: 50,
      },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    await seedReviewBlocker(reviewQueuePath, 'accepted_for_manual_promotion');

    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'run-a', manifestPath: path.join(dir, 'manifest.json'), metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'pending_review_block');
    assert.equal(executeCalled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('file provider validates, reserves before execution, and finalizes one candidate', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      hypothesis: 'raise threshold',
      patch: { minPredSum: 1.8 },
      expectedEffect: 'fewer trades',
      risk: 'count',
    }), 'utf8');

    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7, useFusionV4: true },
      memory: {
        maxPromptBytes: 4096,
        maxHotMemoryBytes: 262144,
        recentCandidates: 20,
        topWinners: 10,
        tabuFingerprints: 50,
      },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const ledgerPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-ledger.jsonl');
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => {
        const ledger = await readLlmLedger(ledgerPath);
        assert.deepEqual(ledger.events.map((event) => event.type), ['reserved']);
        return {
          ok: true,
          runId: 'run-a',
          manifestPath: path.join(dir, 'manifest.json'),
          metricsDelta: { score: 1 },
        };
      },
    });

    assert.equal(result.ok, true);

    const ledger = await readLlmLedger(ledgerPath);
    assert.deepEqual(ledger.events.map((event) => event.type), ['reserved', 'completed']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner never writes existing promotion queue', async () => {
  const { dir, configPath } = await fixture();

  try {
    await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });
    await assert.rejects(
      () => fs.stat(path.join(dir, 'pine/autoresearch/matrix-a/state/promotion-queue.jsonl')),
      /ENOENT/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
