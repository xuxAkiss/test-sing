param(
    [string]$HostAddress = "0.0.0.0",
    [int]$Port = 8000,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PythonPath = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$DataRoot = Join-Path $ProjectRoot "data"
$TemporaryRoot = Join-Path $ProjectRoot ".tmp\backend"

if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "Python environment does not exist: $PythonPath"
}

New-Item -ItemType Directory -Force -Path $DataRoot, $TemporaryRoot | Out-Null
$env:KARAOKE_DATA_ROOT = $DataRoot
$env:TEMP = $TemporaryRoot
$env:TMP = $TemporaryRoot

$Arguments = @("-m", "backend", "--host", $HostAddress, "--port", $Port)
if ($Reload) {
    $Arguments += "--reload"
}

Set-Location $ProjectRoot
& $PythonPath @Arguments
