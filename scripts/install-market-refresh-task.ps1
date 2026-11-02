$ErrorActionPreference = 'Stop'
$taskName = 'Capital Rift market refresh'
$runner = Join-Path $PSScriptRoot 'scheduled-market-refresh.ps1'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$start = (Get-Date).AddMinutes(5)
$marker = Join-Path (Split-Path -Parent $PSScriptRoot) '.tmp/refresh-last-success.json'
if (Test-Path -LiteralPath $marker) {
    try {
        $lastSuccess = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        $start = ([datetime]::Parse($lastSuccess.at)).ToLocalTime().AddMinutes(61)
        while ($start -le (Get-Date).AddMinutes(1)) { $start = $start.AddHours(1) }
    } catch { $start = (Get-Date).AddMinutes(5) }
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime, LastRunTime, LastTaskResult
