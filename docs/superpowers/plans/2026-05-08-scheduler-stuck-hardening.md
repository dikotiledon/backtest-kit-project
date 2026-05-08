# Scheduler Stuck Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe scheduler health/reclaim tooling and safer scheduler-install/run guidance so stale locks do not masquerade as stuck micro/full cycles.

**Architecture:** Keep real scheduled-task changes operator-gated. Add a PowerShell health script that inspects `tmp/pine-autoresearch-locks/scheduler.lock`, classifies owner-alive/dead/stale states, and optionally removes only reclaimable locks. Extend existing scheduler tests with TDD coverage, then document the recommended Full + Digest scheduler posture and manual validation flow.

**Tech Stack:** PowerShell 7 wrappers, Node.js test runner (`node --test`), existing Backtest Kit npm scripts.

---

## Files

- Create: `scripts/ops/pine-autoresearch-scheduler-health.ps1` — safe health/reclaim command for scheduler lock state.
- Modify: `tests/pine-autoresearch.test.mjs` — tests for health command parse, inspect, no-op, and reclaim behavior.
- Modify: `package.json` — add npm ops script for health check.
- Modify: `docs/operations.md` and/or `docs/2026-04-21-pine-autoresearch-cron.md` — document Full + Digest production posture, Micro manual-only recommendation, and approval gate before enabling real scheduler.

## Task 1: Scheduler health/reclaim command

**Files:**
- Create: `scripts/ops/pine-autoresearch-scheduler-health.ps1`
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Add tests near existing `pine-autoresearch-run.ps1` scheduler-lock tests in `tests/pine-autoresearch.test.mjs`:

```js
test('pine-autoresearch-scheduler-health.ps1 reports missing lock as healthy', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-missing-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const result = await runPwsh([scriptPath, '-RepoRoot', tempRoot]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=healthy/);
  assert.match(result.stdout, /reason=lock-missing/);
});

test('pine-autoresearch-scheduler-health.ps1 reports fresh live lock without deleting it', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-live-'));
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  await fs.mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, 'scheduler.lock');
  await fs.writeFile(lockPath, [
    'task=live-check',
    `pid=${process.pid}`,
    `startedAt=${new Date().toISOString()}`,
    '',
  ].join('\n'));

  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const result = await runPwsh([scriptPath, '-RepoRoot', tempRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status=busy/);
  assert.match(result.stdout, /ownerAlive=True/);
  assert.notEqual(await readIfExists(lockPath), null);
});

test('pine-autoresearch-scheduler-health.ps1 reclaims dead-owner stale lock only with Reclaim', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-reclaim-'));
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  await fs.mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, 'scheduler.lock');
  await fs.writeFile(lockPath, [
    'task=dead-check',
    'pid=99999999',
    `startedAt=${new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()}`,
    '',
  ].join('\n'));

  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const dry = await runPwsh([scriptPath, '-RepoRoot', tempRoot]);
  assert.equal(dry.status, 2);
  assert.match(dry.stdout, /status=stale/);
  assert.match(dry.stdout, /action=inspect-only/);
  assert.notEqual(await readIfExists(lockPath), null);

  const reclaimed = await runPwsh([scriptPath, '-RepoRoot', tempRoot, '-Reclaim']);
  assert.equal(reclaimed.status, 0);
  assert.match(reclaimed.stdout, /status=reclaimed/);
  assert.match(reclaimed.stdout, /reason=owner-dead/);
  assert.equal(await readIfExists(lockPath), null);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/pine-autoresearch.test.mjs --test-name-pattern "scheduler-health"
```

Expected: FAIL because `scripts/ops/pine-autoresearch-scheduler-health.ps1` does not exist.

- [ ] **Step 3: Implement minimal PowerShell command**

Create `scripts/ops/pine-autoresearch-scheduler-health.ps1`:

