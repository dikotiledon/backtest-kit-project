param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$names = @(
  'BacktestKit-Pine-LLM-Run',
  'BacktestKit-Pine-LLM-Digest'
)

foreach ($taskName in $names) {
  $preview = "schtasks /Delete /F /TN $taskName"
  if ($WhatIf) {
    Write-Host "[whatif] $preview"
    continue
  }

  & schtasks /Delete /F /TN $taskName | Out-Host
}
