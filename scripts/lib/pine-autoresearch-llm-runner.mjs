import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildLlmLanePaths } from './pine-autoresearch-llm-paths.mjs';
import { buildLlmResearchContext } from './pine-autoresearch-llm-context.mjs';
import { proposeCandidate } from './pine-autoresearch-llm-provider.mjs';
import { executeLlmMatrixCandidate } from './pine-autoresearch-llm-evaluator.mjs';
import { parseCandidateJson, validateCandidate, fingerprintCandidate } from './pine-autoresearch-llm-schema.mjs';
import { buildQualityFeedbackPrompt, scoreCandidateQuality } from './pine-autoresearch-llm-quality.mjs';
import { appendReviewQueueEvent, buildReviewQueueItem, readReviewQueue, resolveReviewItem, unresolvedReviewItems } from './pine-autoresearch-llm-review-queue.mjs';
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
  evaluationManifestPath = null,
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
    evaluationManifestPath,
    details,
    at: isoNow(),
  };
}

async function writeProviderStatus(paths, payload) {
  await writeJson(paths.providerStatus, payload);
  return payload;
}

const INVALID_RESPONSE_PREVIEW_BYTES = 16 * 1024;

function byteBoundedPreview(value, maxBytes = INVALID_RESPONSE_PREVIEW_BYTES) {
  const text = String(value ?? '');
  let bytes = 0;
  let preview = '';

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) {
      break;
    }

    preview += char;
    bytes += charBytes;
  }

  return preview;
}

