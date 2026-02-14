# Resolve project root (where this script lives)
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$engineDir = Join-Path $projectRoot "engine"
$webPublic = Join-Path (Join-Path $projectRoot "web") "public"

# Ensure cargo and wasm-bindgen are on PATH
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$env:PATH = "$(Join-Path $cargoHome 'bin');$env:PATH"

# Ensure Windows SDK and MSVC lib paths are available for native proc-macro compilation.
# Some crates (e.g. doc-image-embed used by csgrs) compile as proc-macros for the host
# and need ucrt.lib / um libs / MSVC libs to link.
if (-not $env:LIB) {
    # Find a Windows SDK version that has ucrt\x64\ucrt.lib
    $sdkRoot = "C:\Program Files (x86)\Windows Kits\10\Lib"
    $msvcVer = "14.44.35207"
    $msvcBase = "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC\$msvcVer\lib\x64"
    $sdkVer = $null
    foreach ($ver in @("10.0.22621.0", "10.0.26100.0", "10.0.19041.0")) {
        if (Test-Path "$sdkRoot\$ver\ucrt\x64\ucrt.lib") {
            $sdkVer = $ver
            break
        }
    }
    if ($sdkVer) {
        $sdkBase = "$sdkRoot\$sdkVer"
        $env:LIB = "$sdkBase\ucrt\x64;$sdkBase\um\x64;$msvcBase"
        Write-Host "Set LIB (SDK $sdkVer) for native proc-macro linking" -ForegroundColor DarkGray
    }
}

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
