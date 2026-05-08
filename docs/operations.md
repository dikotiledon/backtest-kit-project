# Operations

## Safety

This page is docs only. It does **not** change Windows Task Scheduler.
The only scripts that touch real scheduled tasks are the install/remove wrappers, and only when you run them manually:

- `scripts/ops/install-pine-autoresearch-tasks.ps1`
- `scripts/ops/remove-pine-autoresearch-tasks.ps1`

Use `-WhatIf` first when you want a preview.

Do not enable, disable, or trigger real Windows scheduled tasks from automation without explicit operator approval.

## Scheduled task wrappers

Task prefix default: `BacktestKit-Pine`

| Task | Wrapper | npm script | Notes |
|---|---|---|---|
| Micro | `scripts/ops/pine-autoresearch-micro.ps1` | `npm run pine:autoresearch:micro` | cycle, profile `micro` |
| Full | `scripts/ops/pine-autoresearch-full.ps1` | `npm run pine:autoresearch` | full cycle |
| Digest | `scripts/ops/pine-autoresearch-digest.ps1` | `npm run pine:autoresearch:digest` | digest only |
| Autopromote | `scripts/ops/pine-autoresearch-autopromote.ps1` | `npm run pine:autoresearch:autopromote` | queued promotion only |

## Install / remove

Preview only:
```powershell
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -WhatIf
pwsh -NoProfile -File .\scripts\ops\remove-pine-autoresearch-tasks.ps1 -WhatIf
```

Recommended production shape after scheduler hardening is **Full + Digest**. Keep **Micro** manual-only unless you are intentionally smoke testing the scheduler path.

Before enabling or triggering scheduled Full, verify pinned dataset/cache coverage and scheduler lock health:
```powershell
npm run pine:dataset:verify
npm run pine:ops:scheduler-health
```

If health reports `status=stale`, reclaim only after confirming the owner process is dead:
```powershell
npm run pine:ops:scheduler-health -- -Reclaim
```

Install production Full + Digest cadence:
```powershell
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -DisableMicro
```

Full-only shape:
```powershell
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -DisableMicro -DisableDigest -FullEveryHours 1
```

Opt into autopromote for production Full + Digest cadence while keeping Micro manual-only:
```powershell
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -DisableMicro -EnableAutopromote
```

`-EnableAutopromote` alone uses the installer default shape (Micro + Digest + Autopromote), not the production Full + Digest cadence.

Remove all default tasks:
```powershell
pwsh -NoProfile -File .\scripts\ops\remove-pine-autoresearch-tasks.ps1
```

## Manual runs

Validate the Full wrapper manually before enabling scheduler cadence:
```powershell
.\scripts\ops\pine-autoresearch-full.ps1 -RepoRoot D:\Code\Experiment\backtest-kit-project
npm run pine:ops:scheduler-health
```

Direct wrapper runs:
```powershell
pwsh -NoProfile -File .\scripts\ops\pine-autoresearch-micro.ps1 -RepoRoot .
pwsh -NoProfile -File .\scripts\ops\pine-autoresearch-full.ps1 -RepoRoot .
pwsh -NoProfile -File .\scripts\ops\pine-autoresearch-digest.ps1 -RepoRoot .
pwsh -NoProfile -File .\scripts\ops\pine-autoresearch-autopromote.ps1 -RepoRoot .
```

Dry-run wrapper output:
```powershell
pwsh -NoProfile -File .\scripts\ops\pine-autoresearch-micro.ps1 -RepoRoot . -DryRun
```

Raw CLI, if you want flags:
```powershell
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --force-cycle
node scripts/pine-autoresearch.mjs digest --config config/pine-autoresearch.default.json
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --run-id <runId>
node scripts/pine-autoresearch.mjs promote --config config/pine-autoresearch.default.json --run-id <runId> --force
node scripts/pine-autoresearch.mjs autopromote --config config/pine-autoresearch.default.json
```

`--run-id` targets an exact manifest in `pine/autoresearch/<matrix>/manifests/`.
`--force-cycle` skips the pending-promotion guard.
`--force` overrides a non-promote manifest for manual promote.

## Overlap and lock layers

Three guards exist:

1. **Task Scheduler**
   - installer attempts to set `MultipleInstances=IgnoreNew` and warns if unavailable/fails
   - scheduler ignores a new trigger while the same task is already running

2. **Wrapper scheduler lock**
   - file: `tmp/pine-autoresearch-locks/scheduler.lock`
   - common wrapper: `scripts/ops/pine-autoresearch-run.ps1`
   - blocks overlapping wrapper runs across micro/full/digest/autopromote
   - stale reclaim happens after 12h when `pid` + `startedAt` show the process is dead
   - fresh/active locks skip reclaim

3. **JS canonical lock**
   - file: `state/autoresearch.lock.json`
   - used by `cycle`, `promote`, and `autopromote`
   - owner fields: token, pid, command, profile, acquiredAt, staleAfterMs, cwd
   - reclaim uses a `.reclaim` guard file so only one process can recover a stale lock at once
   - stale owners can be reclaimed only when the process is dead and the snapshot still matches

Overlap behavior:
- fresh wrapper lock -> task skips with `skipped: scheduler lock exists`
- busy JS lock -> command skips with `reason=locked`
- stale wrapper lock -> wrapper logs `scheduler lock stale; reclaiming ...`
- stale JS lock -> next eligible command reclaims it

Use scheduler health before production changes so operators can distinguish `busy`, `stale`, and `reclaimed` lock states:
```powershell
npm run pine:ops:scheduler-health
npm run pine:ops:scheduler-health -- -Reclaim
```

Micro runs every 15m by default, so it can collide with or add noisy skips while Full is still running. Production scheduler cadence should favor Full + Digest and leave Micro for intentional smoke tests.

## Logs and dry-run

Logs land in:

```text
tmp/pine-autoresearch-logs/
```

Each run writes a timestamped log file named like:
`<TaskName>-YYYY-MM-DDTHH-mm-ss.log`

`-DryRun` on `pine-autoresearch-run.ps1`:
- prints repo / command / log / lock
- does **not** acquire locks
- does **not** run the command
- leaves no scheduler lock behind

## Troubleshooting

- **`skipped: scheduler lock exists`**
  - another wrapper is running, or a fresh lock is still valid
  - if the lock file is older than 12h and the PID is dead, rerun the wrapper once and it will reclaim

- **`skip=lock-busy`**
  - wrapper lock already held by another task
  - expected overlap protection

- **`[autoresearch] cycle=skipped reason=pending_promotion`**
  - queue has a pending promotion
  - run `promote` or `autopromote`, or rerun `cycle --force-cycle` only if you mean to ignore the queue

- **`promote=noop`**
  - latest manifest is not promotable, or champion already matches the challenger

- **`autopromote=noop` / `reason=locked` / `reason=blocked`**
  - queue empty, gates failed, stale queued item, or JS lock busy
  - inspect latest manifest, queue status, and the current champion before retrying

- **stale JS lock file**
  - inspect `state/autoresearch.lock.json`
  - do not delete it unless you know the owner process is gone and the snapshot is stale

## Manual `schtasks` commands

```powershell
schtasks /Query /TN BacktestKit-Pine-Micro /V /FO LIST
schtasks /Run /TN BacktestKit-Pine-Micro
schtasks /End /TN BacktestKit-Pine-Micro
schtasks /Delete /F /TN BacktestKit-Pine-Micro
```

Use the same pattern for `Full`, `Digest`, and `Autopromote`.