function byteLengthText(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

async function appendInvalidResponse(paths, {
  attempt,
  maxAttempts,
  command,
  scheduled,
  matrixId,
  providerMode,
  source = null,
  reason,
  error,
  raw,
}) {
  const entry = {
    at: isoNow(),
    attempt,
    maxAttempts,
    command,
    scheduled: Boolean(scheduled),
    matrixId,
    providerMode: providerMode ?? null,
    source: source ?? null,
    reason,
    error: String(error ?? ''),
    rawLength: byteLengthText(raw),
    rawSha256: sha256Text(raw),
    rawPreview: byteBoundedPreview(raw),
  };

  await fs.appendFile(paths.invalidResponses, `${JSON.stringify(entry)}\n`, 'utf8');
  return {
    attempt,
    maxAttempts,
    reason,
    error: entry.error,
    rawLength: entry.rawLength,
    rawSha256: entry.rawSha256,
    rawPreviewPath: paths.invalidResponses,
  };
}

function normalizeMaxCandidateAttempts(provider = {}) {
  const value = Number(provider.maxCandidateAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function normalizeMaxProviderAttempts(provider = {}) {
  const value = Number(provider.maxProviderAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function isTransientProviderError(proposal) {
  const text = `${proposal?.reason ?? ''} ${proposal?.error ?? ''}`.toLowerCase();
  if (/401|403|unauthorized|forbidden|invalid api key|missing api key|schema|unsupported/.test(text)) return false;
  return /timeout|timed out|429|rate limit|temporar|502|503|504|bad gateway|service unavailable|econnreset|network/.test(text);
}

function delay(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.min(value, 30000)));
}

function normalizeMaxQualityAttempts(provider = {}, quality = {}) {
  if (quality?.enabled === false) return 1;
  const value = Number(provider?.maxQualityAttempts ?? quality?.maxAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(3, Math.floor(value)));
}

async function proposeCandidateWithProviderRetry({
  provider,
  repoRoot,
  configDir,
  scheduled,
  prompt,
  allowlist,
  allowGuarded,
  proposeOpenAi,
}) {
  const maxProviderAttempts = normalizeMaxProviderAttempts(provider);
  const providerRetryDelayMs = Number(provider?.providerRetryDelayMs ?? 0);

  for (let providerAttempt = 1; providerAttempt <= maxProviderAttempts; providerAttempt += 1) {
    const proposal = await proposeCandidate({
      provider: {
        ...provider,
        candidateFile: await resolveRelative(provider.candidateFile, [repoRoot, configDir]),
      },
      scheduled,
      prompt,
      allowlist,
      allowGuarded,
      proposeOpenAi,
    });

    if (proposal?.ok || !isTransientProviderError(proposal) || providerAttempt >= maxProviderAttempts) {
      return proposal;
    }

    await delay(providerRetryDelayMs);
  }

  return {
    ok: false,
    reason: 'proposal_failed',
    error: 'provider retry attempts exhausted',
  };
}

function buildRetryPrompt(basePrompt, { attempt, maxAttempts, lastError, lastRawPreview }) {
  if (attempt <= 1) return basePrompt;
  return [
    basePrompt,
    '',
    'Previous candidate output was invalid.',
    `Attempt ${attempt} of ${maxAttempts}.`,
    `Validation error: ${String(lastError ?? '').slice(0, 1000)}`,
    `Invalid output preview: ${String(lastRawPreview ?? '').slice(0, 1000)}`,
    'Return exactly one JSON object matching the schema. No markdown. No prose. No code fences.',
  ].join('\n');
}

function parseAndValidateProposal({ proposal, allowlist, config, ledger, memory }) {
  const parsed = parseCandidateJson(proposal.raw);
  const validation = validateCandidate({
    candidate: normalizeApiCandidate(parsed),
    allowlist: resolveEffectiveAllowlist(allowlist, config.candidate),
    champion: config.champion ?? {},
    recentFingerprints: buildRecentFingerprintSet({ ledger, memory }),
    allowGuarded: Boolean(config?.candidate?.allowGuarded),
  });

  if (!validation || validation.ok === false) {
    throw new Error(validation?.reason ?? 'candidate validation failed');
  }

  return { parsed, validation };
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

function normalizeApiCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  if (!candidate.patch && candidate.params && typeof candidate.params === 'object' && !Array.isArray(candidate.params)) {
    return { ...candidate, patch: candidate.params };
  }

  return candidate;
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
  const manifestPath = path.join(paths.manifests, `${timestampId()}-${identity.candidateFingerprint}.json`);
  const evaluationManifestPath = executeResult?.evaluationManifestPath ?? executeResult?.manifestPath ?? null;

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
    matrixDecision: executeResult?.matrixDecision ?? null,
    evaluationManifestPath,
  };

  await writeJson(manifestPath, payload);
  return { manifestPath, evaluationManifestPath };
}

function summarizePendingReview(queue) {
  const unresolved = unresolvedReviewItems(queue);
  return {
    unresolvedCount: unresolved.length,
    unresolvedIds: unresolved.map((item) => item.itemId),
    unresolvedItems: unresolved.map((item) => ({
      itemId: item.itemId,
      status: item.status,
      runId: item.runId ?? null,
      manifestPath: item.manifestPath ?? null,
      evaluationManifestPath: item.evaluationManifestPath ?? null,
      candidateFingerprint: item.candidateFingerprint ?? null,
      parentChampionFingerprint: item.parentChampionFingerprint ?? null,
      reason: item.reason ?? null,
    })),
    hasBlockers: unresolved.length > 0,
    blockerStatuses: [...new Set(unresolved.map((item) => item.status).filter(Boolean))],
  };
}

const REVIEW_RESOLUTION_STATUSES = new Set(['rejected', 'stale', 'superseded', 'archived']);

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
  parsed,
  validation,
  invalidAttempts = [],
  lastError = null,
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

  if (!parsed || !validation) {
    const error = String(lastError ?? 'candidate invalid');
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'candidate_invalid',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        invalidAttempts,
        error,
      },
    }));

    return {
      ok: false,
      reason: 'candidate_invalid',
      error,
      status,
      reviewSummary,
    };
  }

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

