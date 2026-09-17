#!/usr/bin/env bash
set -euo pipefail
forge_repo="$(cd "$(dirname "$0")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/tools"
cat > "$fixture/tools/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'install\n' >> "$INSTALL_LOG"
prefix=""; version=""
while (( $# )); do
  case "$1" in
    --prefix) prefix="$2"; shift 2;;
    vercel@*) version="$(printf '%s' "$1" | cut -d@ -f2)"; shift;;
    *) shift;;
  esac
done
[[ -n "$prefix" && -n "$version" ]]
mkdir -p "$prefix/node_modules/.bin"
printf '#!/usr/bin/env bash\necho "%s"\n' "$version" > "$prefix/node_modules/.bin/vercel"
chmod +x "$prefix/node_modules/.bin/vercel"
EOF
chmod +x "$fixture/tools/npm"
export PATH="$fixture/tools:$PATH"
export INSTALL_LOG="$fixture/installs"
export GITHUB_PATH="$fixture/github-path"
export VERCEL_CLI_VERSION=55.0.0
export VERCEL_CLI_PREFIX="$fixture/prefix with spaces"

# Empty cache is installed into npm's actual local-prefix .bin directory.
bash "$forge_repo/scripts/install-vercel-cli.sh"
[[ $(wc -l < "$INSTALL_LOG") -eq 1 ]]
grep -Fxq "$VERCEL_CLI_PREFIX/node_modules/.bin" "$GITHUB_PATH"
# Valid cache avoids npm entirely.
bash "$forge_repo/scripts/install-vercel-cli.sh"
[[ $(wc -l < "$INSTALL_LOG") -eq 1 ]]
# Stale cache is discarded and repaired, not merely diagnosed.
echo stale > "$VERCEL_CLI_PREFIX/stale-marker"
printf '#!/usr/bin/env bash\necho 0.0.0\n' > "$VERCEL_CLI_PREFIX/node_modules/.bin/vercel"
bash "$forge_repo/scripts/install-vercel-cli.sh"
[[ ! -e "$VERCEL_CLI_PREFIX/stale-marker" ]]
[[ $(wc -l < "$INSTALL_LOG") -eq 2 ]]
# A crashing cached executable also rebuilds rather than terminating the gate.
printf '#!/usr/bin/env bash\nexit 3\n' > "$VERCEL_CLI_PREFIX/node_modules/.bin/vercel"
bash "$forge_repo/scripts/install-vercel-cli.sh"
[[ $(wc -l < "$INSTALL_LOG") -eq 3 ]]
[[ $("$VERCEL_CLI_PREFIX/node_modules/.bin/vercel" --version) == "$VERCEL_CLI_VERSION" ]]
echo 'PASS: Vercel cache cold install, valid hit, stale and corrupt repair'
