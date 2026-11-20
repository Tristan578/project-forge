#!/usr/bin/env bash
# Run the same release gate from Claude and cross-tool skill installations.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python "$HERE/release_health.py" "$@"
