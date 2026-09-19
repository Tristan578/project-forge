#!/usr/bin/env sh
# coverage-dashboard.sh
# Parse web/coverage/coverage-summary.json and print a markdown coverage table.
#
# Groups files by the first 2 path segments under src/ (e.g. src/lib, src/stores).
# Marks directories below threshold with "!" in the output.
#
# Usage:
#   bash .claude/skills/testing/scripts/coverage-dashboard.sh [options]
#   bash .claude/skills/testing/scripts/coverage-dashboard.sh --help
#
# Options:
#   --input <path>      Path to coverage-summary.json
#                       Default: web/coverage/coverage-summary.json
#   --threshold <n>     Minimum % for all metrics before marking with !
#                       Default: 80
#   --output <path>     Write markdown to file instead of stdout
#
# Prerequisites:
#   cd web && npx vitest run --coverage
#
# POSIX-portable: uses printf (not echo -e), no grep -P, sh-compatible.

set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# Defaults
INPUT_PATH="$PROJECT_ROOT/web/coverage/coverage-summary.json"
THRESHOLD=80
OUTPUT_PATH=""

# ---------------------------------------------------------------------------
# Argument parsing (POSIX while/case)
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      printf 'coverage-dashboard.sh — Parse vitest coverage JSON into a markdown table\n'
      printf '\n'
      printf 'Usage:\n'
      printf '  bash .claude/skills/testing/scripts/coverage-dashboard.sh [options]\n'
      printf '\n'
      printf 'Options:\n'
      printf '  --input <path>      Path to coverage-summary.json\n'
      printf '                      Default: web/coverage/coverage-summary.json\n'
      printf '  --threshold <n>     Mark directories below this %% with !\n'
      printf '                      Default: 80\n'
      printf '  --output <path>     Write markdown to this file (default: stdout)\n'
      printf '  --help, -h          Show this help\n'
      printf '\n'
      printf 'Prerequisites:\n'
      printf '  cd web && npx vitest run --coverage\n'
      exit 0
      ;;
    --input)
      INPUT_PATH="$2"
      shift 2
      ;;
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    *)
      printf 'ERROR: Unknown argument: %s\n' "$1" >&2
      printf 'Use --help for usage.\n' >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate input
# ---------------------------------------------------------------------------
if [ ! -f "$INPUT_PATH" ]; then
  printf 'ERROR: coverage-summary.json not found at: %s\n' "$INPUT_PATH" >&2
  printf '\n' >&2
  printf 'Generate it first:\n' >&2
  printf '  cd web && npx vitest run --coverage\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Generate markdown via python3
# python3 is available on macOS 10.x+ and all Linux distros used in CI.
# Using python3 avoids jq dependency and complex POSIX awk gymnastics.
# ---------------------------------------------------------------------------
MARKDOWN="$(python3 - "$INPUT_PATH" "$THRESHOLD" <<'PYEOF'
import json, sys
from collections import defaultdict

path = sys.argv[1]
threshold = float(sys.argv[2])

try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    sys.stderr.write('ERROR: Cannot parse coverage-summary.json: ' + str(e) + '\n')
    sys.exit(1)


def safe_pct(node, key):
    """Extract percentage from a coverage node, returning 0.0 on missing/Unknown."""
    v = node.get(key, {})
    p = v.get('pct', 0)
    if p is None or p == 'Unknown':
        return 0.0
    try:
        return float(p)
    except (TypeError, ValueError):
        return 0.0


def fmt(p):
    return '{:.1f}%'.format(p)


def safe_pct_from_counts(covered, total):
    if total == 0:
        return 0.0
    return round(covered / total * 100, 1)


# Group by first 2 path segments relative to src/
totals_by_dir = defaultdict(lambda: {
    'stmts_t': 0, 'stmts_c': 0,
    'br_t': 0, 'br_c': 0,
    'fn_t': 0, 'fn_c': 0,
    'ln_t': 0, 'ln_c': 0,
})

for filepath, cov in data.items():
    if filepath == 'total':
        continue

    norm = filepath.replace('\\', '/')
    idx = norm.find('/src/')
    rel = norm[idx + 1:] if idx >= 0 else norm  # e.g. src/lib/chat/executor.ts

    parts = rel.split('/')
    if len(parts) >= 2:
        dir_key = '/'.join(parts[:2])  # e.g. src/lib
    else:
        dir_key = parts[0] if parts else 'src'

    d = totals_by_dir[dir_key]
    for metric, tk, ck in [
        ('statements', 'stmts_t', 'stmts_c'),
        ('branches',   'br_t',    'br_c'),
        ('functions',  'fn_t',    'fn_c'),
        ('lines',      'ln_t',    'ln_c'),
    ]:
        m = cov.get(metric, {})
        d[tk] += m.get('total', 0)
        d[ck] += m.get('covered', 0)

# Read overall totals
total_node = data.get('total', {})
ts = safe_pct(total_node, 'statements')
tb = safe_pct(total_node, 'branches')
tf = safe_pct(total_node, 'functions')
tl = safe_pct(total_node, 'lines')

# Print markdown table
lines = []
lines.append('| Directory | Statements | Branches | Functions | Lines |')
lines.append('|-----------|-----------|----------|-----------|-------|')

for dir_key in sorted(totals_by_dir.keys()):
    v = totals_by_dir[dir_key]
    sp = safe_pct_from_counts(v['stmts_c'], v['stmts_t'])
    bp = safe_pct_from_counts(v['br_c'], v['br_t'])
    fp = safe_pct_from_counts(v['fn_c'], v['fn_t'])
    lp = safe_pct_from_counts(v['ln_c'], v['ln_t'])

    # Mark directories below threshold with "!"
    below = any(p < threshold for p in (sp, bp, fp, lp))
    flag = ' !' if below else ''

    lines.append('| `{}/`{} | {} | {} | {} | {} |'.format(
        dir_key, flag,
        fmt(sp), fmt(bp), fmt(fp), fmt(lp),
    ))

# Totals row — check against threshold
below_total = any(p < threshold for p in (ts, tb, tf, tl))
total_flag = ' !' if below_total else ''

lines.append('| **Total**{} | **{}** | **{}** | **{}** | **{}** |'.format(
    total_flag, fmt(ts), fmt(tb), fmt(tf), fmt(tl),
))

print('\n'.join(lines))
PYEOF
)"

# ---------------------------------------------------------------------------
# Assemble full markdown document
# ---------------------------------------------------------------------------
GENERATED_DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"

DOCUMENT="# Coverage Dashboard
*Generated: ${GENERATED_DATE}*

> Source: \`${INPUT_PATH}\`
> Threshold: ${THRESHOLD}% — directories below threshold are marked with \`!\`

## Coverage by Directory

${MARKDOWN}

## Legend

- \`!\` — one or more metrics below ${THRESHOLD}% threshold
- Values are percentages (Statements / Branches / Functions / Lines)

## How to regenerate

\`\`\`bash
cd web && npx vitest run --coverage
bash .claude/skills/testing/scripts/coverage-dashboard.sh
\`\`\`
"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
if [ -n "$OUTPUT_PATH" ]; then
  OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$DOCUMENT" > "$OUTPUT_PATH"
  printf 'PASS: Coverage dashboard written to: %s\n' "$OUTPUT_PATH"
else
  printf '%s\n' "$DOCUMENT"
fi
