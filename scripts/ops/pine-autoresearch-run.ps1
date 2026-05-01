param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [string]$Command,

  [string]$RepoRoot,
  [string]$LockName = 'Global\BacktestKit-Pine-Autoresearch',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$logDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-logs'
$logPath = Join-Path $logDir ("$TaskName-$timestamp.log")
$commandScriptPath = Join-Path $logDir ("$TaskName-$timestamp-command.ps1")
$lockStaleAfter = [TimeSpan]::FromHours(12)
$pwshPath = (Get-Process -Id $PID).Path
if (-not $pwshPath) {
  $pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
}

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

if ($DryRun) {
  Write-Host "[dry-run] repo=$RepoRoot"
  Write-Host "[dry-run] command=$Command"
  Write-Host "[dry-run] log=$logPath"
  Write-Host "[dry-run] lock=$LockName"
  exit 0
}

$lockDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-locks'
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$lockFile = Join-Path $lockDir 'scheduler.lock'
$lockStream = $null
$mutex = $null
$hasLock = $false
$locationPushed = $false
try {
  $lockStream = Acquire-SchedulerLock -LockFile $lockFile -TaskName $TaskName -StaleAfter $lockStaleAfter
  if (-not $lockStream) {
    return
  }

  try {
    $payload = [System.Text.Encoding]::UTF8.GetBytes("task=$TaskName`npid=$PID`nstartedAt=$((Get-Date).ToString('o'))`n")
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
    $mutex = [System.Threading.Mutex]::new($false, $LockName)
    $hasLock = $mutex.WaitOne(0, $false)
    if (-not $hasLock) {
      "[$TaskName] skip=lock-busy lock=$LockName" | Tee-Object -FilePath $logPath
      return
    }

    Write-Host "[$TaskName] repo=$RepoRoot"
    Write-Host "[$TaskName] command=$Command"
    Write-Host "[$TaskName] log=$logPath"
    Write-Host "[$TaskName] lock=$LockName"

    Set-Content -LiteralPath $commandScriptPath -Value $Command -Encoding UTF8
    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = $pwshPath
    [void]$processInfo.ArgumentList.Add('-NoProfile')
    [void]$processInfo.ArgumentList.Add('-File')
    [void]$processInfo.ArgumentList.Add($commandScriptPath)
    $processInfo.WorkingDirectory = (Get-Location).Path
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.UseShellExecute = $false

    $childProcess = [System.Diagnostics.Process]::Start($processInfo)
    $stdout = $childProcess.StandardOutput.ReadToEnd()
    $stderr = $childProcess.StandardError.ReadToEnd()
    $childProcess.WaitForExit()
    $childExitCode = $childProcess.ExitCode
    $output = ($stdout, $stderr -join '')
    if (-not [string]::IsNullOrEmpty($output)) {
      $output | Tee-Object -FilePath $logPath
    } else {
      Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8
    }

    if ($childExitCode -ne 0) {
      throw "Task $TaskName failed with exit code $childExitCode"
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
