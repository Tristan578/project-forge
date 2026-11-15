#!/usr/bin/env bash
# generate-coverage-dashboard.sh — Generate a unified test coverage dashboard
# Aggregates vitest coverage, Rust coverage (if available), and command coverage.
# Used by: testing skill, validator agent, CI/CD pipeline
# Compatible with bash 3+ (macOS system bash)
#
# Usage:
#   bash .claude/skills/testing/scripts/generate-coverage-dashboard.sh [--output <path>]
#   bash .claude/skills/testing/scripts/generate-coverage-dashboard.sh --help
#
# Output: docs/coverage/dashboard.md (or path specified with --output)
#
# Reads:
#   web/coverage/coverage-summary.json  — vitest --coverage output
#   engine/target/coverage/             — cargo coverage (if present)
#   (runs audit-command-coverage.sh internally)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default output path
OUTPUT_PATH="$PROJECT_ROOT/docs/coverage/dashboard.md"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
warn() { echo -e "${YELLOW}WARN${NC}: $1" >&2; }
info() { echo -e "${CYAN}INFO${NC}: $1"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      echo "generate-coverage-dashboard.sh — Generate unified test coverage dashboard"
      echo ""
      echo "Usage:"
      echo "  bash .claude/skills/testing/scripts/generate-coverage-dashboard.sh [options]"
      echo ""
      echo "Options:"
      echo "  --output <path>  Write dashboard to this path (default: docs/coverage/dashboard.md)"
      echo "  --help, -h       Show this help"
      echo ""
      echo "Prerequisites:"
      echo "  1. Run vitest with coverage first:"
      echo "     cd web && npx vitest run --coverage"
      echo "  2. Optionally run Rust coverage:"
      echo "     cargo llvm-cov --target wasm32-unknown-unknown"
      echo ""
      echo "Output: Markdown file with per-directory coverage tables and uncovered paths"
      exit 0
      ;;
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1. Use --help for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Dates and paths
# ---------------------------------------------------------------------------
GENERATED_DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"
WEB_COVERAGE_JSON="$PROJECT_ROOT/web/coverage/coverage-summary.json"
RUST_COVERAGE_DIR="$PROJECT_ROOT/engine/target/coverage"
COMMAND_AUDIT_SCRIPT="$SCRIPT_DIR/audit-command-coverage.sh"

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT_PATH")"

# ---------------------------------------------------------------------------
# Section 1: Web coverage (vitest)
# ---------------------------------------------------------------------------
info "Reading web coverage from: $WEB_COVERAGE_JSON"

WEB_COVERAGE_SECTION=""
WEB_AVAILABLE=false

if [ -f "$WEB_COVERAGE_JSON" ]; then
  WEB_AVAILABLE=true
  WEB_COVERAGE_SECTION="$(python3 - "$WEB_COVERAGE_JSON" <<'PYEOF'
import json, sys, os

path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    sys.stderr.write("ERROR: Could not parse coverage-summary.json: " + str(e) + "\n")
    sys.exit(1)

# The coverage-summary.json from vitest/istanbul looks like:
# {
#   "total": { "lines": { "total": N, "covered": M, "skipped": S, "pct": X.X }, ... },
#   "src/lib/foo.ts": { ... },
#   ...
# }

# Aggregate by directory prefix (top 2 path segments relative to src/)
def pct(node, key):
    v = node.get(key, {})
    p = v.get("pct", 0)
    if p is None or p == "Unknown":
        return 0.0
    return float(p)

def fmt(p):
    return f"{p:.1f}%"

# Group entries by first 2 path segments
from collections import defaultdict

totals_by_dir = defaultdict(lambda: {"stmts_t": 0, "stmts_c": 0, "br_t": 0, "br_c": 0, "fn_t": 0, "fn_c": 0, "ln_t": 0, "ln_c": 0})

for filepath, cov in data.items():
    if filepath == "total":
        continue
    # Normalise to relative path starting from "src/"
    norm = filepath.replace("\\", "/")
    # Find "src/" in path
    idx = norm.find("/src/")
    if idx >= 0:
        rel = norm[idx+1:]  # e.g. "src/lib/chat/executor.ts"
    else:
        rel = norm

    # Take first 2 segments: "src/lib"
    parts = rel.split("/")
    if len(parts) >= 2:
        dir_key = "/".join(parts[:2])
    else:
        dir_key = parts[0] if parts else "root"

    d = totals_by_dir[dir_key]
    for key, tk, ck in [
        ("statements", "stmts_t", "stmts_c"),
        ("branches",   "br_t",    "br_c"),
        ("functions",  "fn_t",    "fn_c"),
        ("lines",      "ln_t",    "ln_c"),
    ]:
        node = cov.get(key, {})
        d[tk] += node.get("total", 0)
        d[ck] += node.get("covered", 0)

def safe_pct(covered, total):
    if total == 0:
        return 0.0
    return round(covered / total * 100, 1)

# Sort directories
dirs = sorted(totals_by_dir.keys())

lines_out = []
lines_out.append("| Directory | Statements | Branches | Functions | Lines |")
lines_out.append("|-----------|-----------|----------|-----------|-------|")

for d in dirs:
    v = totals_by_dir[d]
    sp = safe_pct(v["stmts_c"], v["stmts_t"])
    bp = safe_pct(v["br_c"], v["br_t"])
    fp = safe_pct(v["fn_c"], v["fn_t"])
    lp = safe_pct(v["ln_c"], v["ln_t"])
    lines_out.append(f"| `{d}/` | {fmt(sp)} | {fmt(bp)} | {fmt(fp)} | {fmt(lp)} |")

# Totals row
total_node = data.get("total", {})
ts = pct(total_node, "statements")
tb = pct(total_node, "branches")
tf = pct(total_node, "functions")
tl = pct(total_node, "lines")
lines_out.append(f"| **Total** | **{fmt(ts)}** | **{fmt(tb)}** | **{fmt(tf)}** | **{fmt(tl)}** |")

print("\n".join(lines_out))
PYEOF
)"
else
  warn "Web coverage file not found: $WEB_COVERAGE_JSON"
  WEB_COVERAGE_SECTION="_Web coverage not available._

