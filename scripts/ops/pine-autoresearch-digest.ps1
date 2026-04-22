param(
  [string]$RepoRoot,
  [switch]$DryRun
)

& (Join-Path $PSScriptRoot 'pine-autoresearch-run.ps1') `
  -TaskName 'pine-autoresearch-digest' `
  -Command 'npm run pine:autoresearch:digest' `
  -RepoRoot $RepoRoot `
  -DryRun:$DryRun
