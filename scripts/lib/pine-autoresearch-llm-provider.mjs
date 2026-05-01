import { readFile as defaultReadFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function defaultExecCommand(command, { input = '', timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          if (!settled) {
            child.kill();
          }
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(error?.message ?? error ?? '') });
    });

    child.on('close', (code) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    if (input !== undefined && input !== null) {
      child.stdin.end(String(input));
    } else {
      child.stdin.end();
    }
  });
}

export async function proposeCandidate({ provider, scheduled, prompt, readFile, execCommand } = {}) {
  if (!provider || provider.mode === 'disabled') {
    return { ok: false, reason: 'proposal_unavailable' };
  }

  if (scheduled && provider.mode === 'openclaw') {
    return { ok: false, reason: 'openclaw_rejected_in_scheduled_mode' };
  }

  if (provider.mode === 'openclaw') {
    return { ok: false, reason: 'openclaw_manual_provider_not_implemented' };
  }

  if (provider.mode === 'file') {
    if (!provider.candidateFile) {
      return { ok: false, reason: 'proposal_unavailable' };
    }

    const reader = readFile ?? defaultReadFile;
    const raw = await reader(provider.candidateFile, 'utf8');
    return { ok: true, raw, source: 'file' };
  }

  if (provider.mode === 'cli') {
    if (!provider.cliCommand) {
      return { ok: false, reason: 'proposal_unavailable' };
    }

    const runner = execCommand ?? defaultExecCommand;
    const result = await runner(provider.cliCommand, {
      input: prompt,
      timeoutMs: provider.timeoutMs ?? 90000,
    });

    if (!result || result.code !== 0) {
      return { ok: false, reason: 'proposal_failed', stderr: String(result?.stderr ?? '') };
    }

    return { ok: true, raw: String(result.stdout ?? '').trim(), source: 'cli' };
  }

  return { ok: false, reason: `unknown_provider_mode:${provider.mode}` };
}
