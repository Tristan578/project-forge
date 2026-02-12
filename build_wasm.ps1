# Resolve project root (where this script lives)
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$engineDir = Join-Path $projectRoot "engine"
$webPublic = Join-Path (Join-Path $projectRoot "web") "public"

# Ensure cargo and wasm-bindgen are on PATH
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$env:PATH = "$(Join-Path $cargoHome 'bin');$env:PATH"

$wasmBindgen = Join-Path (Join-Path $cargoHome "bin") "wasm-bindgen.exe"
$wasmTarget = "wasm32-unknown-unknown"
$wasmBinary = Join-Path (Join-Path (Join-Path (Join-Path $engineDir "target") $wasmTarget) "release") "forge_engine.wasm"

Set-Location $engineDir

Write-Host "=== Building WebGL2 variant ===" -ForegroundColor Cyan
cargo build --target $wasmTarget --release --features webgl2
if ($LASTEXITCODE -ne 0) { Write-Host "WebGL2 build FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== wasm-bindgen WebGL2 ===" -ForegroundColor Cyan
& $wasmBindgen --target web --out-dir "pkg-webgl2" $wasmBinary
if ($LASTEXITCODE -ne 0) { Write-Host "wasm-bindgen (webgl2) FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== Building WebGPU variant ===" -ForegroundColor Cyan
cargo build --target $wasmTarget --release --features webgpu
if ($LASTEXITCODE -ne 0) { Write-Host "WebGPU build FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== wasm-bindgen WebGPU ===" -ForegroundColor Cyan
& $wasmBindgen --target web --out-dir "pkg-webgpu" $wasmBinary
if ($LASTEXITCODE -ne 0) { Write-Host "wasm-bindgen (webgpu) FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== Copying to web/public ===" -ForegroundColor Cyan

# Create directories if needed
New-Item -ItemType Directory -Force -Path (Join-Path $webPublic "engine-pkg-webgl2") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $webPublic "engine-pkg-webgpu") | Out-Null

# Copy both variants
Copy-Item -Path "pkg-webgl2\*" -Destination (Join-Path $webPublic "engine-pkg-webgl2") -Force
Copy-Item -Path "pkg-webgpu\*" -Destination (Join-Path $webPublic "engine-pkg-webgpu") -Force

Write-Host "=== Both WASM variants built successfully ===" -ForegroundColor Green
