$ErrorActionPreference = "Stop"

# Resolve project root (where this script lives)
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$engineDir = Join-Path $projectRoot "engine"

# Ensure cargo is on PATH
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$env:PATH = "$(Join-Path $cargoHome 'bin');$env:PATH"

# Build
Set-Location $engineDir
wasm-pack build --target web --out-dir pkg
