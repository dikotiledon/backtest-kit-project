param(
  [string]$RepoRoot,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$logDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-logs'
$logPath = Join-Path $logDir ("pine-autoresearch-force-cycle-$timestamp.log")
$viewerScriptPath = Join-Path $logDir ("pine-autoresearch-force-cycle-$timestamp-viewer.ps1")
$runScript = Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1'
$pwshPath = (Get-Process -Id $PID).Path
if (-not $pwshPath) {
  $pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$command = 'npm run pine:autoresearch -- --force-cycle'

if ($DryRun) {
  Write-Host "[dry-run] repo=$RepoRoot"
  Write-Host "[dry-run] command=$command"
  Write-Host "[dry-run] log=$logPath"
  Write-Host "[dry-run] viewer=$viewerScriptPath"
  exit 0
}

Set-Content -LiteralPath $logPath -Value "[pine-autoresearch-force-cycle] starting...`nrepo=$RepoRoot`ncommand=$command`n" -Encoding UTF8

$viewerScript = @"
`$Host.UI.RawUI.WindowTitle = 'BacktestKit Pine Autoresearch Force Cycle Log'
Write-Host '[pine-autoresearch-force-cycle] watching log:'
Write-Host '$logPath'
Write-Host ''
while (-not (Test-Path -LiteralPath '$logPath')) { Start-Sleep -Seconds 1 }
Get-Content -LiteralPath '$logPath' -Wait -Tail 80
"@
Set-Content -LiteralPath $viewerScriptPath -Value $viewerScript -Encoding UTF8
Start-Process -FilePath $pwshPath -ArgumentList @('-NoProfile', '-File', $viewerScriptPath) -WorkingDirectory $RepoRoot

& $runScript -TaskName 'pine-autoresearch-force-cycle' -Command $command -RepoRoot $RepoRoot -StreamOutput
exit $LASTEXITCODE
