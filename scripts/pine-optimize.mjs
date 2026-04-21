import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeJsonlFile } from './lib/pine-optimizer.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function formatNumber(value) {
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || args._[0] || './pine/dump/test.flattened.cleaned.jsonl';
  const minTrades = args['min-trades'] ? Number(args['min-trades']) : undefined;
  const analysis = await analyzeJsonlFile(input, {
    minTrades,
  });

  const summary = {
    filePath: analysis.filePath,
    rowCount: analysis.rowCount,
    timeframeMinutes: analysis.timeframeMinutes,
    score: analysis.score,
    metrics: analysis.metrics,
    tradePreview: analysis.trades.slice(0, 20),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`file: ${summary.filePath}`);
    console.log(`rows: ${summary.rowCount}`);
    console.log(`timeframeMinutes: ${summary.timeframeMinutes}`);
    console.log(`score: ${formatNumber(summary.score)}`);
    console.log(`tradeCount: ${summary.metrics.tradeCount}`);
    console.log(`winRatePct: ${formatNumber(summary.metrics.winRatePct)}`);
    console.log(`roiPct: ${formatNumber(summary.metrics.roiPct)}`);
    console.log(`maxDrawdownPct: ${formatNumber(summary.metrics.maxDrawdownPct)}`);
    console.log(`profitFactor: ${formatNumber(summary.metrics.profitFactor)}`);
    console.log(`avgReturnPct: ${formatNumber(summary.metrics.avgReturnPct)}`);
    console.log(`avgPnl: ${formatNumber(summary.metrics.avgPnl)}`);
    if (analysis.trades.length) {
      console.log('firstTrades:');
      for (const trade of analysis.trades.slice(0, 5)) {
        console.log(`  ${trade.entryTime} ${trade.side} -> ${trade.exitTime} ${trade.exitReason} pnl=${formatNumber(trade.pnl)} returnPct=${formatNumber(trade.returnPct)}`);
      }
    }
  }

  const outputPath = args.output || args._[1];
  if (outputPath) {
    const outPath = path.resolve(String(outputPath));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`saved: ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
