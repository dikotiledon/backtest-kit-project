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
    const raw = `${'😀'.repeat(6000)}{"params":{"unknownParam":999}}`;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => ({
        ok: true,
        raw,
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
    const invalidResponsesPath = path.join(
      dir,
      'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl',
    );
    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(invalidRows.length, 1);
    assert.equal(invalidRows[0].attempt, 1);
    assert.equal(invalidRows[0].maxAttempts, 1);
    assert.equal(invalidRows[0].reason, 'candidate_invalid');
    assert.match(invalidRows[0].error, /Invalid JSON|unknownParam/);
    assert.equal(invalidRows[0].providerMode, 'openai-responses');
    assert.equal(invalidRows[0].source, 'openai-responses');
    assert.equal(invalidRows[0].rawLength, Buffer.byteLength(raw, 'utf8'));
    assert.match(invalidRows[0].rawSha256, /^[a-f0-9]{64}$/);
    assert.equal(Buffer.byteLength(invalidRows[0].rawPreview, 'utf8') <= 16 * 1024, true);
    assert.equal(invalidRows[0].rawPreview.includes('\uFFFD'), false);

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.details.invalidAttempts.length, 1);
    assert.equal(status.details.invalidAttempts[0].attempt, 1);
    assert.equal(status.details.invalidAttempts[0].maxAttempts, 1);
    assert.equal(status.details.invalidAttempts[0].rawPreviewPath.endsWith('llm-invalid-responses.jsonl'), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai malformed candidate retries once and succeeds with feedback prompt', async () => {
  const { dir, configPath } = await openAiFixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');
  const invalidResponsesPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl');

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 2 },
    }), 'utf8');

    const prompts = [];
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async (options) => {
        prompts.push(options.prompt);
        if (prompts.length === 1) {
          return { ok: true, raw: '{}', source: 'openai-responses' };
        }
        return {
          ok: true,
          raw: '{"params":{"minPredSum":1.8},"rationale":"retry candidate"}',
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'retry-run', promotable: true, metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.equal(executeCalled, true);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[0], /Previous candidate output was invalid/);
    assert.match(prompts[1], /Previous candidate output was invalid/);
    assert.match(prompts[1], /Attempt 2 of 2/);
    assert.match(prompts[1], /Return exactly one JSON object/);

    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(invalidRows.length, 1);
    assert.equal(invalidRows[0].rawPreview, '{}');
    assert.equal(invalidRows[0].attempt, 1);
    assert.equal(invalidRows[0].maxAttempts, 2);

    const reviewItems = (await readReviewQueue(reviewQueuePath)).items;
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].candidate.params.minPredSum, 1.8);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('openai malformed candidate stops after configured attempts', async () => {
  const { dir, configPath } = await openAiFixture();
  const invalidResponsesPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl');

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 3 },
    }), 'utf8');

    let calls = 0;
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return { ok: true, raw: '{}', source: 'openai-responses' };
      },
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'must-not-run' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_invalid');
    assert.equal(calls, 3);
    assert.equal(executeCalled, false);

    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(invalidRows.map((row) => row.attempt), [1, 2, 3]);
    assert.deepEqual(invalidRows.map((row) => row.maxAttempts), [3, 3, 3]);

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'candidate_invalid');
    assert.equal(status.details.invalidAttempts.length, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai low-quality candidate re-asks once and executes improved candidate', async () => {
  const { dir, configPath, allowlistPath } = await openAiFixture();

  try {
    await fs.writeFile(allowlistPath, JSON.stringify({
      version: 1,
      freezeArchitecture: true,
      maxChangedParams: 3,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
        { key: 'riskRewardRatio', type: 'float', min: 0.5, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
        { key: 'stopLossPct', type: 'float', min: 0.1, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
        { key: 'divRsiLen', type: 'int', min: 2, max: 100, step: 1, mutability: 'tunable', family: 'signal' },
      ],
    }), 'utf8');

    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        maxCandidateAttempts: 1,
        maxQualityAttempts: 2,
      },
      champion: {
        minPredSum: 1.7,
        riskRewardRatio: 2.0,
        stopLossPct: 0.6,
        divRsiLen: 14,
      },
      quality: {
        enabled: true,
        minScore: 70,
      },
      candidate: { maxChangedParams: 3 },
    }), 'utf8');

    const prompts = [];
    let executedCandidate = null;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async (options) => {
        prompts.push(options.prompt);
        if (prompts.length === 1) {
          return {
            ok: true,
            raw: JSON.stringify({
              params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
              rationale: 'test',
            }),
            source: 'openai-responses',
          };
        }
        return {
          ok: true,
          raw: JSON.stringify({
            params: { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 },
            rationale: 'Champion baseline minPredSum 1.7 and riskRewardRatio 2.0 underperform ROI/trade count in matrix primary vs shadow, so raise divRsiLen to 18 while keeping threshold near baseline to improve quality.',
          }),
          source: 'openai-responses',
        };
      },
      executeCandidate: async ({ candidate }) => {
        executedCandidate = candidate;
        return { ok: true, runId: 'quality-reask', promotable: false, metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 2);
    assert.notEqual(prompts[1], prompts[0]);
    assert.match(prompts[1], /Quality score:/);
    assert.match(prompts[1], /Flags:/);
    assert.deepEqual(executedCandidate.params, { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai low-quality candidate stops after configured quality attempts', async () => {
  const { dir, configPath, allowlistPath } = await openAiFixture();

  try {
    await fs.writeFile(allowlistPath, JSON.stringify({
      version: 1,
      freezeArchitecture: true,
      maxChangedParams: 3,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
        { key: 'riskRewardRatio', type: 'float', min: 0.5, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
        { key: 'stopLossPct', type: 'float', min: 0.1, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
      ],
    }), 'utf8');

    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        maxCandidateAttempts: 1,
        maxQualityAttempts: 2,
      },
      champion: {
        minPredSum: 1.7,
        riskRewardRatio: 2.0,
        stopLossPct: 0.6,
      },
      quality: {
        enabled: true,
        minScore: 70,
      },
      candidate: { maxChangedParams: 3 },
    }), 'utf8');

    let calls = 0;
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return {
          ok: true,
          raw: JSON.stringify({
            params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
            rationale: 'test',
          }),
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'must-not-run' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_low_quality');
    assert.equal(calls, 2);
    assert.equal(executeCalled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai quality re-ask provider failure does not execute stale candidate', async () => {
  const { dir, configPath, allowlistPath } = await openAiFixture();

  try {
    await fs.writeFile(allowlistPath, JSON.stringify({
      version: 1,
      freezeArchitecture: true,
      maxChangedParams: 3,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
        { key: 'riskRewardRatio', type: 'float', min: 0.5, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
        { key: 'stopLossPct', type: 'float', min: 0.1, max: 10, step: 0.1, mutability: 'tunable', family: 'risk' },
      ],
    }), 'utf8');

    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        maxCandidateAttempts: 1,
        maxQualityAttempts: 2,
      },
      champion: {
        minPredSum: 1.7,
        riskRewardRatio: 2.0,
        stopLossPct: 0.6,
      },
      quality: {
        enabled: true,
        minScore: 70,
      },
      candidate: { maxChangedParams: 3 },
    }), 'utf8');

    let calls = 0;
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            raw: JSON.stringify({
              params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
              rationale: 'test',
            }),
            source: 'openai-responses',
          };
        }

        return {
          ok: false,
          reason: 'missing_api_key_env:OPENAI_API_KEY',
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'must-not-run' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing_api_key_env:OPENAI_API_KEY');
    assert.equal(calls, 2);
    assert.equal(executeCalled, false);

    const ledger = await readLlmLedger(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-ledger.jsonl'));
    assert.equal(ledger.events.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('openai transient provider failure retries before candidate validation', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        maxProviderAttempts: 2,
        providerRetryDelayMs: 0,
      },
      quality: { ...baseConfig.quality, enabled: false },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            reason: 'proposal_failed',
            error: 'HTTP 502 Bad Gateway',
            source: 'openai-responses',
          };
        }

        return {
          ok: true,
          raw: JSON.stringify({
            params: { minPredSum: 1.8 },
            rationale: 'recovered provider call',
          }),
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => ({ ok: true, runId: 'provider-retry-success' }),
    });

    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai auth provider failure does not retry', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        maxProviderAttempts: 3,
        providerRetryDelayMs: 0,
      },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return {
          ok: false,
          reason: 'proposal_failed',
          error: '401 Unauthorized invalid API key',
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => ({ ok: true, runId: 'must-not-run' }),
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai provider failure is not retried as candidate invalid', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 3 },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return { ok: false, reason: 'missing_api_key_env:OPENAI_API_KEY', stderr: 'missing key' };
      },
      executeCandidate: async () => ({ ok: true, runId: 'must-not-run' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing_api_key_env:OPENAI_API_KEY');
    assert.equal(calls, 1);
    await assert.rejects(
      () => fs.access(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl')),
      /ENOENT/,
    );
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
