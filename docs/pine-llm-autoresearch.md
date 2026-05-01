# Pine LLM Autoresearch Lane

LLM lane isolated from existing Pine autoresearch scheduler. Existing `pine:autoresearch*` commands and Windows tasks stay standalone.

## Defaults

- Scheduled provider default: `disabled`
- Scheduled mode: CLI/API adapter only
- `openclaw` provider: manual/on-demand only; rejected in scheduled mode
- Exactly one candidate per run
- Auto-promotion: disabled
- Manual review queue required for promotion flow

## Safe smoke commands

```bash
npm run pine:autoresearch:llm -- --scheduled
npm run pine:autoresearch:llm:digest
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-llm-run.ps1 -DryRun
```

## Enablement

Do not enable the scheduled LLM task until:

1. tests pass
2. provider is configured to `cli` / API adapter
3. safety review approves

## Review queue

Use `review-status` to inspect unresolved candidates.
Use `review-resolve` to append immutable resolution events.
Unresolved `pending_review` items block scheduled research.
