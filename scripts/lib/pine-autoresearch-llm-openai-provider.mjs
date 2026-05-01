import { buildStructuredOutputConfig } from './pine-autoresearch-llm-openai-schema.mjs';
import { postOpenAiJson, resolveOpenAiAuth } from './pine-autoresearch-llm-openai-http.mjs';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function systemInstruction() {
  return [
    'You propose Pine strategy autoresearch candidates.',
    'Return exactly one JSON object and no markdown.',
    'The JSON object must match the provided schema.',
    'Do not include arrays of candidates.',
    'Do not propose code edits, architecture toggles, or parameters outside the schema.',
  ].join(' ');
}

function sampling(provider = {}) {
  const out = {};
  if (Number.isFinite(provider.temperature)) out.temperature = provider.temperature;
  if (Number.isFinite(provider.topP)) out.top_p = provider.topP;
  return out;
}

export function buildChatCompletionsRequest({ provider = {}, prompt, allowlist, allowGuarded = false } = {}) {
  return {
    model: provider.model,
    stream: false,
    n: 1,
    ...sampling(provider),
    max_completion_tokens: provider.maxOutputTokens ?? 1200,
    messages: [
      { role: 'developer', content: systemInstruction() },
      { role: 'user', content: String(prompt ?? '') },
    ],
    response_format: buildStructuredOutputConfig({ apiStyle: 'chat-completions', allowlist, allowGuarded }),
  };
}

export function buildResponsesRequest({ provider = {}, prompt, allowlist, allowGuarded = false } = {}) {
  return {
    model: provider.model,
    stream: false,
    store: false,
    ...sampling(provider),
    max_output_tokens: provider.maxOutputTokens ?? 1200,
    instructions: systemInstruction(),
    input: String(prompt ?? ''),
    text: { format: buildStructuredOutputConfig({ apiStyle: 'responses', allowlist, allowGuarded }) },
  };
}

export function extractChatCompletionsText(json) {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  if (!choice) return { ok: false, reason: 'missing_choice' };
  if (choice.finish_reason && choice.finish_reason !== 'stop') return { ok: false, reason: `finish_reason:${choice.finish_reason}` };
  const raw = choice.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'missing_message_content' };
  return { ok: true, raw: raw.trim() };
}

export function extractResponsesText(json) {
  if (json?.status && json.status !== 'completed') {
    return { ok: false, reason: `response_status:${json.status}`, stderr: String(json?.incomplete_details?.reason ?? json?.error?.message ?? '') };
  }
  const parts = [];
  if (typeof json?.output_text === 'string' && json.output_text.trim()) parts.push(json.output_text);
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') parts.push(content.text);
    }
  }
  const textParts = parts.map((part) => String(part).trim()).filter(Boolean);
  if (textParts.length === 0) return { ok: false, reason: 'missing_output_text' };
  if (textParts.length !== 1) return { ok: false, reason: 'multiple_output_text' };
  return { ok: true, raw: textParts[0] };
}

export async function proposeOpenAiCandidate({ mode, provider = {}, allowlist, allowGuarded = false, prompt, env = process.env, postJson = postOpenAiJson } = {}) {
  if (!provider.model) return { ok: false, reason: 'proposal_unavailable', stderr: 'provider.model required' };

  const auth = resolveOpenAiAuth({ provider, env });
  if (!auth.ok) return auth;

  const apiBaseUrl = trimTrailingSlash(provider.apiBaseUrl);
  if (mode !== 'openai-chat-completions' && mode !== 'openai-responses') {
    return { ok: false, reason: 'proposal_unavailable', stderr: `unsupported provider mode:${String(mode)}` };
  }
  const isChat = mode === 'openai-chat-completions';
  const url = `${apiBaseUrl}${isChat ? '/chat/completions' : '/responses'}`;
  const body = isChat
    ? buildChatCompletionsRequest({ provider, prompt, allowlist, allowGuarded })
    : buildResponsesRequest({ provider, prompt, allowlist, allowGuarded });

  const posted = await postJson({ url, apiKey: auth.apiKey, headers: auth.headers, body, timeoutMs: provider.timeoutMs ?? 90000 });
  if (!posted.ok) return { ok: false, reason: posted.reason ?? 'proposal_failed', stderr: posted.stderr ?? '' };

  const extracted = isChat ? extractChatCompletionsText(posted.json) : extractResponsesText(posted.json);
  if (!extracted.ok) return { ok: false, reason: extracted.reason, stderr: extracted.stderr ?? '' };
  return { ok: true, raw: extracted.raw, source: mode };
}
