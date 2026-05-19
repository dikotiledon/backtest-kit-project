/**
 * Champion Loader
 * 
 * Reads the current autoresearch champion and prepares it for testing
 * against arbitrary symbols/timeframes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_AUTORESEARCH_ROOT = path.resolve(
  import.meta.dirname, '..', '..', '..', 'pine', 'autoresearch'
);

/**
 * Find all available autoresearch matrices (champion sources)
 */
export async function listChampionSources(autoresearchRoot = DEFAULT_AUTORESEARCH_ROOT) {
  try {
    const entries = await fs.readdir(autoresearchRoot, { withFileTypes: true });
    const sources = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const championPath = path.join(autoresearchRoot, entry.name, 'champion.json');
      try {
        await fs.access(championPath);
        const raw = JSON.parse(await fs.readFile(championPath, 'utf8'));
        sources.push({
          matrixId: entry.name,
          championPath,
          configId: raw.configId || 'unknown',
          label: raw.label || '',
          score: raw.score,
          tradeCount: raw.tradeCount,
          roiPct: raw.roiPct,
          winRatePct: raw.winRatePct,
        });
      } catch {
        // No champion.json or unreadable — skip
      }
    }

    return sources;
  } catch {
    return [];
  }
}

/**
 * Load full champion data from a specific matrix
 */
export async function loadChampion(matrixId, autoresearchRoot = DEFAULT_AUTORESEARCH_ROOT) {
  const championPath = path.join(autoresearchRoot, matrixId, 'champion.json');
  const raw = await fs.readFile(championPath, 'utf8');
  const champion = JSON.parse(raw);

  return {
    matrixId,
    championPath,
    configId: champion.configId,
    label: champion.label,
    config: champion.config,
    score: champion.score,
    tradeCount: champion.tradeCount,
    roiPct: champion.roiPct,
    winRatePct: champion.winRatePct,
    profitFactor: champion.profitFactor,
    maxDrawdownPct: champion.maxDrawdownPct,
    raw: champion,
  };
}

/**
 * Get the pine script path for a matrix
 */
export function getScriptPath(matrixId, projectRoot) {
  // The autoresearch config references scriptPath relative to config dir
  // Default convention: pine/test.pine is the main script
  return path.resolve(projectRoot, 'pine', 'test.pine');
}

/**
 * Build patch plan from champion config to apply to pine script.
 * Reuses the same patching logic as pine-sweep.
 */
export function buildChampionPatchPlan(config) {
  // Each config key maps to a pine script input variable
  // The patch plan replaces default values with champion values
  return Object.entries(config).map(([key, value]) => ({
    key,
    value,
  }));
}
