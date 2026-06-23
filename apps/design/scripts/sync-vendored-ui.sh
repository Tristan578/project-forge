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
DIST="$REPO_ROOT/packages/ui/dist"

# The vendored package is consumed FLAT: package.json `main`/`exports` resolve to
# ./index.js, ./tokens/index.js, etc. — NOT ./dist/*. So the build output must be
# mirrored into the vendored ROOT, not a dist/ subdir (the old `cp -r dist dist`
# wrote a directory nothing imports, so the flat files silently drifted from
# source until a manual copy — #8742 / Sentry vendored-staleness finding).
# Mirror every dist entry into VENDOR, preserving the hand-authored package.json.
# `npm run build` already copies effects.css + theme.css into dist, so they come
# along with the mirror — no separate cp needed.
find "$VENDOR" -mindepth 1 -maxdepth 1 ! -name package.json -exec rm -rf {} +
cp -R "$DIST"/. "$VENDOR"/

echo "Vendored UI synced successfully (flat layout)."
