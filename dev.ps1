# PowerShell dev script for Windows users without Make
$ErrorActionPreference = "Stop"

Write-Host "Building Rust engine to WASM..." -ForegroundColor Cyan
Push-Location engine
wasm-pack build --target web --out-dir pkg
Pop-Location

Write-Host "Copying WASM package to web/public..." -ForegroundColor Cyan
if (Test-Path web/public/engine-pkg) {
    Remove-Item -Recurse -Force web/public/engine-pkg
}
New-Item -ItemType Directory -Force -Path web/public/engine-pkg | Out-Null
Copy-Item -Recurse engine/pkg/* web/public/engine-pkg/

Write-Host "Starting Next.js dev server..." -ForegroundColor Cyan
Push-Location web
npm run dev
Pop-Location
