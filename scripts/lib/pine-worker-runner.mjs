import { spawn } from 'node:child_process';

export async function runEvaluationWorker({ workerPath, payload, timeoutMs, maxOldSpaceMb }) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${maxOldSpaceMb}`, workerPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

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
      child.kill('SIGKILL');
      settle({ ok: false, reason: 'workerTimeout' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      settle({ ok: false, reason: 'workerFailed', stderr: error.message });
    });

    child.on('close', (code) => {
      if (timedOut) {
        return;
      }

      if (code !== 0) {
        settle({ ok: false, reason: 'workerFailed', stderr });
        return;
      }

      try {
        const summary = JSON.parse(stdout.trim());
        settle({ ok: true, summary });
      } catch {
        settle({ ok: false, reason: 'workerFailed', stderr: stderr || 'Invalid JSON output from worker' });
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