```powershell
param(
  [string]$RepoRoot,
  [switch]$Reclaim,
  [int]$StaleAfterHours = 12
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$lockPath = Join-Path $RepoRoot 'tmp\pine-autoresearch-locks\scheduler.lock'

function Read-LockPayload {
  param([string]$Path)
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ConvertFrom-StringData -StringData $raw
  } catch {
    return $null
  }
}

function Test-OwnerAlive {
  param(
    [int]$ProcessId,
    [DateTimeOffset]$StartedAt
  )
  if ($ProcessId -le 0) { return $false }
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return $false
  }
  try {
    $processStart = [DateTimeOffset]$process.StartTime.ToUniversalTime()
    return $processStart.UtcDateTime -le $StartedAt.UtcDateTime.AddSeconds(5)
  } catch {
    return $true
  }
}

if (-not (Test-Path -LiteralPath $lockPath)) {
  Write-Host "status=healthy reason=lock-missing lock=$lockPath"
  exit 0
}

$payload = Read-LockPayload -Path $lockPath
$task = if ($payload -and $payload.ContainsKey('task')) { $payload.task } else { '' }
$pidValue = $null
$startedAt = $null
if ($payload -and $payload.ContainsKey('pid')) {
  try { $pidValue = [int]$payload.pid } catch { $pidValue = $null }
}
if ($payload -and $payload.ContainsKey('startedAt')) {
  try { $startedAt = [DateTimeOffset]::Parse($payload.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind) } catch { $startedAt = $null }
}

$ownerAlive = $false
if ($pidValue -and $startedAt) {
  $ownerAlive = Test-OwnerAlive -ProcessId $pidValue -StartedAt $startedAt
}

$lockInfo = Get-Item -LiteralPath $lockPath -ErrorAction Stop
$fileAge = (Get-Date) - $lockInfo.LastWriteTime
$isAgeStale = $fileAge -ge [TimeSpan]::FromHours([Math]::Max(1, $StaleAfterHours))
$isDeadOwner = ($pidValue -and $startedAt -and -not $ownerAlive)
$isStale = $isDeadOwner -or $isAgeStale

if (-not $isStale) {
  Write-Host "status=busy reason=owner-active ownerAlive=$ownerAlive task=$task pid=$pidValue lock=$lockPath"
  exit 1
}

if (-not $Reclaim) {
  $reason = if ($isDeadOwner) { 'owner-dead' } else { 'age-expired' }
  Write-Host "status=stale action=inspect-only reason=$reason ownerAlive=$ownerAlive task=$task pid=$pidValue lock=$lockPath"
  exit 2
}

try {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
  $reason = if ($isDeadOwner) { 'owner-dead' } else { 'age-expired' }
  Write-Host "status=reclaimed reason=$reason ownerAlive=$ownerAlive task=$task pid=$pidValue lock=$lockPath"
  exit 0
} catch {
  Write-Host "status=error reason=reclaim-failed message=$($_.Exception.Message) lock=$lockPath"
  exit 3
}
```

- [ ] **Step 4: Add npm script**

Modify `package.json` scripts:

```json
"pine:ops:scheduler-health": "pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-scheduler-health.ps1"
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
npm test -- tests/pine-autoresearch.test.mjs --test-name-pattern "scheduler-health|pine-autoresearch-run.ps1"
```

Expected: PASS for scheduler health and existing wrapper tests.

- [ ] **Step 6: Commit**

```powershell
git add package.json scripts/ops/pine-autoresearch-scheduler-health.ps1 tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): add scheduler lock health check"
```

## Task 2: Scheduler operating posture docs and install guardrails

**Files:**
- Modify: `docs/operations.md`
- Modify: `docs/2026-04-21-pine-autoresearch-cron.md`
- Modify: `tests/pine-autoresearch.test.mjs` if docs/script behavior needs test coverage

- [ ] **Step 1: Add documentation for safe production posture**

Document these exact operator rules:

```markdown
### Recommended production cadence after scheduler hardening

Use Full + Digest for production scheduler cadence. Keep Micro manual-only unless intentionally smoke testing.

```powershell
pwsh -NoProfile -File .\scripts\ops\install-pine-autoresearch-tasks.ps1 -EnableFull -DisableMicro
```

Before enabling or triggering scheduled Full, verify cache and lock health:

```powershell
npm run pine:dataset:verify
npm run pine:ops:scheduler-health
```

If health reports `status=stale`, reclaim only after confirming the owner is dead:

```powershell
npm run pine:ops:scheduler-health -- -Reclaim
```

Manual wrapper validation before enabling scheduler:

```powershell
.\scripts\ops\pine-autoresearch-full.ps1 -RepoRoot D:\Code\Experiment\backtest-kit-project
npm run pine:ops:scheduler-health
```

Enable real Windows scheduled tasks only after wrapper validation finishes with no scheduler lock left behind.
```
```

- [ ] **Step 2: Mention explicit approval gate**

Add: "Do not enable, disable, or trigger real Windows scheduled tasks from automation without explicit operator approval."

- [ ] **Step 3: Run docs/search sanity**

Run:

```powershell
node -e "const fs=require('fs'); for (const f of ['docs/operations.md','docs/2026-04-21-pine-autoresearch-cron.md']) { const t=fs.readFileSync(f,'utf8'); if (!t.includes('pine:ops:scheduler-health')) throw new Error(f+' missing scheduler health docs'); } console.log('docs ok')"
```

Expected: `docs ok`.

- [ ] **Step 4: Commit**

```powershell
git add docs/operations.md docs/2026-04-21-pine-autoresearch-cron.md
git commit -m "docs(pine): document safe scheduler cadence"
```

## Final validation

Run:

```powershell
npm run test:pine:autoresearch:hardening
npm run pine:dataset:verify
npm run pine:ops:scheduler-health
```

Expected:
- hardening tests pass (`150/150` expected at current HEAD baseline)
- all dataset labs report `cacheComplete:true` and `missingCount:0`
- scheduler health reports either `status=healthy reason=lock-missing` in clean worktree or a nonzero stale/busy status with exact reason; do not reclaim real lock unless explicitly approved.
