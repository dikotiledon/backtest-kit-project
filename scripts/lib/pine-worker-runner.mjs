import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OLD_SPACE_MB = 256;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const TRUNCATED_MARKER = '\n...[truncated]';

function normalizeMinInt(value, minValue, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < minValue) {
    return minValue;
  }
  return normalized;
}

function appendBounded(current, chunk, state) {
  if (state.truncated) {
    return current;
  }

  const value = chunk.toString('utf8');
  const currentBytes = Buffer.byteLength(current, 'utf8');
  const chunkBytes = Buffer.byteLength(value, 'utf8');
  const nextBytes = currentBytes + chunkBytes;

  if (nextBytes <= state.maxBytes) {
    return current + value;
  }

  const allowedBytes = Math.max(0, state.maxBytes - currentBytes);
  const partial = allowedBytes > 0 ? Buffer.from(value, 'utf8').subarray(0, allowedBytes).toString('utf8') : '';
  state.truncated = true;
  return current + partial + TRUNCATED_MARKER;
}

function tryParseLastJsonLine(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning backward.
    }
  }

  return null;
}

function previewOutput(output) {
  if (!output) {
    return '';
  }

  const trimmed = output.trim();
  const hasTruncatedMarker = trimmed.includes(TRUNCATED_MARKER.trim());
  if (trimmed.length <= 500) {
    return trimmed;
  }

  if (hasTruncatedMarker) {
    return `${trimmed.slice(0, 500)} ...[truncated]`;
  }

  return `${trimmed.slice(0, 500)}...`;
}

function killProcessTree(child) {
  if (!child?.pid) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
      killer.on('error', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore kill fallback failures.
        }
      });
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill fallback failures.
      }
    }
    return;
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore kill failures.
  }
}

export async function runEvaluationWorker({ workerPath, payload, timeoutMs, maxOldSpaceMb, maxOutputBytes } = {}) {
  const normalizedTimeoutMs = normalizeMinInt(timeoutMs, 1000, DEFAULT_TIMEOUT_MS);
  const normalizedMaxOldSpaceMb = normalizeMinInt(maxOldSpaceMb, 64, DEFAULT_MAX_OLD_SPACE_MB);
  const normalizedMaxOutputBytes = normalizeMinInt(maxOutputBytes, 1024, DEFAULT_MAX_OUTPUT_BYTES);

  if (typeof workerPath !== 'string' || workerPath.trim() === '') {
    return { ok: false, reason: 'workerFailed', stderr: 'Invalid workerPath: expected non-empty string' };
  }

  try {
    await access(workerPath);
  } catch {
    return { ok: false, reason: 'workerFailed', stderr: `Worker path does not exist or is not accessible: ${workerPath}` };
  }

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${normalizedMaxOldSpaceMb}`, workerPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let stdinError = null;

    const stdoutState = { maxBytes: normalizedMaxOutputBytes, truncated: false };
    const stderrState = { maxBytes: normalizedMaxOutputBytes, truncated: false };

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      settle({ ok: false, reason: 'workerTimeout' });
    }, normalizedTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk, stdoutState);
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk, stderrState);
    });

    child.stdin.on('error', (error) => {
      stdinError = error?.message ?? String(error);
    });

    child.on('error', (error) => {
      settle({ ok: false, reason: 'workerFailed', stderr: error.message });
    });

    child.on('close', (code) => {
      if (timedOut) {
        return;
      }

      const summary = tryParseLastJsonLine(stdout);
      const stdoutPreview = previewOutput(stdout);
      const stderrPreview = previewOutput(stderr);
      const stdinErrorMessage = stdinError ? `stdin: ${stdinError}` : '';

      if (code !== 0) {
        settle({
          ok: false,
          reason: 'workerFailed',
          stderr: stderrPreview || stdinErrorMessage || (summary?.message ?? 'Worker exited with non-zero status'),
          stdout: stdoutPreview,
          summary
        });
        return;
      }

      if (!summary) {
        settle({
          ok: false,
          reason: 'workerFailed',
          stderr: stderrPreview || stdinErrorMessage || 'Invalid JSON output from worker',
          stdout: stdoutPreview
        });
        return;
      }

      settle({ ok: true, summary });
    });

    try {
      child.stdin.end(JSON.stringify(payload ?? {}));
    } catch (error) {
      stdinError = error?.message ?? String(error);
    }
  });
}
