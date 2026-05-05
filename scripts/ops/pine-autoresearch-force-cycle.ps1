param(
  [string]$RepoRoot,
  [switch]$DryRun,
  [int]$MaxAttempts = 3,
  [int]$RetryDelaySeconds = 90
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$runScript = Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1'
$command = 'npm run pine:autoresearch -- --force-cycle'
$taskName = 'pine-autoresearch-force-cycle'
$logDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-logs'

function Get-LatestForceCycleLog {
  if (-not (Test-Path -LiteralPath $logDir)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $logDir -File -Filter "$taskName-*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Test-LockSkipFromLog {
  param([string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $tail = Get-Content -LiteralPath $Path -Tail 120 -ErrorAction SilentlyContinue
  return ($tail -join "`n") -match 'cycle=skipped reason=locked|skip=lock-busy|skipped: scheduler lock exists'
}

if ($DryRun) {
  Write-Host "[dry-run] repo=$RepoRoot"
  Write-Host "[dry-run] command=$command"
  Write-Host "[dry-run] maxAttempts=$MaxAttempts"
  Write-Host "[dry-run] retryDelaySeconds=$RetryDelaySeconds"
  exit 0
}

if ($MaxAttempts -lt 1) { $MaxAttempts = 1 }
if ($RetryDelaySeconds -lt 5) { $RetryDelaySeconds = 5 }

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  Write-Host "[$taskName] attempt=$attempt/$MaxAttempts"

  & $runScript -TaskName $taskName -Command $command -RepoRoot $RepoRoot -StreamOutput
  $exitCode = $LASTEXITCODE

  $latestLog = Get-LatestForceCycleLog
  $lockSkipped = $false
  if ($latestLog) {
    $lockSkipped = Test-LockSkipFromLog -Path $latestLog.FullName
    Write-Host "[$taskName] log=$($latestLog.FullName)"
  }

  if ($exitCode -ne 0) {
    exit $exitCode
  }

  if (-not $lockSkipped) {
    Write-Host "[$taskName] done=success-no-lock-skip"
    exit 0
  }

  if ($attempt -lt $MaxAttempts) {
    Write-Host "[$taskName] lock-skip-detected retry-in=${RetryDelaySeconds}s"
    Start-Sleep -Seconds $RetryDelaySeconds
    continue
  }

  Write-Host "[$taskName] final=lock-skip-after-$MaxAttempts-attempts"
  exit 0
}
