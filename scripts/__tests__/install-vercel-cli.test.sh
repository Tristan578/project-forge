#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/prefix/bin"
cat > "$tmp/prefix/bin/vercel" <<'EOF'
#!/usr/bin/env bash
echo Vercel CLI 55.0.0
EOF
chmod +x "$tmp/prefix/bin/vercel"
path="$tmp/path"; : > "$path"
GITHUB_PATH="$path" VERCEL_CLI_VERSION=55.0.0 VERCEL_CLI_PREFIX="$tmp/prefix" bash "$root/scripts/install-vercel-cli.sh"
grep -qx "$tmp/prefix/bin" "$path"
cat > "$tmp/prefix/bin/vercel" <<'EOF'
#!/usr/bin/env bash
echo Vercel CLI 0.0.0
EOF
chmod +x "$tmp/prefix/bin/vercel"
if GITHUB_PATH="$path" VERCEL_CLI_VERSION=55.0.0 VERCEL_CLI_PREFIX="$tmp/prefix" bash "$root/scripts/install-vercel-cli.sh" 2>&1 | grep -q 'Rejecting cached Vercel CLI'; then :; else exit 1; fi
