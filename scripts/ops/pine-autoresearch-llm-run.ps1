param(
  [string]$RepoRoot,
  [string]$ConfigPath = './config/pine-autoresearch-llm.default.json',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if (-not [System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath = Join-Path $RepoRoot $ConfigPath
}

$timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$logDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-llm-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-ProcessAlive {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return $false
  }

  try {
    Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-SchedulerLockPayload {
  param([string]$LockPath)

  try {
    $raw = Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop
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

function Test-SchedulerLockStale {
  param(
    [string]$LockPath,
    [hashtable]$Payload,
    [TimeSpan]$StaleAfter
  )

  try {
    $lockInfo = Get-Item -LiteralPath $LockPath -ErrorAction Stop
  } catch {
    return $false
  }

  if ($Payload -and $Payload.ContainsKey('pid') -and $Payload.ContainsKey('startedAt')) {
    $startedAt = $null
    $pidValue = $null
    try {
      $startedAt = [DateTimeOffset]::Parse($Payload.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
    } catch {
      $startedAt = $null
    }

    try {
      $pidValue = [int]$Payload.pid
    } catch {
      $pidValue = $null
    }

    if ($startedAt -and $pidValue) {
      $age = (Get-Date).ToUniversalTime() - $startedAt.UtcDateTime
      $pidAlive = Test-ProcessAlive -ProcessId $pidValue
      return ($age -ge $StaleAfter) -and (-not $pidAlive)
    }
  }

  $fileAge = (Get-Date) - $lockInfo.LastWriteTime
  return $fileAge -ge $StaleAfter
}

function Acquire-SchedulerLock {
  param(
    [string]$LockFile,
    [string]$TaskName,
    [TimeSpan]$StaleAfter
  )

  $reclaimed = $false

  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    try {
      return [System.IO.File]::Open($LockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] {
      if ($_.Exception.HResult -ne -2147024816) {
        throw
      }

      if (-not (Test-Path -LiteralPath $LockFile)) {
        continue
      }

      $payload = Get-SchedulerLockPayload -LockPath $LockFile
      $canReclaim = Test-SchedulerLockStale -LockPath $LockFile -Payload $payload -StaleAfter $StaleAfter
      if (-not $canReclaim -or $reclaimed) {
        Write-Host "[$TaskName] skipped: scheduler lock exists at $LockFile"
        return $null
      }

      Write-Host "[$TaskName] scheduler lock stale; reclaiming $LockFile"
      Remove-Item -Force $LockFile -ErrorAction SilentlyContinue
      $reclaimed = $true
    }
  }

  Write-Host "[$TaskName] skipped: scheduler lock exists at $LockFile"
  return $null
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "missing config: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$matrixId = [string]$config.matrixId
if ([string]::IsNullOrWhiteSpace($matrixId)) {
  throw 'missing matrixId in config'
}

$taskName = 'BacktestKit-Pine-LLM-Run'
$command = 'node ./scripts/pine-autoresearch-llm.mjs run --config ./config/pine-autoresearch-llm.default.json --scheduled'
$lockDir = Join-Path (Join-Path $RepoRoot 'pine\autoresearch-llm') "llm-$matrixId\state"
$lockFile = Join-Path $lockDir 'llm-scheduler.lock'
$mutexName = "Global\BacktestKit-Pine-LLM-Autoresearch-$matrixId"
$lockStaleAfter = [TimeSpan]::FromHours(12)
$logPath = Join-Path $logDir ("$taskName-$timestamp.log")

New-Item -ItemType Directory -Force -Path $lockDir | Out-Null

if ([string]$config.provider.mode -eq 'openclaw') {
  Write-Error "[$taskName] refused: provider=openclaw"
  exit 1
}

if ($DryRun) {
  Write-Host "[dry-run] repo=$RepoRoot"
  Write-Host "[dry-run] config=$ConfigPath"
  Write-Host "[dry-run] matrixId=$matrixId"
  Write-Host "[dry-run] lock=$lockFile"
  Write-Host "[dry-run] mutex=$mutexName"
  Write-Host "[dry-run] command=$command"
  exit 0
}

$lockStream = $null
$mutex = $null
$hasLock = $false
$locationPushed = $false
try {
  $lockStream = Acquire-SchedulerLock -LockFile $lockFile -TaskName $taskName -StaleAfter $lockStaleAfter
  if (-not $lockStream) {
    return
  }

  try {
    $payload = [System.Text.Encoding]::UTF8.GetBytes("task=$taskName`npid=$PID`nstartedAt=$((Get-Date).ToString('o'))`n")
    $lockStream.Write($payload, 0, $payload.Length)
    $lockStream.Flush()
  } catch {
    if ($lockStream) {
      try {
        $lockStream.Close()
      } catch {
      }
      $lockStream = $null
    }
    Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    throw
  }

  Push-Location $RepoRoot
  $locationPushed = $true
  try {
    $mutex = [System.Threading.Mutex]::new($false, $mutexName)
    $hasLock = $mutex.WaitOne(0, $false)
    if (-not $hasLock) {
      "[$taskName] skip=lock-busy lock=$mutexName" | Tee-Object -FilePath $logPath
      return
    }

    Write-Host "[$taskName] repo=$RepoRoot"
    Write-Host "[$taskName] config=$ConfigPath"
    Write-Host "[$taskName] matrixId=$matrixId"
    Write-Host "[$taskName] command=$command"
    Write-Host "[$taskName] log=$logPath"
    Write-Host "[$taskName] lock=$mutexName"

    $output = & pwsh -NoProfile -Command $command 2>&1
    $output | Tee-Object -FilePath $logPath

    if ($LASTEXITCODE -ne 0) {
      throw "Task $taskName failed with exit code $LASTEXITCODE"
    }
  } finally {
    if ($mutex) {
      if ($hasLock) {
        $mutex.ReleaseMutex() | Out-Null
      }
      $mutex.Dispose()
    }
    if ($locationPushed) {
      Pop-Location
    }
  }
} finally {
  if ($lockStream) {
    try {
      $lockStream.Close()
    } finally {
      Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    }
  }
}
