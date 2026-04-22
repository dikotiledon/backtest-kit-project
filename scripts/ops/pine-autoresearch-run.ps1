param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [string]$Command,

  [string]$RepoRoot,
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
Push-Location $RepoRoot
try {
  if ($DryRun) {
    Write-Host "[dry-run] repo=$RepoRoot"
    Write-Host "[dry-run] command=$Command"
    Write-Host "[dry-run] log=$logPath"
    exit 0
  }

  Write-Host "[$TaskName] repo=$RepoRoot"
  Write-Host "[$TaskName] command=$Command"
  Write-Host "[$TaskName] log=$logPath"

  $output = & pwsh -NoProfile -Command $Command 2>&1
  $output | Tee-Object -FilePath $logPath

  if ($LASTEXITCODE -ne 0) {
    throw "Task $TaskName failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
