import path from 'node:path';
import { repairOrphanEvaluationRuns } from './lib/pine-autoresearch-artifacts.mjs';

function parseArgs(argv) {
  const out = { dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') out.dryRun = false;
    if (arg === '--root') out.root = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root || path.resolve('pine/autoresearch/pine-fusion-v4-core-15m-locked-window');
const result = await repairOrphanEvaluationRuns({
  root,
  dryRun: args.dryRun,
  reason: 'historical_orphan_without_manifest',
});

console.log(JSON.stringify({ root, dryRun: args.dryRun, ...result }, null, 2));
if (result.orphans.length > 0 && args.dryRun) process.exitCode = 2;