async function runReviewResolveOnly({ config, paths, scheduled, reviewSummary, reviewResolve = {} }) {
  const itemId = reviewResolve.itemId ?? null;
  const nextStatus = reviewResolve.status ?? null;
  const reason = reviewResolve.reason ?? null;

  if (!itemId || !nextStatus) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'review_resolve_missing_args',
      command: 'review-resolve',
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        required: ['itemId', 'status'],
      },
    }));

    return {
      ok: false,
      reason: 'review_resolve_missing_args',
      status,
      reviewSummary,
    };
  }

  if (!REVIEW_RESOLUTION_STATUSES.has(nextStatus)) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'review_resolve_invalid_status',
      command: 'review-resolve',
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        itemId,
        status: nextStatus,
        allowedStatuses: [...REVIEW_RESOLUTION_STATUSES],
      },
    }));

    return {
      ok: false,
      reason: 'review_resolve_invalid_status',
      status,
      reviewSummary,
      itemId,
    };
  }

  const unresolved = reviewSummary?.unresolvedItems ?? [];
  const target = unresolved.find((item) => item.itemId === itemId);
  if (!target) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'review_item_not_found',
      command: 'review-resolve',
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        itemId,
      },
    }));

    return {
      ok: false,
      reason: 'review_item_not_found',
      status,
      reviewSummary,
      itemId,
    };
  }

  await resolveReviewItem(paths.reviewQueue, {
    itemId,
    status: nextStatus,
    reason,
    at: isoNow(),
  });

  const nextReviewQueue = await readReviewQueue(paths.reviewQueue);
  const nextReviewSummary = summarizePendingReview(nextReviewQueue);
  const status = await writeProviderStatus(paths, buildStatus({
    ok: true,
    reason: 'review_resolved',
    command: 'review-resolve',
    scheduled,
    matrixId: paths.matrixId,
    providerMode: config?.provider?.mode,
    details: {
      reviewSummary: nextReviewSummary,
      itemId,
      status: nextStatus,
      reason,
    },
  }));

  return {
    ok: true,
    reason: 'review_resolved',
    status,
    reviewSummary: nextReviewSummary,
    itemId,
    reviewStatus: nextStatus,
  };
}

