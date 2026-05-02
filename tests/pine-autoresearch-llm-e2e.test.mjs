import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runLlmAutoresearch } from '../scripts/lib/pine-autoresearch-llm-runner.mjs';
import { readReviewQueue } from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error?.message ? `\n${error.message}` : ''}`.trim() }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-e2e-'));
  const allowlistPath = path.join(dir, 'allowlist.json');
  const candidateFile = path.join(dir, 'candidate.json');
  const configPath = path.join(dir, 'llm.json');

  await fs.writeFile(allowlistPath, JSON.stringify({
    version: 1,
    freezeArchitecture: true,
    maxChangedParams: 1,
    parameters: [
      { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
    ],
  }), 'utf8');

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

  return { dir, configPath };
}

async function openAiFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-e2e-openai-'));
  const allowlistPath = path.join(dir, 'allowlist.json');
  const configPath = path.join(dir, 'llm.json');

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

  return { dir, configPath };
}

test('end-to-end evaluate candidate and enqueue review without promotion queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-e2e-bridge-'));
  const allowlistPath = path.join(dir, 'allowlist.json');
  const candidateFile = path.join(dir, 'candidate.json');
  const configPath = path.join(dir, 'llm.json');
  const evaluationManifestPath = path.join(dir, 'evaluation-manifest.json');

  await fs.writeFile(allowlistPath, JSON.stringify({
    version: 1,
    freezeArchitecture: true,
    maxChangedParams: 2,
    parameters: [
      { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
    ],
  }), 'utf8');

  await fs.writeFile(candidateFile, JSON.stringify({
    patch: { minPredSum: 2.2 },
    rationale: 'raise threshold',
  }), 'utf8');

  await fs.writeFile(configPath, JSON.stringify({
    matrixId: 'matrix-a',
    baseConfigPath: './config/pine-autoresearch.default.json',
    allowlistPath,
    execution: { mode: 'matrix-eval' },
    provider: { mode: 'file', candidateFile },
    champion: { minPredSum: 2 },
    memory: {
      maxPromptBytes: 4096,
      maxHotMemoryBytes: 262144,
      recentCandidates: 20,
      topWinners: 10,
      tabuFingerprints: 50,
    },
    candidate: { maxChangedParams: 2 },
  }), 'utf8');

  try {
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      productionExecuteCandidate: async (options) => {
        assert.equal(options.repoRoot, dir);
        assert.equal(options.config.execution.mode, 'matrix-eval');
        assert.equal(options.candidate.patch.minPredSum, 2.2);

        await fs.writeFile(evaluationManifestPath, JSON.stringify({
          lane: 'llm-evaluator-bridge',
          matrixDecision: { recommendation: 'promote', summary: 'fixture promote' },
          challenger: { config: { minPredSum: 2.2 } },
        }), 'utf8');

        return {
          ok: true,
          runId: 'eval-run',
          evaluationManifestPath,
          promotable: true,
          metricsDelta: { recommendation: 'promote' },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.equal(result.evaluationManifestPath, evaluationManifestPath);
    assert.match(result.manifestPath, /manifests/);
    await fs.stat(result.manifestPath);
    await fs.stat(result.evaluationManifestPath);

    const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(manifest.lane, 'llm');
    assert.equal(manifest.runId, 'eval-run');
    assert.equal(manifest.matrixId, 'matrix-a');
    assert.equal(manifest.candidateId, `${manifest.parentChampionFingerprint}:${manifest.candidateFingerprint}`);
    assert.deepEqual(manifest.metricsDelta, { recommendation: 'promote' });
    assert.equal(manifest.evaluationManifestPath, evaluationManifestPath);
    assert.equal(manifest.provider.mode, 'file');

    const evaluationManifest = JSON.parse(await fs.readFile(evaluationManifestPath, 'utf8'));
    assert.equal(evaluationManifest.lane, 'llm-evaluator-bridge');
    assert.equal(evaluationManifest.matrixDecision.recommendation, 'promote');
    assert.equal(evaluationManifest.matrixDecision.summary, 'fixture promote');
    assert.equal(evaluationManifest.challenger.config.minPredSum, 2.2);

    const queue = await readReviewQueue(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl'));
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].status, 'pending_review');
    assert.equal(queue.items[0].runId, 'eval-run');

    await assert.rejects(
      () => fs.stat(path.join(dir, 'pine/autoresearch/matrix-a/state/promotion-queue.jsonl')),
      /ENOENT/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('end-to-end openai provider rejects malformed text before execution', async () => {
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
        return { ok: true, runId: 'run-openai', promotable: true, metricsDelta: { score: 1 } };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_invalid');
    assert.equal(executeCalled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('digest command prints compact JSON summary', async () => {
  const { dir, configPath } = await fixture();

  try {
    const runResult = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => ({ ok: true, runId: 'run-a', promotable: true, metricsDelta: { score: 1 } }),
    });

    assert.equal(runResult.ok, true);

    const cli = await runNode([path.join(repoRoot, 'scripts/pine-autoresearch-llm.mjs'), 'digest', '--config', configPath, '--repo-root', dir], repoRoot);

    assert.equal(cli.code, 0, cli.stderr || cli.stdout);
    const digest = JSON.parse(cli.stdout.trim());
    assert.equal(digest.matrixId, 'matrix-a');
    assert.equal(digest.pendingReviewCount, 1);
    assert.equal(digest.recentCandidateCount, 1);
    assert.equal(digest.lastRunId, 'run-a');
    assert.equal(digest.providerStatus.reason, 'completed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
