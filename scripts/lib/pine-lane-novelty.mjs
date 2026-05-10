import { createHash } from 'node:crypto';
import { buildChampionConfigFingerprint } from './pine-global-search.mjs';

export const LANE_PATCH_FINGERPRINT_VERSION = 3;

function compareCodePoints(left, right) {
  if (left === right) return 0;
  const leftPoints = Array.from(String(left));
  const rightPoints = Array.from(String(right));
  const limit = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < limit; index += 1) {
    const leftCodePoint = leftPoints[index].codePointAt(0);
    const rightCodePoint = rightPoints[index].codePointAt(0);
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }

  return leftPoints.length - rightPoints.length;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sortedPatch(patch = {}) {
  return Object.fromEntries(Object.entries(patch || {}).sort(([left], [right]) => compareCodePoints(left, right)));
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

function championFingerprint(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) {
    return buildChampionConfigFingerprint(source.config);
  }
  const direct = source?.championConfigFingerprint ?? source?.metadata?.championConfigFingerprint;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return buildChampionConfigFingerprint(sourceConfig(source));
}

export function buildLanePatchFingerprint({ championConfigFingerprint, lane, mutationFamily, patch } = {}) {
  if (typeof championConfigFingerprint !== 'string' || championConfigFingerprint.length === 0) {
    throw new Error('championConfigFingerprint is required for lane patch fingerprint');
  }

  return createHash('sha256')
    .update(stableJson({
      championConfigFingerprint,
      lane: lane ?? null,
      mutationFamily: mutationFamily ?? null,
      patch: sortedPatch(patch),
      version: LANE_PATCH_FINGERPRINT_VERSION,
    }))
    .digest('hex');
}

function manifestHasChampionConfig(manifest) {
  return manifest?.champion?.config && typeof manifest.champion.config === 'object' && !Array.isArray(manifest.champion.config);
}

function manifestChampionFingerprint(manifest) {
  if (manifest?.champion) return championFingerprint(manifest.champion);
  const direct = manifest?.championConfigFingerprint ?? manifest?.metadata?.championConfigFingerprint;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return null;
}

function manifestVariants(manifest) {
  if (Array.isArray(manifest?.searchPlan?.variants)) return manifest.searchPlan.variants;
  if (Array.isArray(manifest?.variants)) return manifest.variants;
  return [];
}

function validPatchFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function collectTestedLanePatchFingerprints({ champion, lane, manifests = [], historyEvents = [] } = {}) {
  const out = new Set();
  const expectedChampion = championFingerprint(champion);
  const sources = [
    ...(Array.isArray(manifests) ? manifests : []),
    ...(Array.isArray(historyEvents) ? historyEvents.map((event) => event?.manifest).filter(Boolean) : []),
  ];

  for (const manifest of sources) {
    const manifestFingerprint = manifestChampionFingerprint(manifest);
    const authoritativeManifestFingerprint = manifestHasChampionConfig(manifest) ? manifestFingerprint : null;

    for (const variant of manifestVariants(manifest)) {
      const variantLane = variant?.lane ?? null;
      if (lane && variantLane !== lane) continue;

      const variantChampion = authoritativeManifestFingerprint
        ?? variant?.championConfigFingerprint
        ?? variant?.metadata?.championConfigFingerprint
        ?? manifestFingerprint;
      if (variantChampion !== expectedChampion) continue;

      if (variant?.patch && typeof variant.patch === 'object' && !Array.isArray(variant.patch)) {
        out.add(buildLanePatchFingerprint({
          championConfigFingerprint: expectedChampion,
          lane: variantLane ?? lane,
          mutationFamily: variant?.mutationFamily ?? variant?.family ?? null,
          patch: variant.patch,
        }));
        continue;
      }

      const existingFingerprint = variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint;
      if (validPatchFingerprint(existingFingerprint)) {
        out.add(existingFingerprint);
      }
    }
  }

  return out;
}

export function filterNovelLaneCandidates({ candidates = [], champion, lane, testedPatchFingerprints = new Set() } = {}) {
  const championConfigFingerprint = championFingerprint(champion);
  const tested = testedPatchFingerprints instanceof Set
    ? testedPatchFingerprints
    : new Set(testedPatchFingerprints || []);
  const emitted = new Set();
  const out = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateLane = candidate?.lane ?? lane;
    const mutationFamily = candidate?.mutationFamily ?? candidate?.family ?? null;
    const patchFingerprint = buildLanePatchFingerprint({
      championConfigFingerprint,
      lane: candidateLane,
      mutationFamily,
      patch: candidate?.patch || {},
    });

    if (tested.has(patchFingerprint) || emitted.has(patchFingerprint)) continue;
    emitted.add(patchFingerprint);

    out.push({
      ...candidate,
      lane: candidateLane,
      patchFingerprint,
      metadata: {
        ...(candidate?.metadata || {}),
        championConfigFingerprint,
        patchFingerprint,
        patchFingerprintVersion: LANE_PATCH_FINGERPRINT_VERSION,
      },
    });
  }

  return out;
}