export async function runLlmAutoresearch({
  configPath,
  repoRoot = process.cwd(),
  command = 'run',
  scheduled = false,
  executeCandidate,
  productionExecuteCandidate = executeLlmMatrixCandidate,
  proposeOpenAi,
  configOverrides = null,
} = {}) {
  const resolvedConfigPath = configPath
    ? (path.isAbsolute(configPath) ? configPath : path.resolve(repoRoot, configPath))
    : path.resolve(repoRoot, 'config/pine-autoresearch-llm.default.json');
  const configDir = path.dirname(resolvedConfigPath);
  const loadedConfig = {
    ...await readJson(resolvedConfigPath),
    ...(configOverrides ?? {}),
  };
  const allowlistPath = await resolveRelative(loadedConfig.allowlistPath, [repoRoot, configDir]);

  if (!allowlistPath) {
    throw new Error('allowlistPath required');
  }

  const allowlist = await readJson(allowlistPath);
  const stateRoot = await resolveRelative(loadedConfig.stateRoot, [repoRoot, configDir]);
  const baseConfigPath = loadedConfig.baseConfigPath
    ? await resolveRelative(loadedConfig.baseConfigPath, [configDir, repoRoot])
    : null;
  const effectiveConfig = baseConfigPath ? { ...loadedConfig, baseConfigPath } : loadedConfig;
  const paths = buildLlmLanePaths({ repoRoot, matrixId: loadedConfig.matrixId, stateRoot });
  await ensureDirectories(paths);

  const reviewQueue = await readReviewQueue(paths.reviewQueue);
  const reviewSummary = summarizePendingReview(reviewQueue);

  if (command === 'review-status') {
    return runReviewStatusOnly({ config: effectiveConfig, paths, scheduled, reviewSummary });
  }

  if (command === 'review-resolve') {
    return runReviewResolveOnly({ config: effectiveConfig, paths, scheduled, reviewSummary, reviewResolve: effectiveConfig.reviewResolve ?? {} });
  }

  if (command === 'validate') {
    return runValidateOnly({ config: effectiveConfig, allowlist, paths, scheduled, reviewSummary });
  }

  if (command === 'digest') {
    const memory = pruneResearchMemory(
      await loadMemory(paths.memory),
      effectiveConfig.memory ?? {},
    );
    return runDigestOnly({ memory, paths });
  }

  const config = effectiveConfig;
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

  const maxCandidateAttempts = normalizeMaxCandidateAttempts(baseProvider);
  const invalidAttempts = [];
  let proposal = null;
  let parsed = null;
  let validation = null;
  let lastError = null;
  let lastRawPreview = null;

  for (let attempt = 1; attempt <= maxCandidateAttempts; attempt += 1) {
    proposal = await proposeCandidateWithProviderRetry({
      provider: baseProvider,
      repoRoot,
      configDir,
      scheduled,
      prompt: buildRetryPrompt(context.prompt, {
        attempt,
        maxAttempts: maxCandidateAttempts,
        lastError,
        lastRawPreview,
      }),
      allowlist,
      allowGuarded: Boolean(config?.candidate?.allowGuarded),
      proposeOpenAi,
    });

    if (!proposal.ok) {
      break;
    }

    try {
      const attemptMemory = await loadMemory(paths.memory);
      const attemptResult = parseAndValidateProposal({
        proposal,
        allowlist,
        config,
        ledger: await readLlmLedger(paths.ledger),
        memory: attemptMemory,
      });
      parsed = attemptResult.parsed;
      validation = attemptResult.validation;
      break;
    } catch (error) {
      lastError = String(error?.message ?? error);
      lastRawPreview = byteBoundedPreview(proposal.raw);
      invalidAttempts.push(await appendInvalidResponse(paths, {
        attempt,
        maxAttempts: maxCandidateAttempts,
        command,
        scheduled,
        matrixId: paths.matrixId,
        providerMode: baseProvider.mode,
        source: proposal.source ?? null,
        reason: 'candidate_invalid',
        error: lastError,
        raw: proposal.raw,
      }));

      if (attempt >= maxCandidateAttempts) {
        break;
      }
    }
  }

  if (command !== 'run') {
    return runProposalOnly({ config, allowlist, paths, context, scheduled, proposal, reviewSummary, command, parsed, validation, invalidAttempts, lastError });
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

  if (proposal?.ok && (!parsed || !validation)) {
    const status = await writeProviderStatus(paths, buildStatus({
      ok: false,
      reason: 'candidate_invalid',
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      details: {
        reviewSummary,
        invalidAttempts,
        error: lastError,
      },
    }));

    return {
      ok: false,
      reason: 'candidate_invalid',
      error: lastError,
      status,
      reviewSummary,
    };
  }

  const qualityConfig = config?.quality ?? {};
  let quality = null;
  if (qualityConfig.enabled) {
    const maxQualityAttempts = normalizeMaxQualityAttempts(baseProvider, qualityConfig);

    for (let qualityAttempt = 1; qualityAttempt <= maxQualityAttempts; qualityAttempt += 1) {
      quality = scoreCandidateQuality({
        candidate: normalizeApiCandidate(parsed),
        champion: config.champion ?? {},
        memory,
        config,
      });

      if (quality?.ok) {
        break;
      }

      if (qualityAttempt >= maxQualityAttempts) {
        const status = await writeProviderStatus(paths, buildStatus({
          ok: false,
          reason: 'candidate_low_quality',
          command,
          scheduled,
          matrixId: paths.matrixId,
          providerMode: config?.provider?.mode,
          details: {
            reviewSummary,
            quality,
          },
        }));

        return {
          ok: false,
          reason: 'candidate_low_quality',
          quality,
          status,
          reviewSummary,
        };
      }

      proposal = await proposeCandidateWithProviderRetry({
        provider: baseProvider,
        repoRoot,
        configDir,
        scheduled,
        prompt: buildQualityFeedbackPrompt(context.prompt, { quality, candidate: normalizeApiCandidate(parsed) }),
        allowlist,
        allowGuarded: Boolean(config?.candidate?.allowGuarded),
        proposeOpenAi,
      });

      if (!proposal.ok) {
        const ok = proposal.reason === 'proposal_unavailable';
        const status = await writeProviderStatus(paths, buildStatus({
          ok,
          reason: proposal.reason,
          command,
          scheduled,
          matrixId: paths.matrixId,
          providerMode: baseProvider.mode,
          details: {
            reviewSummary,
            quality,
          },
        }));

        await writeJson(paths.memory, updateResearchMemory(memory, {
          pendingReviewCount: reviewSummary.unresolvedCount,
        }, config.memory ?? {}));

        return {
          ok,
          reason: proposal.reason,
          status,
          quality,
          reviewSummary,
        };
      }

      try {
        const attemptMemory = await loadMemory(paths.memory);
        const attemptResult = parseAndValidateProposal({
          proposal,
          allowlist,
          config,
          ledger: await readLlmLedger(paths.ledger),
          memory: attemptMemory,
        });
        parsed = attemptResult.parsed;
        validation = attemptResult.validation;
      } catch (error) {
        lastError = String(error?.message ?? error);
        lastRawPreview = byteBoundedPreview(proposal.raw);
        invalidAttempts.push(await appendInvalidResponse(paths, {
          attempt: qualityAttempt + 1,
          maxAttempts: maxQualityAttempts,
          command,
          scheduled,
          matrixId: paths.matrixId,
          providerMode: baseProvider.mode,
          source: proposal.source ?? null,
          reason: 'candidate_invalid',
          error: lastError,
          raw: proposal.raw,
        }));

        parsed = null;
        validation = null;
        break;
      }
    }

    if (proposal?.ok && (!parsed || !validation)) {
      const status = await writeProviderStatus(paths, buildStatus({
        ok: false,
        reason: 'candidate_invalid',
        command,
        scheduled,
        matrixId: paths.matrixId,
        providerMode: config?.provider?.mode,
        details: {
          reviewSummary,
          invalidAttempts,
          error: lastError,
        },
      }));

      return {
        ok: false,
        reason: 'candidate_invalid',
        error: lastError,
        status,
        reviewSummary,
      };
    }
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

  const executor = executeCandidate
    ?? (config?.execution?.mode === 'matrix-eval' ? productionExecuteCandidate : defaultExecuteCandidate);
  let execution;
  try {
    execution = await executor({
      candidate: parsed,
      candidateId: identity.candidateId,
      candidateFingerprint: identity.candidateFingerprint,
      config,
      repoRoot,
      allowlist,
      context: context.prompt,
      paths,
      scheduled,
      command,
      proposal,
    });
  } catch (error) {
    execution = {
      ok: false,
      reason: 'execution_exception',
      error: error?.message ?? String(error),
    };
  }

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

  const { manifestPath, evaluationManifestPath } = await writeManifest({
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
    evaluationManifestPath,
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
        evaluationManifestPath,
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
    evaluationManifestPath,
    details: {
      reviewSummary,
      metricsDelta: execution.metricsDelta ?? null,
    },
  }));

  const resultReason = execution.promotable ? 'candidate_enqueued_for_review' : 'completed';

  return {
    ok: true,
    reason: resultReason,
    status,
    reviewSummary,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    runId: execution.runId ?? null,
    manifestPath,
    evaluationManifestPath,
    validation,
    execution,
  };
}
