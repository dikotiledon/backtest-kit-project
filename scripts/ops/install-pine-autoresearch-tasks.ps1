param(
  [string]$RepoRoot,
  [string]$TaskPrefix = 'BacktestKit-Pine',
  [string]$MicroStart = '00:05',
  [string]$FullStart = '01:00',
  [int]$FullEveryHours = 1,
  [string]$DigestStart = '08:10',
  [string]$AutopromoteStart = '08:20',
  [switch]$EnableFull,
  [switch]$EnableAutopromote,
  [switch]$DisableMicro,
  [switch]$DisableDigest,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$pwshPath = (Get-Command pwsh).Source
$microScript = Join-Path $PSScriptRoot 'pine-autoresearch-micro.ps1'
$fullScript = Join-Path $PSScriptRoot 'pine-autoresearch-full.ps1'
$digestScript = Join-Path $PSScriptRoot 'pine-autoresearch-digest.ps1'
$autopromoteScript = Join-Path $PSScriptRoot 'pine-autoresearch-autopromote.ps1'

function Register-Task($Name, $ScheduleArgs, $ScriptPath) {
  $taskName = "$TaskPrefix-$Name"
  $taskCommand = "`"$pwshPath`" -NoProfile -File `"$ScriptPath`" -RepoRoot `"$RepoRoot`""
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
}

if (-not $DisableMicro) {
  Register-Task 'Micro' @('/SC', 'MINUTE', '/MO', '15', '/ST', $MicroStart) $microScript
}

if (-not $DisableDigest) {
  Register-Task 'Digest' @('/SC', 'DAILY', '/ST', $DigestStart) $digestScript
}

if ($EnableFull) {
  if ($FullEveryHours -lt 1) {
    throw 'FullEveryHours must be >= 1'
  }
  Register-Task 'Full' @('/SC', 'HOURLY', '/MO', "$FullEveryHours", '/ST', $FullStart) $fullScript
}

if ($EnableAutopromote) {
  Register-Task 'Autopromote' @('/SC', 'DAILY', '/ST', $AutopromoteStart) $autopromoteScript
}
