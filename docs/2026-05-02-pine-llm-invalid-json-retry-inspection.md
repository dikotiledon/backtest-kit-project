# Pine LLM invalid JSON retry inspection

## Problem

The Pine LLM lane can receive malformed candidate output: invalid JSON, schema misses, or other candidate-validation failures. Those failures need durable inspection so operators can see what the model actually returned even when later commands overwrite `llm-provider-status.json`.

## Behavior

- Malformed candidate JSON / schema failures are recorded to append-only JSONL.
- Retry applies only to parse/schema invalid candidate responses.
- Retry is bounded by `provider.maxCandidateAttempts`.
- `Provider failures are not retried`.
- Provider failures (`proposal.ok === false`) do not create invalid-response rows.

Task 5 hardening is still enforced at the provider prompt level: the provider instruction asks for exactly one JSON object, no markdown, no code fences, and a schema-consistent fallback (`smallest allowed params patch`). Runner validation and retry still decide correctness.

## Config

Relevant config knob: `provider.maxCandidateAttempts`.

Suggested use:

- stable/local-clean models: keep the default one attempt
- local/free/noisy models: raise to 2-3 attempts

## Inspection

Invalid candidate previews are stored under:

```text
pine/autoresearch-llm/llm-<matrix-id>/state/llm-invalid-responses.jsonl
```

Each JSONL row includes attempt metadata plus bounded raw-response evidence:

- `rawLength`
- `rawSha256`
- `rawPreview`
- `rawPreviewPath`

`rawPreview is capped at 16 KiB`.

That makes the JSONL file the durable source of truth for invalid candidate inspection, while `llm-provider-status.json` remains a mutable status snapshot that may be overwritten by later commands.

## Status Details

When candidate validation fails, runner status details include the invalid-attempt history and the last validation error. The status file can be replaced by a later run, so use the JSONL history for full inspection of prior bad outputs.

Provider failures are different: they return a proposal failure reason, stop the attempt loop immediately, and do not emit invalid-response rows.

## Recommended Local LLM Setting

For local or free models, set `provider.maxCandidateAttempts` to 2 or 3. That gives the parser/schema retry path room to recover from occasional malformed output without turning the lane into a long retry loop.

For stable models, keep the default one attempt.
