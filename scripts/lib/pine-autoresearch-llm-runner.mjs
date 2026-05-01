import fs from 'node:fs/promises';
import path from 'node:path';

import { buildLlmLanePaths } from './pine-autoresearch-llm-paths.mjs';
import { buildLlmResearchContext } from './pine-autoresearch-llm-context.mjs';
import { proposeCandidate } from './pine-autoresearch-llm-provider.mjs';
import { parseCandidateJson, validateCandidate, fingerprintCandidate } from './pine-autoresearch-llm-schema.mjs';
import { appendReviewQueueEvent, buildReviewQueueItem, readReviewQueue, unresolvedReviewItems } from './pine-autoresearch-llm-review-queue.mjs';
import { reserveCandidate, finalizeReservation } from './pine-autoresearch-llm-reservation.mjs';
import { readLlmLedger, summarizeLlmLedgerFingerprints } from './pine-autoresearch-llm-ledger.mjs';
import { pruneResearchMemory, updateResearchMemory } from './pine-autoresearch-llm-memory.mjs';
import { isoNow, readJson, timestampId, writeJson } from './pine-autoresearch.mjs';

async function resolveRelative(value, bases = []) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  for (const base of bases) {
    if (!base) {
      continue;
    }

    const candidate = path.resolve(base, value);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next base
    }
  }

  return path.resolve(bases[0] || process.cwd(), value);
}

function isMissingError(error) {
  return Boolean(error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}

async function readJsonOrFallback(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (isMissingError(error)) {
      return fallback;
    }

    throw error;
  }
}

async function ensureDirectories(paths) {
  await Promise.all([
    paths.state,
    paths.manifests,
    paths.runs,
    paths.archive,
  ].map((dir) => fs.mkdir(dir, { recursive: true })));
}

function buildStatus({
  ok,
  reason,
  command,
  scheduled,
  matrixId,
  providerMode,
  candidateId = null,
  candidateFingerprint = null,
  runId = null,
  manifestPath = null,
  details = null,
}) {
  return {
    ok,
    reason,
    command,
    scheduled: Boolean(scheduled),
    matrixId,
    providerMode: providerMode ?? null,
    candidateId,
    candidateFingerprint,
    runId,
    manifestPath,
    details,
    at: isoNow(),
  };
}

async function writeProviderStatus(paths, payload) {
  await writeJson(paths.providerStatus, payload);
  return payload;
}

function resolveEffectiveAllowlist(allowlist, candidateConfig = {}) {
  const maxes = [allowlist?.maxChangedParams, candidateConfig?.maxChangedParams]
    .filter((value) => Number.isFinite(value) && value >= 0);

  const effective = {
    ...(allowlist ?? {}),
  };

  if (maxes.length > 0) {
    effective.maxChangedParams = Math.min(...maxes);
  }

  return effective;
}

async function loadMemory(memoryPath) {
  try {
    const parsed = await readJson(memoryPath);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (isMissingError(error) || error instanceof SyntaxError) {
      return {};
    }

    throw error;
  }
}

function buildRecentFingerprintSet({ ledger, memory }) {
  const summary = summarizeLlmLedgerFingerprints(ledger);
  const fingerprints = new Set(summary.fingerprints);

  for (const fingerprint of Array.isArray(memory?.rejectedFingerprints) ? memory.rejectedFingerprints : []) {
    if (fingerprint) {
      fingerprints.add(fingerprint);
    }
  }

  return fingerprints;
}

function buildCandidateIdentity({ championFingerprint, validation }) {
  const candidateFingerprint = validation.fingerprint;
  const parentChampionFingerprint = championFingerprint ?? null;
  const candidateId = parentChampionFingerprint
    ? `${parentChampionFingerprint}:${candidateFingerprint}`
    : candidateFingerprint;

  return { candidateId, candidateFingerprint, parentChampionFingerprint };
}

async function defaultExecuteCandidate({ candidateId, candidateFingerprint }) {
  return {
    ok: true,
    runId: `${timestampId()}-${candidateFingerprint.slice(0, 12)}`,
    manifestPath: null,
    metricsDelta: {},
    candidateId,
    candidateFingerprint,
  };
}

