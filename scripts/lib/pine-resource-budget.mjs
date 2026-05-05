const toFiniteNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clampMin = (value, min, fallback = min) => {
  const normalized = Math.trunc(toFiniteNumber(value, fallback));
  return Math.max(min, normalized);
};

export function normalizeResourceBudget(raw = {}) {
  return {
    maxConcurrentLabWorkers: clampMin(raw.maxConcurrentLabWorkers, 1),
    maxManifestBytes: clampMin(raw.maxManifestBytes, 16384),
    maxWorkerOldSpaceMb: clampMin(raw.maxWorkerOldSpaceMb, 64),
    maxCandidateBatchSize: clampMin(raw.maxCandidateBatchSize, 1),
    maxRowsLoadedPerWorker: clampMin(raw.maxRowsLoadedPerWorker, 1),
    maxRetainedJsonlPerRun: clampMin(raw.maxRetainedJsonlPerRun, 1),
    softLaneTimeoutMs: clampMin(raw.softLaneTimeoutMs, 1000),
    hardWorkerTimeoutMs: clampMin(raw.hardWorkerTimeoutMs, 1000),
  };
}

export function shouldSpillManifestSection(value, { maxSectionBytes } = {}) {
  const normalizedMaxSectionBytes = clampMin(maxSectionBytes, 1, 16384);
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  return {
    spill: bytes > normalizedMaxSectionBytes,
    bytes,
    maxSectionBytes: normalizedMaxSectionBytes,
  };
}

export function buildArtifactRef({ path, bytes, sha256, schemaVersion }) {
  return { path, bytes, sha256, schemaVersion };
}

export function createResourceUsageSummary({
  peakRssBytes,
  artifactBytesWritten,
  skippedByResourceCap,
  prunedFiles,
} = {}) {
  return {
    peakRssBytes: clampMin(peakRssBytes, 0, 0),
    artifactBytesWritten: clampMin(artifactBytesWritten, 0, 0),
    skippedByResourceCap: clampMin(skippedByResourceCap, 0, 0),
    prunedFiles: clampMin(prunedFiles, 0, 0),
  };
}
