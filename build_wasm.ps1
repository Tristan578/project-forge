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

# --- Runtime variants (stripped editor systems for exported games) ---

Write-Host "=== Building WebGL2 Runtime variant ===" -ForegroundColor Cyan
cargo build --target $wasmTarget --release --features webgl2,runtime
if ($LASTEXITCODE -ne 0) { Write-Host "WebGL2 Runtime build FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== wasm-bindgen WebGL2 Runtime ===" -ForegroundColor Cyan
& $wasmBindgen --target web --out-dir "pkg-webgl2-runtime" $wasmBinary
if ($LASTEXITCODE -ne 0) { Write-Host "wasm-bindgen (webgl2-runtime) FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== Building WebGPU Runtime variant ===" -ForegroundColor Cyan
cargo build --target $wasmTarget --release --features webgpu,runtime
if ($LASTEXITCODE -ne 0) { Write-Host "WebGPU Runtime build FAILED" -ForegroundColor Red; exit 1 }

Write-Host "=== wasm-bindgen WebGPU Runtime ===" -ForegroundColor Cyan
& $wasmBindgen --target web --out-dir "pkg-webgpu-runtime" $wasmBinary
if ($LASTEXITCODE -ne 0) { Write-Host "wasm-bindgen (webgpu-runtime) FAILED" -ForegroundColor Red; exit 1 }

# --- wasm-opt pass (optional, warn if not found) ---
$wasmOpt = $null
# Check cargo bin first, then PATH
$cargoWasmOpt = Join-Path (Join-Path $cargoHome "bin") "wasm-opt.exe"
if (Test-Path $cargoWasmOpt) {
    $wasmOpt = $cargoWasmOpt
} else {
    $wasmOpt = Get-Command wasm-opt -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if ($wasmOpt) {
    Write-Host "=== Running wasm-opt (Oz) ===" -ForegroundColor Cyan
    $wasmOptFailed = @()
    $wasmOptPassed = @()
    foreach ($pkg in @("pkg-webgl2", "pkg-webgpu", "pkg-webgl2-runtime", "pkg-webgpu-runtime")) {
        $wasmFile = Join-Path $pkg "forge_engine_bg.wasm"
        if (Test-Path $wasmFile) {
            $sizeBefore = (Get-Item $wasmFile).Length / 1MB
            & $wasmOpt -Oz --enable-bulk-memory -o $wasmFile $wasmFile
            if ($LASTEXITCODE -eq 0) {
                $sizeAfter = (Get-Item $wasmFile).Length / 1MB
                Write-Host ("  {0}: {1:N1} MB -> {2:N1} MB" -f $pkg, $sizeBefore, $sizeAfter) -ForegroundColor DarkGray
                $wasmOptPassed += $pkg
            } else {
                Write-Host "  wasm-opt FAILED for $pkg (exit code $LASTEXITCODE)" -ForegroundColor Red
                $wasmOptFailed += $pkg
            }
        }
    }

    # Summary
    Write-Host ""
    Write-Host "=== wasm-opt summary ===" -ForegroundColor Cyan
    if ($wasmOptPassed.Count -gt 0) {
        Write-Host ("  Optimized: " + ($wasmOptPassed -join ", ")) -ForegroundColor Green
    }
    if ($wasmOptFailed.Count -gt 0) {
        Write-Host ("  FAILED:    " + ($wasmOptFailed -join ", ")) -ForegroundColor Red
        Write-Host "Build FAILED: wasm-opt errors must be resolved" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "wasm-opt not found - skipping optimization. Install via: cargo install wasm-opt" -ForegroundColor Yellow
}

Write-Host "=== Copying to web/public ===" -ForegroundColor Cyan

# Create directories if needed
foreach ($dir in @("engine-pkg-webgl2", "engine-pkg-webgpu", "engine-pkg-webgl2-runtime", "engine-pkg-webgpu-runtime")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $webPublic $dir) | Out-Null
}

# Copy all variants (editor + runtime)
Copy-Item -Path "pkg-webgl2\*" -Destination (Join-Path $webPublic "engine-pkg-webgl2") -Force
Copy-Item -Path "pkg-webgpu\*" -Destination (Join-Path $webPublic "engine-pkg-webgpu") -Force
Copy-Item -Path "pkg-webgl2-runtime\*" -Destination (Join-Path $webPublic "engine-pkg-webgl2-runtime") -Force
Copy-Item -Path "pkg-webgpu-runtime\*" -Destination (Join-Path $webPublic "engine-pkg-webgpu-runtime") -Force

# --- Generate content-hash manifests to enable cache-busting ---
# Each engine package directory gets a wasm-manifest.json that contains the
# SHA-256 hash of the .wasm binary (first 16 hex chars used as a short hash).
# useEngine.ts reads this manifest before loading to append ?v=<hash> to
# WASM URLs, preventing browsers from serving stale cached binaries after
# a deployment.
Write-Host "=== Generating WASM content-hash manifests ===" -ForegroundColor Cyan
foreach ($variant in @("engine-pkg-webgl2", "engine-pkg-webgpu", "engine-pkg-webgl2-runtime", "engine-pkg-webgpu-runtime")) {
    $destDir = Join-Path $webPublic $variant
    $wasmPath = Join-Path $destDir "forge_engine_bg.wasm"
    if (Test-Path $wasmPath) {
        $hashBytes = (Get-FileHash -Algorithm SHA256 -Path $wasmPath).Hash
        # Use first 16 hex chars as the content hash (64 bits of entropy — sufficient for cache-busting)
        $shortHash = $hashBytes.Substring(0, 16).ToLower()
        $manifest = @{
            wasmFile = "forge_engine_bg.wasm"
            jsFile   = "forge_engine.js"
            hash     = $shortHash
        } | ConvertTo-Json -Compress
        $manifest | Set-Content -Path (Join-Path $destDir "wasm-manifest.json") -Encoding UTF8
        Write-Host "  $variant hash: $shortHash" -ForegroundColor DarkGray
    } else {
        Write-Host "  WARNING: $wasmPath not found, skipping manifest" -ForegroundColor Yellow
    }
}

Write-Host "=== All WASM variants built successfully (editor + runtime) ===" -ForegroundColor Green
