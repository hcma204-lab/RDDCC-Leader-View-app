# Registers a per-user "At log on" scheduled task that keeps the Claude bridge running (hidden, auto-restart).
# Independent of the Claude desktop app. No admin rights needed. Remove: Unregister-ScheduledTask -TaskName ClaudeBridgeDashboard -Confirm:$false
$ErrorActionPreference = 'Stop'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$arg  = "-NoProfile -WindowStyle Hidden -Command `"Set-Location -LiteralPath '$dir'; & '$node' claude-bridge.js`""
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set  = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$prin = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'ClaudeBridgeDashboard' -Action $action -Trigger $trigger -Settings $set -Principal $prin -Description 'Claude bridge for the dashboard (local only, 127.0.0.1)' -Force | Out-Null
# remove the older Startup-folder shortcut if present (the task replaces it)
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude-Bridge-Dashboard.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force }
Start-ScheduledTask -TaskName 'ClaudeBridgeDashboard'
Start-Sleep -Seconds 5
Write-Host 'OK: task ClaudeBridgeDashboard registered and started.'
try { $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/status' -TimeoutSec 4; Write-Host ('Bridge status: claude=' + $s.claude + ' loggedIn=' + $s.loggedIn) } catch { Write-Host 'Bridge not reachable yet (it may need a few more seconds).' }
Write-Host 'Open the local dashboard: http://127.0.0.1:8787/'
