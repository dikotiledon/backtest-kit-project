import { stdin } from 'node:process';

import { analyzeJsonlFileStreaming } from './lib/pine-streaming-metrics.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};

  if (payload.command === 'analyze-jsonl-streaming') {
    const analysis = await analyzeJsonlFileStreaming(payload.filePath, payload.options ?? {});
    console.log(JSON.stringify({
      ok: true,
      metrics: analysis.metrics,
      score: analysis.score,
      breakdown: analysis.breakdown,
      diagnostics: analysis.diagnostics,
      rowCount: analysis.rowCount
    }));
    return;
  }

  console.error(`Unsupported command: ${payload.command ?? '<missing>'}`);
  process.exitCode = 1;
}

await main();
