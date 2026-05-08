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
$staleAfter = [TimeSpan]::FromHours($StaleAfterHours)

function Get-SchedulerLockPayload {
  param([string]$Path)

  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  } catch {
    return $null
  }

  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  try {
    return ConvertFrom-StringData -StringData $raw
  } catch {
    return $null
  }
}

function Test-ProcessOwnsLock {
  param(
    [int]$ProcessId,
    [DateTimeOffset]$StartedAt
  )

  if ($ProcessId -le 0) {
    return $false
  }

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

if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
  Write-Host "status=healthy reason=lock-missing lock=$lockPath"
  exit 0
}

$payload = Get-SchedulerLockPayload -Path $lockPath
$task = ''
$pidText = ''
$startedAt = $null
$pidValue = $null
$hasValidOwnerPayload = $false

if ($payload) {
  if ($payload.ContainsKey('task')) {
    $task = [string]$payload.task
  }
  if ($payload.ContainsKey('pid')) {
    $pidText = [string]$payload.pid
    try {
      $pidValue = [int]$payload.pid
    } catch {
      $pidValue = $null
    }
  }
  if ($payload.ContainsKey('startedAt')) {
    try {
      $startedAt = [DateTimeOffset]::Parse(
        [string]$payload.startedAt,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
      )
    } catch {
      $startedAt = $null
    }
  }
}

if ($null -ne $pidValue -and $pidValue -gt 0 -and $null -ne $startedAt) {
  $hasValidOwnerPayload = $true
}

$ownerAlive = $false
if ($hasValidOwnerPayload) {
  $ownerAlive = Test-ProcessOwnsLock -ProcessId $pidValue -StartedAt $startedAt
}

try {
  $lockInfo = Get-Item -LiteralPath $lockPath -ErrorAction Stop
} catch {
  Write-Host "status=healthy reason=lock-missing lock=$lockPath"
  exit 0
}

$fileAge = (Get-Date) - $lockInfo.LastWriteTime
$ageExpired = $fileAge -ge $staleAfter

if ($hasValidOwnerPayload -and $ownerAlive -and -not $ageExpired) {
  Write-Host "status=busy reason=owner-active ownerAlive=$ownerAlive task=$task pid=$pidText lock=$lockPath"
  exit 1
}

$reason = 'owner-dead'
if ($ageExpired) {
  $reason = 'age-expired'
}

if (-not $Reclaim) {
  Write-Host "status=stale action=inspect-only reason=$reason ownerAlive=$ownerAlive task=$task pid=$pidText lock=$lockPath"
  exit 2
}

try {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
} catch {
  $message = ($_.Exception.Message -replace "[\r\n]+", ' ')
  Write-Host "status=error reason=reclaim-failed message=$message lock=$lockPath"
  exit 3
}

Write-Host "status=reclaimed reason=$reason ownerAlive=$ownerAlive task=$task pid=$pidText lock=$lockPath"
exit 0
