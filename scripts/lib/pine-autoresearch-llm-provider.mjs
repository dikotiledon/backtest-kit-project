import { readFile as defaultReadFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { proposeOpenAiCandidate } from './pine-autoresearch-llm-openai-provider.mjs';

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
      resolve({ code: undefined, signal: undefined, stdout, stderr: String(error?.message ?? error ?? '') });
    });

    child.on('close', (code, signal) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });

    if (input !== undefined && input !== null) {
      child.stdin.end(String(input));
    } else {
      child.stdin.end();
    }
  });
}

function buildCliFailureStderr(result) {
  const parts = [];

  if (!result) {
    parts.push('missing result');
    return parts.join('; ');
  }

  if (result.signal) {
    parts.push(`signal ${String(result.signal)}`);
  }

  if (result.code === null || result.code === undefined) {
    parts.push('missing exit code');
  } else if (result.code !== 0) {
    parts.push(`exit code ${String(result.code)}`);
  }

  if (result.stderr) {
    parts.push(String(result.stderr));
  }

  return parts.join('; ') || 'cli command failed';
}

export async function proposeCandidate({ provider, scheduled, prompt, allowlist, allowGuarded = false, readFile, execCommand, proposeOpenAi } = {}) {
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
    try {
      const raw = await reader(provider.candidateFile, 'utf8');
      return { ok: true, raw, source: 'file' };
    } catch (error) {
      return { ok: false, reason: 'proposal_failed', stderr: String(error?.message ?? error ?? '') };
    }
  }

  if (provider.mode === 'cli') {
    if (!provider.cliCommand) {
      return { ok: false, reason: 'proposal_unavailable' };
    }

    const runner = execCommand ?? defaultExecCommand;
    try {
      const result = await runner(provider.cliCommand, {
        input: prompt,
        timeoutMs: provider.timeoutMs ?? 90000,
      });

      if (!result || result.code !== 0 || result.signal) {
        return { ok: false, reason: 'proposal_failed', stderr: buildCliFailureStderr(result) };
      }

      return { ok: true, raw: String(result.stdout ?? '').trim(), source: 'cli' };
    } catch (error) {
      return { ok: false, reason: 'proposal_failed', stderr: String(error?.message ?? error ?? '') };
    }
  }

  if (provider.mode === 'openai-chat-completions' || provider.mode === 'openai-responses') {
    if (!allowlist) {
      return { ok: false, reason: 'proposal_unavailable', stderr: 'allowlist required for API provider' };
    }

    const proposer = proposeOpenAi ?? proposeOpenAiCandidate;
    try {
      return await proposer({ mode: provider.mode, provider, allowlist, allowGuarded, prompt });
    } catch (error) {
      return { ok: false, reason: 'proposal_failed', stderr: String(error?.message ?? error ?? '') };
    }
  }

  return { ok: false, reason: `unknown_provider_mode:${provider.mode}` };
}
