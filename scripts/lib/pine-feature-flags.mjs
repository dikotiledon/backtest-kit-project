// scripts/lib/pine-feature-flags.mjs

export const KNOWN_FLAGS = Object.freeze([
  'USE_NEXT_BAR_OPEN_ENTRY',
  'USE_COMPOUNDED_METRICS',
  'USE_COST_MODEL',
  'USE_STATISTICAL_SIGNIFICANCE',
  'USE_WALK_FORWARD_GATE',
  'USE_DATA_QUALITY_GATE',
  'USE_UNIFIED_SCORING',
]);

const FLAG_SET = new Set(KNOWN_FLAGS);

export function createFlagRegistry(overrides = {}) {
  const flags = new Map();
  for (const flag of KNOWN_FLAGS) {
    flags.set(flag, false);
  }
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (FLAG_SET.has(key)) {
        flags.set(key, Boolean(value));
      }
    }
  }
  // Override get to return false for unknown flags (safe default)
  const originalGet = flags.get.bind(flags);
  flags.get = (key) => originalGet(key) ?? false;
  return flags;
}

export function getFlag(registry, name) {
  if (!registry || !FLAG_SET.has(name)) return false;
  return registry.get(name) ?? false;
}

export function setFlag(registry, name, value) {
  if (!registry || !FLAG_SET.has(name)) return;
  registry.set(name, Boolean(value));
}

export function withFlag(registry, name, enabledFn, fallback) {
  if (getFlag(registry, name)) {
    return typeof enabledFn === 'function' ? enabledFn() : enabledFn;
  }
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function registryFromConfig(config = {}) {
  const featureFlags = config?.featureFlags ?? config?.statisticalOverhaul?.featureFlags ?? {};
  return createFlagRegistry(featureFlags);
}
