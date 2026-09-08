param([switch]$Activate)
$ErrorActionPreference = 'Stop'
if (-not $Activate) {
  Write-Host 'Preview only. Add -Activate after explicit approval to register the two tasks.'
  Write-Host 'FaizanMonitor-S: daily at 00:00, repeating every 8 hours.'
  Write-Host 'FaizanMonitor-A: daily at 06:00, repeating every 12 hours.'
  exit 0
}
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'monitor\run-automated-monitor.ps1'
$pwsh = (Get-Command powershell.exe).Source
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$sAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -Tiers S -Trigger SCHEDULED"
$aAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -Tiers A -Trigger SCHEDULED"
$sTriggers = @('00:00','08:00','16:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
$aTriggers = @('06:00','18:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
Register-ScheduledTask -TaskName 'FaizanMonitor-S' -Action $sAction -Trigger $sTriggers -Settings $settings -Principal $principal -Description 'Low-frequency Tier-S employer monitoring.' | Out-Null
Register-ScheduledTask -TaskName 'FaizanMonitor-A' -Action $aAction -Trigger $aTriggers -Settings $settings -Principal $principal -Description 'Low-frequency Tier-A employer monitoring.' | Out-Null
Write-Host 'Phase 2C tasks registered.'