To generate web coverage, run:
\`\`\`bash
cd web && npx vitest run --coverage
\`\`\`
Then re-run this script."
fi

# ---------------------------------------------------------------------------
# Section 2: Uncovered critical paths
# ---------------------------------------------------------------------------
UNCOVERED_SECTION=""
if [ "$WEB_AVAILABLE" = true ]; then
  UNCOVERED_SECTION="$(python3 - "$WEB_COVERAGE_JSON" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    print("_Could not determine uncovered paths._")
    sys.exit(0)

# Critical directories where 0% line coverage is a red flag
CRITICAL_PREFIXES = [
    "/src/lib/",
    "/src/stores/",
    "/src/hooks/",
    "/src/app/api/",
]

zero_coverage = []
for filepath, cov in data.items():
    if filepath == "total":
        continue
    norm = filepath.replace("\\", "/")

    is_critical = any(prefix in norm for prefix in CRITICAL_PREFIXES)
    if not is_critical:
        continue

    lines_node = cov.get("lines", {})
    pct = lines_node.get("pct", None)
    if pct is None or pct == "Unknown":
        pct = 0.0
    if float(pct) == 0.0 and lines_node.get("total", 0) > 0:
        # Extract relative path
        idx = norm.find("/src/")
        rel = norm[idx:] if idx >= 0 else norm
        zero_coverage.append(rel)

zero_coverage.sort()

if not zero_coverage:
    print("_No critical-path files with 0% line coverage detected._")
else:
    for path in zero_coverage[:30]:  # Cap at 30 lines
        print(f"- [ ] `{path}`")
    if len(zero_coverage) > 30:
        print(f"- ... and {len(zero_coverage) - 30} more")
PYEOF
)"
else
  UNCOVERED_SECTION="- [ ] _Run vitest coverage to detect uncovered paths_"
fi

# ---------------------------------------------------------------------------
# Section 3: Rust / engine coverage
# ---------------------------------------------------------------------------
RUST_COVERAGE_SECTION=""
if [ -d "$RUST_COVERAGE_DIR" ]; then
  # Try to find a coverage summary file (llvm-cov generates various formats)
  LCOV_FILE="$RUST_COVERAGE_DIR/lcov.info"
  SUMMARY_FILE="$RUST_COVERAGE_DIR/summary.txt"
  if [ -f "$SUMMARY_FILE" ]; then
    RUST_COVERAGE_SECTION="$(cat "$SUMMARY_FILE")"
  elif [ -f "$LCOV_FILE" ]; then
    # Parse basic line coverage from lcov.info
    RUST_COVERAGE_SECTION="$(python3 - "$LCOV_FILE" <<'PYEOF'
import sys, re

path = sys.argv[1]
total = 0
covered = 0
try:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("LF:"):
                total += int(line[3:])
            elif line.startswith("LH:"):
                covered += int(line[3:])
except Exception as e:
    print(f"_Could not parse lcov.info: {e}_")
    sys.exit(0)

if total > 0:
    pct = round(covered / total * 100, 1)
    print(f"Line coverage: **{pct}%** ({covered}/{total} lines)")
else:
    print("_No Rust line coverage data found in lcov.info_")
PYEOF
)"
  else
    RUST_COVERAGE_SECTION="_Rust coverage directory found at \`engine/target/coverage/\` but no recognized summary file._

Expected files: \`summary.txt\` or \`lcov.info\`"
  fi
else
  RUST_COVERAGE_SECTION="_Not available — run Rust coverage to generate:_

\`\`\`bash
cargo llvm-cov --target wasm32-unknown-unknown --lcov --output-path engine/target/coverage/lcov.info
\`\`\`"
fi

# ---------------------------------------------------------------------------
# Section 4: Command coverage
# ---------------------------------------------------------------------------
COMMAND_COVERAGE_SECTION=""
if [ -f "$COMMAND_AUDIT_SCRIPT" ]; then
  info "Running command coverage audit..."
  # Run audit script, capture output, strip ANSI color codes
  CMD_OUTPUT="$(bash "$COMMAND_AUDIT_SCRIPT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' || true)"
  COMMAND_COVERAGE_SECTION="\`\`\`
${CMD_OUTPUT}
\`\`\`"
else
  COMMAND_COVERAGE_SECTION="_audit-command-coverage.sh not found at expected path._

Expected: \`.claude/skills/testing/scripts/audit-command-coverage.sh\`"
fi

# ---------------------------------------------------------------------------
# Write dashboard.md
# ---------------------------------------------------------------------------
info "Writing dashboard to: $OUTPUT_PATH"

cat > "$OUTPUT_PATH" <<DASHEOF
# Test Coverage Dashboard
*Generated: ${GENERATED_DATE}*

> Auto-generated by \`.claude/skills/testing/scripts/generate-coverage-dashboard.sh\`
> Re-run after \`npx vitest run --coverage\` to refresh numbers.

---

## Web Coverage (vitest)

${WEB_COVERAGE_SECTION}

---

## Engine Coverage (cargo)

${RUST_COVERAGE_SECTION}

---

## Command Coverage

${COMMAND_COVERAGE_SECTION}

---

## Uncovered Critical Paths

Files in \`src/lib/\`, \`src/stores/\`, \`src/hooks/\`, and \`src/app/api/\` with 0% line coverage:

${UNCOVERED_SECTION}

---

## How to Improve Coverage

1. **Run coverage locally:**
   \`\`\`bash
   cd web && npx vitest run --coverage
   bash .claude/skills/testing/scripts/generate-coverage-dashboard.sh
   \`\`\`

2. **Generate a regression stub from a Sentry issue:**
   \`\`\`bash
   SENTRY_AUTH_TOKEN=your_token \\
     bash .claude/skills/testing/scripts/sentry-to-test-stub.sh <issue-id>
   \`\`\`

3. **Enforce coverage thresholds (ratchet):**
   \`\`\`bash
   bash .claude/skills/testing/scripts/ratchet-coverage.sh
   \`\`\`

4. **Check command test coverage:**
   \`\`\`bash
   bash .claude/skills/testing/scripts/audit-command-coverage.sh
   \`\`\`
DASHEOF

pass "Dashboard written to: $OUTPUT_PATH"
echo ""
echo "View it with: cat $OUTPUT_PATH"