async function writeManifest({ paths, candidate, validation, identity, executeResult, config }) {
  const manifestPath = executeResult?.manifestPath
    ?? path.join(paths.manifests, `${timestampId()}-${identity.candidateFingerprint}.json`);

  const payload = {
    lane: 'llm',
    createdAt: isoNow(),
    runId: executeResult?.runId ?? null,
    matrixId: paths.matrixId,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    parentChampionFingerprint: identity.parentChampionFingerprint ?? null,
    candidate,
    provider: { mode: config?.provider?.mode ?? null },
    metricsDelta: executeResult?.metricsDelta ?? null,
  };

  await writeJson(manifestPath, payload);
  return manifestPath;
}

function summarizePendingReview(queue) {
  const unresolved = unresolvedReviewItems(queue);
  return {
    unresolvedCount: unresolved.length,
    unresolvedIds: unresolved.map((item) => item.itemId),
    hasBlockers: unresolved.length > 0,
    blockerStatuses: [...new Set(unresolved.map((item) => item.status).filter(Boolean))],
  };
}

function shouldBlockProposalPath(command, reviewSummary) {
  return ['run', 'propose', 'enqueue'].includes(command) && Boolean(reviewSummary?.hasBlockers);
}

async function runProposalOnly({
  config,
  allowlist,
  paths,
  context,
  scheduled,
  proposal,
  reviewSummary,
  command,
}) {
  if (!proposal.ok) {
    const ok = proposal.reason === 'proposal_unavailable';
    const status = await writeProviderStatus(paths, buildStatus({
      ok,
      reason: proposal.reason,
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
      },
    }));

    return {
      ok,
      reason: proposal.reason,
      status,
      reviewSummary,
    };
  }

  try {
    const parsed = parseCandidateJson(proposal.raw);
    const ledger = await readLlmLedger(paths.ledger);
    const memory = await loadMemory(paths.memory);
    const validation = validateCandidate({
      candidate: parsed,
      allowlist: resolveEffectiveAllowlist(allowlist, config?.candidate),
      champion: config?.champion ?? {},
      recentFingerprints: buildRecentFingerprintSet({ ledger, memory }),
      allowGuarded: Boolean(config?.candidate?.allowGuarded),
    });

    const identity = buildCandidateIdentity({ championFingerprint: fingerprintCandidate({ patch: config.champion ?? {} }), validation });
    const status = await writeProviderStatus(paths, buildStatus({
      ok: true,
      reason: 'proposal_ready',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      details: {
        reviewSummary,
        context: {
          truncated: context?.truncated ?? false,
          overflow: context?.overflow ?? false,
        },
      },
    }));

    return {
      ok: true,
      reason: 'proposal_ready',
      status,
      candidate: parsed,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      validation,
      reviewSummary,
    };
  } catch (error) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'candidate_invalid',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        error: String(error?.message ?? error),
      },
    }));

    return {
      ok: false,
      reason: 'candidate_invalid',
      error: String(error?.message ?? error),
      status,
      reviewSummary,
    };
  }
}

async function runDigestOnly({ memory, paths }) {
  const reviewQueue = await readReviewQueue(paths.reviewQueue);
  const reviewSummary = summarizePendingReview(reviewQueue);
  const ledger = await readLlmLedger(paths.ledger);
  const recentCandidates = Array.isArray(memory?.recentCandidates) ? memory.recentCandidates : [];
  const providerStatus = await readJsonOrFallback(paths.providerStatus, null);

  let lastRunId = null;
  for (let index = ledger.events.length - 1; index >= 0; index -= 1) {
    if (ledger.events[index]?.runId) {
      lastRunId = ledger.events[index].runId;
      break;
    }
  }

  return {
    ok: true,
    reason: 'digest_ready',
    digest: {
      matrixId: paths.matrixId,
      pendingReviewCount: reviewSummary.unresolvedCount,
      recentCandidateCount: recentCandidates.length,
      lastRunId,
      providerStatus: providerStatus ? {
        ok: providerStatus.ok ?? null,
        reason: providerStatus.reason ?? null,
      } : null,
    },
    reviewSummary,
  };
}

async function runValidateOnly({ config, allowlist, paths, scheduled, reviewSummary }) {
  const status = await writeProviderStatus(paths, buildStatus({
    ok: true,
    reason: 'validated',
    command: 'validate',
    scheduled,
    matrixId: paths.matrixId,
    providerMode: config?.provider?.mode,
    details: {
      reviewSummary,
      allowlistVersion: allowlist?.version ?? null,
    },
  }));

  return {
    ok: true,
    reason: 'validated',
    status,
    reviewSummary,
  };
}

