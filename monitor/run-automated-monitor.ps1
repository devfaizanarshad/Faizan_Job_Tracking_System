param(
  [ValidateSet('S','A','S,A')][string]$Tiers = 'S',
  [ValidateSet('SCHEDULED','MANUAL','TEST')][string]$Trigger = 'SCHEDULED',
  [switch]$Force,
  [datetime]$ScheduledStart = (Get-Date)
)
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'PGPASSWORD must be supplied through the environment or replace this check with a securely configured PostgreSQL passfile.' }
$arguments = @('.\automate-run.js', "--tiers=$Tiers", "--trigger=$Trigger", "--scheduled-start=$($ScheduledStart.ToString('o'))")
if ($Force) { $arguments += '--force' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Phase 2C automation exited with code $LASTEXITCODE" }
