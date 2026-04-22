param(
  [string]$RepoRoot,
  [switch]$DryRun
)

& (Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1') `
  -TaskName 'pine-autoresearch-full' `
  -Command 'npm run pine:autoresearch' `
  -RepoRoot $RepoRoot `
  -DryRun:$DryRun
