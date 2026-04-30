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

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

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
  try {
    $lockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    if ($_.Exception.HResult -eq -2147024816) {
      Write-Host "[$TaskName] skipped: scheduler lock exists at $lockFile"
      return
    }

    throw
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

    $output = & pwsh -NoProfile -Command $Command 2>&1
    $output | Tee-Object -FilePath $logPath

    if ($LASTEXITCODE -ne 0) {
      throw "Task $TaskName failed with exit code $LASTEXITCODE"
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
