param([switch]$ConfirmRemoval)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmRemoval) { throw 'Add -ConfirmRemoval to remove only FaizanMonitor-S and FaizanMonitor-A.' }
@('FaizanMonitor-S','FaizanMonitor-A') | ForEach-Object {
  if (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $_ -Confirm:$false }
}
Write-Host 'Phase 2C tasks removed.'
