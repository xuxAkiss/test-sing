param(
    [ValidateSet('cpu', 'cu128')]
    [string]$Compute = 'cpu'
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$venvRoot = Join-Path $projectRoot '.venv'
$tempRoot = Join-Path $projectRoot '.tmp'
$torchRoot = Join-Path $projectRoot '.model_cache\torch'

foreach ($path in @($venvRoot, $tempRoot, $torchRoot)) {
    if (-not $path.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to use a path outside the project: $path"
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
New-Item -ItemType Directory -Path $torchRoot -Force | Out-Null

# Keep large wheel extraction and model downloads off the system drive.
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:TORCH_HOME = $torchRoot

if (-not (Test-Path -LiteralPath (Join-Path $venvRoot 'Scripts\python.exe'))) {
    python -m venv $venvRoot
}

$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$torchIndex = "https://download.pytorch.org/whl/$Compute"
& $venvPython -m pip install --disable-pip-version-check --no-cache-dir `
    torch torchaudio --index-url $torchIndex
if ($LASTEXITCODE -ne 0) {
    throw 'CUDA PyTorch installation failed.'
}

& $venvPython -m pip install --disable-pip-version-check --no-cache-dir `
    -e "$projectRoot[media,separation]"
if ($LASTEXITCODE -ne 0) {
    throw 'Project separation dependencies installation failed.'
}

& $venvPython -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available()); print('device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
