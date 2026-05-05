import { stdin } from 'node:process';

import { analyzeJsonlFileStreaming } from './lib/pine-streaming-metrics.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function emitFailure(reason, message) {
  console.log(JSON.stringify({ ok: false, reason, message }));
  if (message) {
    console.error(message);
  }
  process.exitCode = 1;
}

async function main() {
  const raw = await readStdin();

  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    emitFailure('invalidPayload', 'Payload is not valid JSON');
    return;
  }

  if (!payload || typeof payload !== 'object') {
    emitFailure('invalidPayload', 'Payload must be an object');
    return;
  }

  if (payload.command !== 'analyze-jsonl-streaming') {
    emitFailure('unknownCommand', `Unsupported command: ${payload.command ?? '<missing>'}`);
    return;
  }

  if (typeof payload.filePath !== 'string' || payload.filePath.trim() === '') {
    emitFailure('invalidPayload', 'Missing required filePath');
    return;
  }

  try {
    const analysis = await analyzeJsonlFileStreaming(payload.filePath, payload.options ?? {});
    console.log(JSON.stringify({
      ok: true,
      metrics: analysis.metrics,
      score: analysis.score,
      breakdown: analysis.breakdown,
      diagnostics: analysis.diagnostics,
      rowCount: analysis.rowCount
    }));
  } catch (error) {
    emitFailure('analysisFailed', error?.message ?? 'Analysis failed');
  }
}

try {
  await main();
} catch (error) {
  emitFailure('analysisFailed', error?.message ?? 'Unhandled worker failure');
}