async function runReviewStatusOnly({ config, paths, scheduled, reviewSummary }) {
  const status = await writeProviderStatus(paths, buildStatus({
    ok: true,
    reason: 'review_status',
    command: 'review-status',
    scheduled,
    matrixId: paths.matrixId,
    providerMode: config?.provider?.mode,
    details: reviewSummary,
  }));

  return {
    ok: true,
    reason: 'review_status',
    status,
    reviewSummary,
  };
}

async function runReviewResolveOnly({ config, paths, scheduled, reviewSummary }) {
  const status = await writeProviderStatus(paths, buildStatus({
    ok: true,
    reason: 'review_resolve',
    command: 'review-resolve',
    scheduled,
    matrixId: paths.matrixId,
    providerMode: config?.provider?.mode,
    details: reviewSummary,
  }));

  return {
    ok: true,
    reason: 'review_resolve',
    status,
    reviewSummary,
  };
}

export async function runLlmAutoresearch({
  configPath,
  repoRoot = process.cwd(),
  command = 'run',
  scheduled = false,
  executeCandidate,
} = {}) {
  const resolvedConfigPath = configPath
    ? (path.isAbsolute(configPath) ? configPath : path.resolve(repoRoot, configPath))
    : path.resolve(repoRoot, 'config/pine-autoresearch-llm.default.json');
  const configDir = path.dirname(resolvedConfigPath);
  const config = await readJson(resolvedConfigPath);
  const allowlistPath = await resolveRelative(config.allowlistPath, [repoRoot, configDir]);

  if (!allowlistPath) {
    throw new Error('allowlistPath required');
  }

  const allowlist = await readJson(allowlistPath);
  const paths = buildLlmLanePaths({ repoRoot, matrixId: config.matrixId });
  await ensureDirectories(paths);

  const reviewQueue = await readReviewQueue(paths.reviewQueue);
  const reviewSummary = summarizePendingReview(reviewQueue);

  if (command === 'review-status') {
    return runReviewStatusOnly({ config, paths, scheduled, reviewSummary });
  }

  if (command === 'review-resolve') {
    return runReviewResolveOnly({ config, paths, scheduled, reviewSummary });
  }

  if (command === 'validate') {
    return runValidateOnly({ config, allowlist, paths, scheduled, reviewSummary });
  }

  if (command === 'digest') {
    const memory = pruneResearchMemory(
      await loadMemory(paths.memory),
      config.memory ?? {},
    );
    return runDigestOnly({ memory, paths });
  }

  const baseProvider = config.provider ?? {};
  if (scheduled && baseProvider.mode === 'openclaw') {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'openclaw_rejected_in_scheduled_mode',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      details: {
        reviewSummary,
      },
    }));

    return {
      ok: false,
      reason: 'openclaw_rejected_in_scheduled_mode',
      status,
      reviewSummary,
    };
  }

  if (scheduled && (!baseProvider.mode || baseProvider.mode === 'disabled')) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: true,
      reason: 'proposal_unavailable',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode ?? 'disabled',
      details: {
        reviewSummary,
      },
    }));

    return {
      ok: true,
      reason: 'proposal_unavailable',
      status,
      reviewSummary,
    };
  }

  if (shouldBlockProposalPath(command, reviewSummary)) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'pending_review_block',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      details: reviewSummary,
    }));

    return {
      ok: false,
      reason: 'pending_review_block',
      status,
      reviewSummary,
    };
  }

  const memory = pruneResearchMemory(
    await loadMemory(paths.memory),
    config.memory ?? {},
  );

  const championFingerprint = fingerprintCandidate({ patch: config.champion ?? {} });

  const context = buildLlmResearchContext({
    champion: config.champion ?? {},
    allowlist,
    memory,
    maxPromptBytes: config.memory?.maxPromptBytes,
  });

  const proposal = await proposeCandidate({
    provider: {
      ...baseProvider,
      candidateFile: await resolveRelative(baseProvider.candidateFile, [repoRoot, configDir]),
    },
    scheduled,
    prompt: context.prompt,
    allowlist,
    allowGuarded: Boolean(config?.candidate?.allowGuarded),
  });

  if (command !== 'run') {
    return runProposalOnly({ config, allowlist, paths, context, scheduled, proposal, reviewSummary, command });
  }

  if (!proposal.ok) {
    const ok = proposal.reason === 'proposal_unavailable';
    const status = await writeProviderStatus(paths, buildStatus({
      ok,
      reason: proposal.reason,
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      details: reviewSummary,
    }));

    await writeJson(paths.memory, updateResearchMemory(memory, {
      pendingReviewCount: reviewSummary.unresolvedCount,
    }, config.memory ?? {}));

    return {
      ok,
      reason: proposal.reason,
      status,
      reviewSummary,
    };
  }

  let parsed;
  let validation;
  try {
    parsed = parseCandidateJson(proposal.raw);
    validation = validateCandidate({
      candidate: parsed,
      allowlist: resolveEffectiveAllowlist(allowlist, config.candidate),
      champion: config.champion ?? {},
      recentFingerprints: buildRecentFingerprintSet({ ledger: await readLlmLedger(paths.ledger), memory }),
      allowGuarded: Boolean(config?.candidate?.allowGuarded),
    });
  } catch (error) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'candidate_invalid',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      details: {
        reviewSummary,
        error: String(error?.message ?? error),
      },
    }));

    return {
      ok: false,
      reason: 'candidate_invalid',
      error: String(error?.message ?? error),
      status,
      reviewSummary,
    };
  }

  const identity = buildCandidateIdentity({ championFingerprint, validation });
  const reservation = await reserveCandidate({ ledgerPath: paths.ledger }, {
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    parentChampionFingerprint: identity.parentChampionFingerprint,
  });

  if (!reservation.reserved) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: true,
      reason: reservation.reason,
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      details: reviewSummary,
    }));

    await writeJson(paths.memory, updateResearchMemory(memory, {
      pendingReviewCount: reviewSummary.unresolvedCount,
      candidateSummary: {
        candidateId: identity.candidateId,
        candidateFingerprint: identity.candidateFingerprint,
        status: reservation.reason,
      },
    }, config.memory ?? {}));

    return {
      ok: true,
      reason: reservation.reason,
      status,
      reviewSummary,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      validation,
    };
  }

  const executor = executeCandidate ?? defaultExecuteCandidate;
  const execution = await executor({
    candidate: parsed,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    config,
    allowlist,
    context: context.prompt,
    paths,
    scheduled,
    command,
    proposal,
  });

  if (!execution || execution.ok === false) {
    await finalizeReservation({ ledgerPath: paths.ledger }, {
      type: 'failed',
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      runId: execution?.runId ?? null,
      at: isoNow(),
    });

    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: execution?.reason ?? 'execution_failed',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: baseProvider.mode,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      details: {
        reviewSummary,
        error: String(execution?.error ?? execution?.stderr ?? 'execution failed'),
      },
    }));

    return {
      ok: false,
      reason: execution?.reason ?? 'execution_failed',
      status,
      reviewSummary,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      validation,
    };
  }

  const manifestPath = await writeManifest({
    paths,
    candidate: parsed,
    validation,
    identity,
    executeResult: execution,
    config,
  });

  await finalizeReservation({ ledgerPath: paths.ledger }, {
    type: 'completed',
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    runId: execution.runId ?? null,
    manifestPath,
    metricsDelta: execution.metricsDelta ?? null,
    at: isoNow(),
  });

  const nextMemory = updateResearchMemory(memory, {
    candidateSummary: {
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      status: 'completed',
      runId: execution.runId ?? null,
    },
    winnerSummary: execution.metricsDelta ? {
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      metricsDelta: execution.metricsDelta,
    } : null,
    pendingReviewCount: reviewSummary.unresolvedCount,
  }, config.memory ?? {});

  await writeJson(paths.memory, nextMemory);

  if (execution.promotable) {
    await appendReviewQueueEvent(paths.reviewQueue, {
      item: buildReviewQueueItem({
        parentChampionFingerprint: identity.parentChampionFingerprint,
        candidateFingerprint: identity.candidateFingerprint,
        candidateId: identity.candidateId,
        runId: execution.runId ?? null,
        manifestPath,
        candidate: parsed,
        provider: { mode: baseProvider.mode ?? null },
        metricsDelta: execution.metricsDelta ?? null,
        promotable: true,
        createdAt: isoNow(),
      }),
    });
  }

  const status = await writeProviderStatus(paths, buildStatus({
    ok: true,
    reason: 'completed',
    command,
    scheduled,
    matrixId: paths.matrixId,
    providerMode: baseProvider.mode,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    runId: execution.runId ?? null,
    manifestPath,
    details: {
      reviewSummary,
      metricsDelta: execution.metricsDelta ?? null,
    },
  }));

  return {
    ok: true,
    reason: 'completed',
    status,
    reviewSummary,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    runId: execution.runId ?? null,
    manifestPath,
    validation,
    execution,
  };
}
