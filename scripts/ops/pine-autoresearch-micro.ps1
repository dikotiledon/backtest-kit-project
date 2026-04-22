param(
  [string]$RepoRoot,
  [switch]$DryRun
)

& (Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1') `
  -TaskName 'pine-autoresearch-micro' `
  -Command 'npm run pine:autoresearch:micro' `
  -RepoRoot $RepoRoot `
  -DryRun:$DryRun
