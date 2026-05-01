param(
  [string]$RepoRoot,
  [string]$ConfigPath = './config/pine-autoresearch-llm.default.json',
  [switch]$Enable,
  [switch]$DryRun,
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
$isDryRun = $DryRun -or $WhatIf
$pwshPath = (Get-Process -Id $PID).Path
if (-not $pwshPath) {
  $pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
}
$runScript = Join-Path $PSScriptRoot 'pine-autoresearch-llm-run.ps1'
$cliScript = Join-Path $RepoRoot 'scripts\pine-autoresearch-llm.mjs'
$scheduledEnabled = $false
if ($null -ne $config.scheduled -and $null -ne $config.scheduled.enabled) {
  $scheduledEnabled = [bool]$config.scheduled.enabled
}

if (-not $Enable -and -not $scheduledEnabled) {
  throw 'refusing to install LLM autoresearch tasks: pass -Enable or set scheduled.enabled=true in the config'
}

function Register-Task($TaskName, $ScheduleArgs, $TaskKind) {
  $taskName = $TaskName
  $taskCommand = if ($TaskKind -eq 'run') {
    "`"$pwshPath`" -NoProfile -File `"$runScript`" -RepoRoot `"$RepoRoot`" -ConfigPath `"$ConfigPath`""
  } else {
    "`"$pwshPath`" -NoProfile -Command `"Set-Location -LiteralPath '$RepoRoot'; node '$cliScript' digest --config '$ConfigPath'`""
  }
  $args = @('/Create', '/F', '/TN', $taskName, '/TR', $taskCommand) + $ScheduleArgs
  $preview = 'schtasks ' + ($args -join ' ')

  if ($isDryRun) {
    Write-Host "[dry-run] $preview"
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

$SchedulableProviderModes = @('cli', 'openai-chat-completions', 'openai-responses')
$providerMode = [string]$config.provider.mode
if (-not ($SchedulableProviderModes -contains $providerMode)) {
  throw "refusing to install LLM autoresearch tasks: provider mode '$providerMode' is not schedulable; supported modes: $($SchedulableProviderModes -join ', ')"
}

Register-Task 'BacktestKit-Pine-LLM-Run' @('/SC', 'MINUTE', '/MO', '30', '/ST', '00:00') 'run'
Register-Task 'BacktestKit-Pine-LLM-Digest' @('/SC', 'HOURLY', '/MO', '6', '/ST', '00:10') 'digest'
