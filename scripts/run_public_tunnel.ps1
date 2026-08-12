param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CloudflaredPath = Join-Path $ProjectRoot ".vendor\cloudflared\cloudflared.exe"

if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared is not installed. Run scripts/install_cloudflared.ps1 first."
}

Write-Output "Creating a temporary HTTPS address for http://127.0.0.1:$Port"
Write-Output "Copy the https://...trycloudflare.com address shown below."
Write-Output "Keep this terminal open; press Ctrl+C when the test is finished."
& $CloudflaredPath tunnel --url "http://127.0.0.1:$Port"
