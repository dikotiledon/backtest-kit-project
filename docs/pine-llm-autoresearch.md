# Pine LLM Autoresearch Lane

The LLM lane is additive and isolated. Existing non-LLM Pine autoresearch remains active production behavior; it is not legacy, deprecated, or replaced. Existing `pine:autoresearch*` commands and Windows tasks stay standalone. Scheduled LLM operation uses Windows Task Scheduler wrappers, not OpenClaw cron.

## Defaults

- Scheduled provider default: `disabled`
- Scheduled mode today: `cli` provider only; API adapter is future work
- `openclaw` provider: manual/on-demand only; rejected in scheduled mode
- Exactly one candidate object per run
- Auto-promotion: disabled
- Manual review queue required before any promotion flow
- Real Windows task installation requires explicit enablement via `-Enable` or `scheduled.enabled=true`

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
