#!/bin/bash
# Syncs the vendored @spawnforge/ui package from the monorepo build.
# Run after modifying packages/ui/src/.
set -e
cd "$(dirname "$0")/.."
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "Building @spawnforge/ui..."
cd "$REPO_ROOT/packages/ui" && npm run build

echo "Syncing to vendored directory..."
VENDOR="$REPO_ROOT/apps/design/vendored/spawnforge-ui"
rm -rf "$VENDOR/dist"
cp -r "$REPO_ROOT/packages/ui/dist" "$VENDOR/dist"
cp "$REPO_ROOT/packages/ui/src/effects/effects.css" "$VENDOR/dist/effects/" 2>/dev/null || true
cp "$REPO_ROOT/packages/ui/src/tokens/theme.css" "$VENDOR/dist/tokens/" 2>/dev/null || true

echo "Vendored UI synced successfully."
