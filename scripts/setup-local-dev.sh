#!/bin/bash
# setup-local-dev.sh
#
# Automates local development environment setup for SpawnForge.
# Run this once after cloning, or whenever your local setup needs refreshing.
#
# Usage:
#   bash scripts/setup-local-dev.sh
#
# Prerequisites:
#   node 20+, npm, git, vercel CLI, gh CLI
#
# Exit codes:
#   0  Setup complete — ready to run `cd web && npm run dev`
#   1  Missing prerequisites or fatal error

set -euo pipefail

echo "=== SpawnForge Local Dev Setup ==="
echo ""

# ---------- prerequisite checks -------------------------------------------

check_prereq() {
  command -v "$1" >/dev/null 2>&1 || { echo "MISSING: $1 — $2"; return 1; }
  echo "OK: $1 $(command -v "$1")"
}

MISSING=0
check_prereq node "Install Node.js 20+ from https://nodejs.org" || MISSING=1
check_prereq npm "Comes with Node.js" || MISSING=1
check_prereq git "Install from https://git-scm.com" || MISSING=1
check_prereq vercel "Run: npm i -g vercel" || MISSING=1
check_prereq gh "Install from https://cli.github.com" || MISSING=1

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Install missing prerequisites and re-run."
  exit 1
fi

# Warn if Node version is below 20
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "WARNING: Node.js $NODE_MAJOR detected — 20+ recommended"
fi

# ---------- Vercel project link -------------------------------------------

echo ""
echo "=== Vercel Project Link ==="

if [ ! -d "web/.vercel" ]; then
  echo "Linking to Vercel project..."
  cd web && vercel link --project spawnforge --yes && cd ..
else
  echo "OK: web/.vercel already linked"
fi

# ---------- environment variables -----------------------------------------

echo ""
echo "=== Environment Variables ==="
echo "Pulling environment variables from Vercel..."

cd web && vercel env pull .env.local --yes && cd ..

check_env() {
  grep -q "^$1=" web/.env.local 2>/dev/null || { echo "MISSING ENV: $1"; return 1; }
  echo "OK: $1"
}

check_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || true
check_env CLERK_SECRET_KEY || true
check_env STRIPE_SECRET_KEY || true
check_env NEXT_PUBLIC_SENTRY_DSN || true
check_env UPSTASH_REDIS_REST_URL || true
check_env DATABASE_URL || true

# ---------- install dependencies ------------------------------------------

echo ""
echo "=== Installing Dependencies ==="

echo "Installing web dependencies..."
cd web && npm install && cd ..

echo "Installing mcp-server dependencies..."
cd mcp-server && npm install && cd ..

# ---------- TypeScript check ----------------------------------------------

echo ""
echo "=== TypeScript Check ==="
cd web && node_modules/.bin/tsc --noEmit && echo "TypeScript: OK" && cd ..

# ---------- database ------------------------------------------------------

echo ""
echo "=== Database ==="
if grep -q "^DATABASE_URL=" web/.env.local 2>/dev/null; then
  echo "Database URL configured"
else
  echo "WARNING: No DATABASE_URL — database features won't work locally"
fi

# ---------- taskboard -----------------------------------------------------

echo ""
echo "=== Taskboard ==="
if command -v taskboard >/dev/null 2>&1; then
  if taskboard start --port 3010 2>/dev/null; then
    echo "Taskboard: running at http://localhost:3010"
  else
    echo "Taskboard: already running or failed to start — visit http://localhost:3010"
  fi
else
  echo "WARNING: taskboard CLI not installed — skipping"
fi

# ---------- done ----------------------------------------------------------

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  cd web && npm run dev"
echo ""
echo "Dev URL:     http://localhost:3000"
echo "Auth bypass: http://localhost:3000/dev  (bypasses Clerk auth)"
echo "Taskboard:   http://localhost:3010"
