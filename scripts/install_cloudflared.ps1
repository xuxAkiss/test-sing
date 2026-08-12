param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallDirectory = Join-Path $ProjectRoot ".vendor\cloudflared"
$BinaryPath = Join-Path $InstallDirectory "cloudflared.exe"
$DownloadPath = Join-Path $InstallDirectory "cloudflared.download.exe"
$DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

if ((Test-Path -LiteralPath $BinaryPath -PathType Leaf) -and -not $Force) {
    & $BinaryPath --version
    Write-Output "cloudflared already exists at $BinaryPath"
    exit 0
}

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
try {
    $CurlPath = (Get-Command "curl.exe" -ErrorAction Stop).Source
    & $CurlPath --fail --location --retry 3 --output $DownloadPath $DownloadUrl
    if ($LASTEXITCODE -ne 0) {
        throw "cloudflared download failed with exit code $LASTEXITCODE."
    }
    $download = Get-Item -LiteralPath $DownloadPath -ErrorAction Stop
    if ($download.Length -lt 1MB) {
        throw "Downloaded cloudflared binary is unexpectedly small: $($download.Length) bytes"
    }
    & $DownloadPath --version
    if ($LASTEXITCODE -ne 0) {
        throw "Downloaded cloudflared binary did not start successfully."
    }
    Move-Item -LiteralPath $DownloadPath -Destination $BinaryPath -Force
    Write-Output "Installed cloudflared to $BinaryPath"
}
finally {
    if (Test-Path -LiteralPath $DownloadPath -PathType Leaf) {
        Remove-Item -LiteralPath $DownloadPath -Force
    }
}
