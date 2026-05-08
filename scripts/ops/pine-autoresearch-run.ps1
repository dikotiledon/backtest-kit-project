param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $false)]
  [string]$Command,

  [Parameter(Mandatory = $false)]
  [string]$CommandPath,

  [string]$RepoRoot,
  [string]$LockName = 'Global\BacktestKit-Pine-Autoresearch',
  [switch]$DryRun,
  [switch]$StreamOutput,
  [int]$TimeoutSeconds = 5400,

  [Parameter(Mandatory = $false)]
  [switch] $RequireManifest,

  [Parameter(Mandatory = $false)]
  [string] $ManifestRoot,

  [Parameter(Mandatory = $false)]
  [string] $ExpectedRunId
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($Command)) {
  if ([string]::IsNullOrWhiteSpace($CommandPath)) {
    Write-Error "Command or CommandPath is required" -ErrorAction Continue
    exit 64
  }

  $escapedCommandPath = $CommandPath.Replace("'", "''")
  $Command = "& '$escapedCommandPath'"
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
    # The lock timestamp is written when the already-running scheduler process acquires
    # the file lock. A valid owner can therefore start well before StartedAt. Treat it
    # as stale only when the current process started after the lock timestamp, which
    # indicates PID reuse.
    return $processStart.UtcDateTime -le $StartedAt.UtcDateTime.AddSeconds(5)
  } catch {
    return $true
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
      $ownerAlive = Test-ProcessOwnsLock -ProcessId $pidValue -StartedAt $startedAt
      return -not $ownerAlive
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
        $message = "[$TaskName] skipped: scheduler lock exists at $LockFile"
        Write-Host $message
        Add-Content -LiteralPath $logPath -Value $message
        return $null
      }

      $message = "[$TaskName] scheduler lock stale; reclaiming $LockFile"
      Write-Host $message
      Add-Content -LiteralPath $logPath -Value $message
      Remove-Item -Force $LockFile -ErrorAction SilentlyContinue
      $reclaimed = $true
    }
  }

  $message = "[$TaskName] skipped: scheduler lock exists at $LockFile"
  Write-Host $message
  Add-Content -LiteralPath $logPath -Value $message
  return $null
}

function Stop-ProcessTree {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$TaskName
  )

  if (-not $Process -or $Process.HasExited) {
    return
  }

  $pidValue = $Process.Id
  try {
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
      & taskkill /PID $pidValue /T /F | Out-Null
    } else {
      $Process.Kill($true)
    }
  } catch {
    try {
      $Process.Kill()
    } catch {
      Write-Warning "[$TaskName] failed to kill process ${pidValue}: $($_.Exception.Message)"
    }
  }

  try {
    $Process.WaitForExit(30000) | Out-Null
  } catch {
  }
}

function Invoke-LoggedCommand {
  param(
    [string]$PwshPath,
    [string]$CommandScriptPath,
    [string]$WorkingDirectory,
    [string]$LogPath,
    [string]$TaskName,
    [int]$TimeoutSeconds
  )

  $effectiveTimeoutSeconds = $TimeoutSeconds
  if ($effectiveTimeoutSeconds -le 0) {
    $effectiveTimeoutSeconds = 5400
  }
  $timeoutMs = [Math]::Min([int64]::MaxValue, [int64]$effectiveTimeoutSeconds * 1000)

  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $PwshPath
  [void]$processInfo.ArgumentList.Add('-NoProfile')
  [void]$processInfo.ArgumentList.Add('-File')
  [void]$processInfo.ArgumentList.Add($CommandScriptPath)
  $processInfo.WorkingDirectory = $WorkingDirectory
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.UseShellExecute = $false

  $childProcess = [System.Diagnostics.Process]::new()
  $childProcess.StartInfo = $processInfo
  $stdoutTask = $null
  $stderrTask = $null

  try {
    if (-not $childProcess.Start()) {
      throw "Failed to start task $TaskName child process"
    }

    $stdoutTask = $childProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $childProcess.StandardError.ReadToEndAsync()

    if (-not $childProcess.WaitForExit($timeoutMs)) {
      $timeoutMessage = "[$TaskName] timeout after ${effectiveTimeoutSeconds}s; killing process tree pid=$($childProcess.Id)"
      Write-Host $timeoutMessage
      Add-Content -LiteralPath $LogPath -Value $timeoutMessage
      Stop-ProcessTree -Process $childProcess -TaskName $TaskName
      return 124
    }

    $childProcess.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $output = ($stdout, $stderr -join '')
    if (-not [string]::IsNullOrEmpty($output)) {
      Set-Content -LiteralPath $LogPath -Value $output -Encoding UTF8
      Write-Host $output
    } else {
      Set-Content -LiteralPath $LogPath -Value '' -Encoding UTF8
    }
    return $childProcess.ExitCode
  } finally {
    $childProcess.Dispose()
  }
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
    if ($StreamOutput) {
      Write-Warning "[$TaskName] -StreamOutput is deprecated for scheduled runs; using concurrent captured logging instead."
    }

    $childExitCode = Invoke-LoggedCommand `
      -PwshPath $pwshPath `
      -CommandScriptPath $commandScriptPath `
      -WorkingDirectory (Get-Location).Path `
      -LogPath $logPath `
      -TaskName $TaskName `
      -TimeoutSeconds $TimeoutSeconds

    if ($childExitCode -ne 0) {
      throw "Task $TaskName failed with exit code $childExitCode"
    }

    if ($RequireManifest) {
      if ([string]::IsNullOrWhiteSpace($ManifestRoot) -or [string]::IsNullOrWhiteSpace($ExpectedRunId)) {
        Write-Error "RequireManifest needs ManifestRoot and ExpectedRunId" -ErrorAction Continue
        exit 64
      }

      $manifestPath = Join-Path $ManifestRoot (Join-Path "manifests" ("$ExpectedRunId.json"))
      $incompletePath = Join-Path $ManifestRoot (Join-Path "incomplete" ("$ExpectedRunId.json"))

      if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        if (Test-Path -LiteralPath $incompletePath) {
          Write-Error "autoresearch manifest missing; incomplete marker exists: $incompletePath" -ErrorAction Continue
        } else {
          Write-Error "autoresearch manifest missing and no incomplete marker exists: $manifestPath" -ErrorAction Continue
        }
        exit 65
      }

      $manifest = $null
      try {
        $manifestText = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($manifestText)) {
          Write-Error "autoresearch manifest is empty: $manifestPath" -ErrorAction Continue
          exit 66
        }
        $manifest = $manifestText | ConvertFrom-Json -ErrorAction Stop
      } catch {
        Write-Error "autoresearch manifest is malformed: $manifestPath ($($_.Exception.Message))" -ErrorAction Continue
        exit 66
      }

      if ($null -eq $manifest -or $manifest -is [array]) {
        Write-Error "autoresearch manifest must be a JSON object: $manifestPath" -ErrorAction Continue
        exit 66
      }

      if (-not ($manifest.PSObject.Properties.Name -contains 'runId') -or [string]::IsNullOrWhiteSpace([string]$manifest.runId)) {
        Write-Error "autoresearch manifest missing runId: $manifestPath" -ErrorAction Continue
        exit 66
      }

      if ([string]$manifest.runId -ne $ExpectedRunId) {
        Write-Error "autoresearch manifest runId mismatch: expected $ExpectedRunId got $($manifest.runId) at $manifestPath" -ErrorAction Continue
        exit 67
      }
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
