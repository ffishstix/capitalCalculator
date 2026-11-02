$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot '.tmp'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'scheduled-market-refresh.log'

Set-Location -LiteralPath $projectRoot
$startedAt = Get-Date -Format o
Add-Content -LiteralPath $logPath -Value "[$startedAt] Scheduled refresh started."
try {
    # Native stderr contains nonfatal artwork warnings; use the collector's exit code.
    $ErrorActionPreference = 'Continue'
    & npm.cmd run refresh:all 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode -ne 0) { throw "Collector exited with code $exitCode." }
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] Scheduled refresh completed."
} catch {
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] Scheduled refresh failed: $($_.Exception.Message)"
    exit 1
}
