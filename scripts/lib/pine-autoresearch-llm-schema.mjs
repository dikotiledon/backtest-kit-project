import crypto from 'node:crypto';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function fingerprintCandidate(candidate) {
  const source = candidate?.patch ?? candidate;
  const canonical = canonicalizeJson(source);
  return crypto.createHash('sha256').update(String(canonical)).digest('hex');
}

export function parseCandidateJson(raw) {
  const text = String(raw ?? '').trim();

  if (text.startsWith('```')) {
    throw new Error('JSON object only; code fences are rejected');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Expected exactly one JSON object');
  }

  if (!isPlainObject(parsed.patch)) {
    throw new Error('Expected plain patch object');
  }

  return parsed;
}

function isStepAligned(value, step, min = 0) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return false;
  }

  const ratio = (value - min) / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

function fail(message) {
  throw new Error(message);
}

export function validateCandidate({
  candidate,
  allowlist,
  champion = {},
  recentFingerprints = new Set(),
  allowGuarded = false,
} = {}) {
  if (!isPlainObject(candidate) || !isPlainObject(candidate.patch)) {
    return { ok: false, reason: 'missing patch object' };
  }

  const parameters = new Map((allowlist?.parameters ?? []).map((parameter) => [parameter.key, parameter]));
  const changedKeys = Object.keys(candidate.patch);
  const maxChanged = allowlist?.maxChangedParams ?? changedKeys.length;

  if (changedKeys.length === 0) {
    fail('patch has no changes');
  }

  if (changedKeys.length > maxChanged) {
    fail(`too many changed params: ${changedKeys.length} > ${maxChanged}`);
  }

  for (const key of changedKeys) {
    const spec = parameters.get(key);

    if (!spec) {
      fail(`unknown parameter: ${key}`);
    }

    if (spec.mutability === 'forbidden') {
      fail(`forbidden parameter: ${key}`);
    }

    if (allowlist?.freezeArchitecture && spec.family === 'architecture') {
      fail(`forbidden architecture change: ${key}`);
    }

    if (spec.mutability === 'guarded' && !allowGuarded) {
      fail(`guarded parameter requires manual override: ${key}`);
    }

    const value = candidate.patch[key];

    if (spec.type === 'int') {
      if (!Number.isInteger(value)) {
        fail(`expected int for ${key}`);
      }
    } else if (spec.type === 'float') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        fail(`expected float for ${key}`);
      }
    } else if (spec.type === 'bool') {
      if (typeof value !== 'boolean') {
        fail(`expected bool for ${key}`);
      }
    }

    if (typeof value === 'number') {
      if (typeof spec.min === 'number' && value < spec.min) {
        fail(`outside range for ${key}`);
      }

      if (typeof spec.max === 'number' && value > spec.max) {
        fail(`outside range for ${key}`);
      }

      if (typeof spec.step === 'number' && !isStepAligned(value, spec.step, typeof spec.min === 'number' ? spec.min : 0)) {
        fail(`step misaligned for ${key}`);
      }
    }
  }

  if (changedKeys.every((key) => Object.is(candidate.patch[key], champion?.[key]))) {
    fail('candidate matches champion');
  }

  const fingerprint = fingerprintCandidate(candidate);
  if (recentFingerprints && typeof recentFingerprints.has === 'function' && recentFingerprints.has(fingerprint)) {
    fail('duplicate candidate fingerprint');
  }

  return {
    ok: true,
    fingerprint,
    changedKeys,
    canonicalPatch: canonicalizeJson(candidate.patch),
  };
}