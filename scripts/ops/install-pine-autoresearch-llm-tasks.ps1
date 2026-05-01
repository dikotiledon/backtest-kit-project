param(
  [string]$RepoRoot,
  [string]$ConfigPath = './config/pine-autoresearch-llm.default.json',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if (-not [System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath = Join-Path $RepoRoot $ConfigPath
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "missing config: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$pwshPath = (Get-Command pwsh).Source
$runScript = Join-Path $PSScriptRoot 'pine-autoresearch-llm-run.ps1'

function Register-Task($TaskName, $ScheduleArgs, $ScriptPath) {
  $taskName = $TaskName
  $taskCommand = if ($ScriptPath.EndsWith('.ps1')) {
    "`"$pwshPath`" -NoProfile -File `"$ScriptPath`" -RepoRoot `"$RepoRoot`" -ConfigPath `"./config/pine-autoresearch-llm.default.json`""
  } else {
    "`"$pwshPath`" -NoProfile -Command `"node ./scripts/pine-autoresearch-llm.mjs digest --config ./config/pine-autoresearch-llm.default.json`""
  }
  $args = @('/Create', '/F', '/TN', $taskName, '/TR', $taskCommand) + $ScheduleArgs
  $preview = 'schtasks ' + ($args -join ' ')

  if ($WhatIf) {
    Write-Host "[whatif] $preview"
    return
  }

  Write-Host "[create] $taskName"
  & schtasks @args | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create task $taskName"
  }

  try {
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
    Set-ScheduledTask -TaskName $taskName -Settings $settings | Out-Null
  } catch {
    Write-Warning "Could not set MultipleInstances=IgnoreNew for ${taskName}: $($_.Exception.Message)"
  }
}

if ([string]$config.provider.mode -eq 'openclaw') {
  Write-Warning '[refuse] provider=openclaw; skipping BacktestKit-Pine-LLM-Run'
} else {
  Register-Task 'BacktestKit-Pine-LLM-Run' @('/SC', 'MINUTE', '/MO', '30', '/ST', '00:00') $runScript
}

Register-Task 'BacktestKit-Pine-LLM-Digest' @('/SC', 'HOURLY', '/MO', '6', '/ST', '00:10') 'node ./scripts/pine-autoresearch-llm.mjs digest --config ./config/pine-autoresearch-llm.default.json'
