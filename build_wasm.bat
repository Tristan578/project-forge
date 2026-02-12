@echo off
cd /d "%~dp0engine"
cargo build --target wasm32-unknown-unknown --release
