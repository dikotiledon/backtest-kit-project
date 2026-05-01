function readOptionalEnv(env, name) {
  if (!name) return null;
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveOpenAiAuth({ provider = {}, env = process.env } = {}) {
  const apiKeyEnv = provider.apiKeyEnv || 'OPENAI_API_KEY';
  const apiKey = readOptionalEnv(env, apiKeyEnv);
  if (!apiKey) return { ok: false, reason: `missing_api_key_env:${apiKeyEnv}` };

  const headers = {};
  const organization = readOptionalEnv(env, provider.organizationEnv);
  const project = readOptionalEnv(env, provider.projectEnv);
  if (organization) headers['openai-organization'] = organization;
  if (project) headers['openai-project'] = project;

  return { ok: true, apiKey, apiKeyEnv, headers };
}

function redact(value, secret) {
  const text = String(value ?? '');
  return secret ? text.split(secret).join('[redacted]') : text;
}

export async function postOpenAiJson({ url, apiKey, headers = {}, body, timeoutMs = 90000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'fetch_unavailable', stderr: 'global fetch unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response?.ok) {
      const status = response?.status ?? 'unknown';
      const text = typeof response?.text === 'function' ? await response.text() : '';
      return { ok: false, reason: `http_${status}`, status, stderr: redact(text, apiKey).slice(0, 4000) };
    }

    const json = typeof response.json === 'function' ? await response.json() : null;
    return { ok: true, status: response.status ?? 200, json };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `request timed out after ${timeoutMs}ms`
      : String(error?.message ?? error ?? 'request failed');
    return { ok: false, reason: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed', stderr: redact(message, apiKey) };
  } finally {
    clearTimeout(timer);
  }
}
