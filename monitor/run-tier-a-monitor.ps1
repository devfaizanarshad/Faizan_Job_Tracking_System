param(
  [switch]$Force,
  [ValidateSet('MANUAL','SCHEDULED','TEST')]
  [string]$Mode = 'MANUAL'
)

$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'Set PGPASSWORD in the process environment. Credentials are intentionally not stored in this project.' }
if (-not $env:PGDATABASE) { $env:PGDATABASE = 'faizan_employer_intelligence' }
if (-not $env:PGUSER) { $env:PGUSER = 'postgres' }

Push-Location $PSScriptRoot
try {
  $monitorArgs = @('run-monitor.js', '--tiers=A', "--mode=$Mode")
  if ($Force) { $monitorArgs += '--force' }
  & node @monitorArgs
  if ($LASTEXITCODE -ne 0) { throw "Monitoring failed with exit code $LASTEXITCODE" }
  & node 'generate-phase2b-report.js'
  if ($LASTEXITCODE -ne 0) { throw "Report generation failed with exit code $LASTEXITCODE" }
}
finally { Pop-Location }
