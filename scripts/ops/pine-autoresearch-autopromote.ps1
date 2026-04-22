param(
  [string]$RepoRoot,
  [switch]$DryRun
)

& (Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1') `
  -TaskName 'pine-autoresearch-autopromote' `
  -Command 'npm run pine:autoresearch:autopromote' `
  -RepoRoot $RepoRoot `
  -DryRun:$DryRun
