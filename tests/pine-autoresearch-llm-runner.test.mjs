import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runLlmAutoresearch } from '../scripts/lib/pine-autoresearch-llm-runner.mjs';
import { readLlmLedger } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';
import { appendReviewQueueEvent, buildReviewQueueItem, readReviewQueue } from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

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

async function openAiFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-runner-openai-'));
  const configPath = path.join(dir, 'llm.json');
  const allowlistPath = path.join(dir, 'allowlist.json');

  await fs.writeFile(allowlistPath, JSON.stringify({
    version: 1,
    freezeArchitecture: true,
    maxChangedParams: 1,
    parameters: [
      { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
    ],
  }), 'utf8');

  await fs.writeFile(configPath, JSON.stringify({
    matrixId: 'matrix-a',
    allowlistPath,
    provider: { mode: 'openai-responses', model: 'gpt-test' },
    champion: { minPredSum: 1.7 },
    memory: {
      maxPromptBytes: 4096,
      maxHotMemoryBytes: 262144,
      recentCandidates: 20,
      topWinners: 10,
      tabuFingerprints: 50,
    },
    candidate: { maxChangedParams: 1 },
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


test('scheduled disabled provider soft-succeeds even with pending review blockers', async () => {
  const { dir, configPath } = await fixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await seedReviewBlocker(reviewQueuePath, 'pending_review');

    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'proposal_unavailable');

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'proposal_unavailable');
    assert.equal(status.details.reviewSummary.hasBlockers, true);
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

test('executor exception finalizes reservation as failed', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  const ledgerPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-ledger.jsonl');
  const activeReservationsPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-active-reservations.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      patch: { minPredSum: 1.8 },
      rationale: 'raise threshold',
    }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7 },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => {
        throw new Error('matrix exploded');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'execution_exception');

    const ledger = await readLlmLedger(ledgerPath);
    assert.deepEqual(ledger.events.map((event) => event.type), ['reserved', 'failed']);
    assert.deepEqual(JSON.parse(await fs.readFile(activeReservationsPath, 'utf8')), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('review-status returns actionable unresolved review item details', async () => {
  const { dir, configPath } = await fixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await appendReviewQueueEvent(reviewQueuePath, {
      item: buildReviewQueueItem({
        parentChampionFingerprint: 'champ',
        candidateFingerprint: 'cand',
        candidateId: 'item-a',
        runId: 'eval-run',
        manifestPath: path.join(dir, 'llm-manifest.json'),
        evaluationManifestPath: path.join(dir, 'eval-manifest.json'),
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
    });

    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'review-status' });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'review_status');
    assert.equal(result.reviewSummary.unresolvedCount, 1);
    assert.equal(result.reviewSummary.unresolvedItems[0].itemId, 'item-a');
    assert.equal(result.reviewSummary.unresolvedItems[0].runId, 'eval-run');
    assert.match(result.reviewSummary.unresolvedItems[0].evaluationManifestPath, /eval-manifest\.json$/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('review-resolve appends status event and clears blockers', async () => {
  const { dir, configPath } = await fixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await appendReviewQueueEvent(reviewQueuePath, {
      item: buildReviewQueueItem({
        parentChampionFingerprint: 'champ',
        candidateFingerprint: 'cand',
        candidateId: 'item-a',
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
    });

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'review-resolve',
      configOverrides: {
        reviewResolve: { itemId: 'item-a', status: 'archived', reason: 'done' },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'review_resolved');
    assert.equal(result.reviewSummary.unresolvedCount, 0);

    const queue = await readReviewQueue(reviewQueuePath);
    assert.equal(queue.items[0].status, 'archived');
    assert.equal(queue.items[0].reason, 'done');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('review-resolve rejects invalid status without clearing blocker', async () => {
  const { dir, configPath } = await fixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');

  try {
    await appendReviewQueueEvent(reviewQueuePath, {
      item: buildReviewQueueItem({
        parentChampionFingerprint: 'champ',
        candidateFingerprint: 'cand',
        candidateId: 'item-a',
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
    });

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'review-resolve',
      configOverrides: {
        reviewResolve: { itemId: 'item-a', status: 'typo_status', reason: 'bad' },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'review_resolve_invalid_status');
    assert.equal(result.reviewSummary.unresolvedCount, 1);

    const queue = await readReviewQueue(reviewQueuePath);
    assert.equal(queue.items[0].status, 'pending_review');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('stateRoot relocates LLM lane state', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const stateRoot = path.join(dir, 'custom-state');

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      stateRoot,
      provider: { mode: 'disabled' },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'review-status' });

    assert.equal(result.ok, true);
    await fs.access(path.join(stateRoot, 'llm-matrix-a/state/llm-provider-status.json'));
    await assert.rejects(fs.access(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json')), /ENOENT/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner writes LLM manifest separately from executor evaluation manifest', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  const evaluationManifestPath = path.join(dir, 'evaluation-manifest.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      patch: { minPredSum: 1.8 },
      rationale: 'raise threshold',
    }), 'utf8');
    await fs.writeFile(evaluationManifestPath, JSON.stringify({
      lane: 'llm-evaluator-bridge',
      matrixDecision: { recommendation: 'promote' },
    }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7 },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => ({
        ok: true,
        runId: 'eval-run-a',
        evaluationManifestPath,
        metricsDelta: { recommendation: 'promote', aggregateScoreDelta: 1 },
        promotable: true,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.notEqual(result.manifestPath, evaluationManifestPath);
    assert.equal(result.evaluationManifestPath, evaluationManifestPath);

    const evaluationManifest = JSON.parse(await fs.readFile(evaluationManifestPath, 'utf8'));
    assert.equal(evaluationManifest.lane, 'llm-evaluator-bridge');

    const llmManifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(llmManifest.lane, 'llm');
    assert.equal(llmManifest.evaluationManifestPath, evaluationManifestPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('runner uses injected executor before production matrix executor', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      patch: { minPredSum: 1.8 },
      rationale: 'raise threshold',
    }), 'utf8');

    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      execution: { mode: 'matrix-eval' },
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

    let injectedCalled = false;
    let productionCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async (options) => {
        injectedCalled = true;
        assert.equal(options.repoRoot, dir);
        return {
          ok: true,
          runId: 'injected-run',
          manifestPath: path.join(dir, 'manifest.json'),
          metricsDelta: { score: 1 },
          promotable: false,
        };
      },
      productionExecuteCandidate: async () => {
        productionCalled = true;
        return { ok: true, runId: 'production-run' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.runId, 'injected-run');
    assert.equal(injectedCalled, true);
    assert.equal(productionCalled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner uses production executor when execution mode is matrix-eval', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      patch: { minPredSum: 1.8 },
      rationale: 'raise threshold',
    }), 'utf8');

    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      execution: { mode: 'matrix-eval' },
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

    let productionCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      productionExecuteCandidate: async (options) => {
        productionCalled = true;
        assert.equal(options.repoRoot, dir);
        return {
          ok: true,
          runId: 'production-run',
          manifestPath: path.join(dir, 'manifest.json'),
          metricsDelta: { score: 1 },
          promotable: false,
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.runId, 'production-run');
    assert.equal(productionCalled, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai responses provider flow stays no-network and enqueues review', async () => {
  const { dir, configPath } = await openAiFixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');
  const ledgerPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-ledger.jsonl');

  try {
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async (options) => {
        assert.equal(options.mode, 'openai-responses');
        assert.equal(options.provider.model, 'gpt-test');
        assert.match(options.prompt, /minPredSum/i);
        return {
          ok: true,
          raw: '{"params":{"minPredSum":1.8},"rationale":"API candidate"}',
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => {
        const ledger = await readLlmLedger(ledgerPath);
        assert.deepEqual(ledger.events.map((event) => event.type), ['reserved']);
        return { ok: true, runId: 'run-a', promotable: true, metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.equal(result.manifestPath !== null, true);
    await fs.stat(result.manifestPath);

    const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(manifest.provider.mode, 'openai-responses');
    assert.equal(manifest.candidate.params.minPredSum, 1.8);

    const reviewItems = (await readReviewQueue(reviewQueuePath)).items;
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].status, 'pending_review');
    assert.equal(reviewItems[0].candidate.params.minPredSum, 1.8);

    const ledger = await readLlmLedger(ledgerPath);
    assert.deepEqual(ledger.events.map((event) => event.type), ['reserved', 'completed']);

    await assert.rejects(
      () => fs.stat(path.join(dir, 'pine/autoresearch/matrix-a/state/promotion-queue.jsonl')),
      /ENOENT/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai malformed text is rejected by local validation', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => ({
        ok: true,
        raw: 'Here is a candidate:\n{"params":{"unknownParam":999}}',
        source: 'openai-responses',
      }),
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'run-b', promotable: true, metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_invalid');
    assert.equal(executeCalled, false);
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
