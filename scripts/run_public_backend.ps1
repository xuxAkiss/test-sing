param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$env:KARAOKE_MAX_UPLOAD_MB = "50"
$env:KARAOKE_CORS_ORIGINS = "https://xuxakiss.github.io"

Write-Output "Starting the test API on http://127.0.0.1:$Port"
Write-Output "Keep this terminal open while the phone test is running."
& (Join-Path $PSScriptRoot "run_backend.ps1") -HostAddress "127.0.0.1" -Port $Port
