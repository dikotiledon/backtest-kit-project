# Pine LLM Autoresearch Lane

The LLM lane is additive and isolated. Existing non-LLM Pine autoresearch remains active production behavior; it is not legacy, deprecated, or replaced. Existing `pine:autoresearch*` commands and Windows tasks stay standalone. Scheduled LLM operation uses Windows Task Scheduler wrappers, not OpenClaw cron.

## Defaults

- Scheduled provider default: `disabled`
- Scheduled provider modes supported after explicit enablement: `cli`, `openai-chat-completions`, `openai-responses`
- `openclaw` provider: manual/on-demand only; rejected in scheduled mode
- API providers are non-streaming and must return exactly one candidate object
- Auto-promotion: disabled
- Manual review queue required before any promotion flow
- Real Windows task installation requires explicit enablement via `-Enable` or `scheduled.enabled=true`

## OpenAI Responses provider

Set the API key outside the repo:

```powershell
setx OPENAI_API_KEY "sk-..."
```

Use config:

```json
{
  "provider": {
    "mode": "openai-responses",
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-5.4",
    "temperature": 0.2,
    "topP": 1,
    "maxOutputTokens": 1200,
    "timeoutMs": 90000
  }
}
```

The request uses `POST /v1/responses` with `text.format.type=json_schema`, `stream=false`, and `store=false`.

## OpenAI Chat Completions provider

Use config:

```json
{
  "provider": {
    "mode": "openai-chat-completions",
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-4.1-mini",
    "temperature": 0.2,
    "topP": 1,
    "maxOutputTokens": 1200,
    "timeoutMs": 90000
  }
}
```

The request uses `POST /v1/chat/completions` with `response_format.type=json_schema`, `stream=false`, and `n=1`.

## Operator commands

```bash
npm run pine:autoresearch:llm -- --scheduled
npm run pine:autoresearch:llm:propose
npm run pine:autoresearch:llm:validate -- --candidate <candidate.json>
npm run pine:autoresearch:llm:digest
npm run pine:ops:install-llm-tasks -- -DryRun
npm run pine:ops:remove-llm-tasks -- -WhatIf
```

PowerShell smoke commands:

```bash
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-llm-run.ps1 -DryRun
pwsh -NoProfile -File ./scripts/ops/install-pine-autoresearch-llm-tasks.ps1 -Enable -DryRun
pwsh -NoProfile -File ./scripts/ops/remove-pine-autoresearch-llm-tasks.ps1 -WhatIf
```

## Enablement

Do not enable real scheduled LLM tasks until:

1. tests pass
2. provider is configured to `cli`
3. safety review approves
4. operator explicitly passes `-Enable` or sets `scheduled.enabled=true`

Default config has `scheduled.enabled=false` and `provider.mode=disabled`; installer refuses real registration without explicit enablement. Dry-run / WhatIf preview is safe and does not create tasks.

## Review queue

Use `review-status` to inspect unresolved candidates. Use `review-resolve` to append immutable resolution events.

Blocking statuses:

- `pending_review`
- `accepted_for_manual_promotion`

Resolution statuses supported by `review-resolve`:

- `rejected`
- `stale`
- `superseded`
- `archived`

Unresolved blockers pause new `run`, `propose`, and `enqueue` paths for active providers. Scheduled disabled provider still soft-succeeds with `proposal_unavailable` so a disabled task does not look failed.

## API provider safety

- Never commit API keys. Use `apiKeyEnv`.
- Provider responses are untrusted. Local candidate parsing, allowlist validation, fingerprinting, reservation, and manual review still gate all output.
- Streaming, tools, function calls, background responses, and conversation persistence are intentionally disabled for this lane.
- API providers can be installed as scheduled tasks only after explicit `-Enable` or `scheduled.enabled=true`.
