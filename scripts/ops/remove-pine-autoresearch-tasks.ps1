param(
  [string]$TaskPrefix = 'BacktestKit-Pine',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$names = @(
  "$TaskPrefix-Micro",
  "$TaskPrefix-Full",
  "$TaskPrefix-Digest",
  "$TaskPrefix-Autopromote"
)

foreach ($taskName in $names) {
  $preview = "schtasks /Delete /F /TN $taskName"
  if ($WhatIf) {
    Write-Host "[whatif] $preview"
    continue
  }

  & schtasks /Delete /F /TN $taskName | Out-Host
}
