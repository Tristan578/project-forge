#!/usr/bin/env sh
# file-to-test-stub.sh
# Generate a vitest test stub from a source file path.
#
# Usage:
#   bash .claude/skills/testing/scripts/file-to-test-stub.sh <source-file-path>
#   bash .claude/skills/testing/scripts/file-to-test-stub.sh --help
#
# Arguments:
#   source-file-path   Path to the TypeScript source file (absolute or relative to project root)
#
# Examples:
#   bash .claude/skills/testing/scripts/file-to-test-stub.sh web/src/lib/chat/executor.ts
#   bash .claude/skills/testing/scripts/file-to-test-stub.sh web/src/stores/slices/audioSlice.ts
#
# Output:
#   Creates <dir>/__tests__/<moduleName>.test.ts relative to the source file.
#
# POSIX-portable: uses printf (not echo -e), no grep -P, no bash arrays, bash 3+.

set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
if [ $# -eq 0 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  printf 'file-to-test-stub.sh — Generate a vitest test stub from a source file\n'
  printf '\n'
  printf 'Usage:\n'
  printf '  bash .claude/skills/testing/scripts/file-to-test-stub.sh <source-file-path>\n'
  printf '\n'
  printf 'Arguments:\n'
  printf '  source-file-path   Path to the TypeScript source file\n'
  printf '                     Can be absolute or relative to the project root\n'
  printf '\n'
  printf 'Examples:\n'
  printf '  bash .claude/skills/testing/scripts/file-to-test-stub.sh web/src/lib/chat/executor.ts\n'
  printf '  bash .claude/skills/testing/scripts/file-to-test-stub.sh web/src/stores/slices/audioSlice.ts\n'
  printf '\n'
  printf 'Output:\n'
  printf '  Creates <source-dir>/__tests__/<moduleName>.test.ts\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the file path
# ---------------------------------------------------------------------------
INPUT="$1"

# If not an absolute path, resolve relative to project root
case "$INPUT" in
  /*)
    SOURCE_FILE="$INPUT"
    ;;
  *)
    SOURCE_FILE="$PROJECT_ROOT/$INPUT"
    ;;
esac

if [ ! -f "$SOURCE_FILE" ]; then
  printf 'ERROR: Source file not found: %s\n' "$SOURCE_FILE" >&2
  printf 'Pass the path relative to the project root, e.g.:\n' >&2
  printf '  web/src/lib/chat/executor.ts\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Derive names and paths
# ---------------------------------------------------------------------------
# Get the directory containing the source file
SOURCE_DIR="$(dirname "$SOURCE_FILE")"
# Get just the filename
SOURCE_BASENAME="$(basename "$SOURCE_FILE")"
# Strip the extension (.ts, .tsx, .js, etc.)
MODULE_NAME="${SOURCE_BASENAME%.*}"

# Output directory: <source-dir>/__tests__/
OUTPUT_DIR="$SOURCE_DIR/__tests__"
OUTPUT_FILE="$OUTPUT_DIR/${MODULE_NAME}.test.ts"

# Build the import path for the module (relative from __tests__/)
# e.g. ../executor or ../slices/audioSlice
IMPORT_PATH="../${MODULE_NAME}"

# Derive an absolute import alias if inside web/src/
# e.g. web/src/lib/chat/executor.ts -> @/lib/chat/executor
ABS_IMPORT=""
case "$SOURCE_FILE" in
  */web/src/*)
    # Extract relative path after web/src/
    AFTER_SRC="${SOURCE_FILE##*/web/src/}"
    # Strip extension
    ABS_IMPORT="@/${AFTER_SRC%.*}"
    ;;
esac

# Extract exported names from the source file for placeholder tests.
# Uses python3 for reliable parsing (POSIX-safe alternative to complex grep).
EXPORTS="$(python3 - "$SOURCE_FILE" <<'PYEOF'
import sys, re

path = sys.argv[1]
try:
    with open(path) as f:
        content = f.read()
except Exception:
    sys.exit(0)

exports = []

# Match: export function name / export const name / export class name / export async function name
# Also matches: export { name } style (less important)
patterns = [
    r'export\s+(?:async\s+)?function\s+(\w+)',
    r'export\s+(?:const|let|var)\s+(\w+)',
    r'export\s+class\s+(\w+)',
]

for pat in patterns:
    for match in re.finditer(pat, content):
        name = match.group(1)
        if name not in exports:
            exports.append(name)

# Print up to 5 export names, one per line
for name in exports[:5]:
    print(name)
PYEOF
)"

# Build placeholder test cases from exports
PLACEHOLDER_TESTS=""
if [ -n "$EXPORTS" ]; then
  while IFS= read -r export_name; do
    PLACEHOLDER_TESTS="${PLACEHOLDER_TESTS}
  it('${export_name} works correctly', () => {
    // TODO: test ${export_name}
    expect(true).toBe(true);
  });
"
  done <<EOF
$EXPORTS
EOF
else
  PLACEHOLDER_TESTS="
  it('is implemented correctly', () => {
    // TODO: add assertions
    expect(true).toBe(true);
  });
"
fi

# ---------------------------------------------------------------------------
# Create output directory
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"

# Avoid overwriting an existing file
if [ -f "$OUTPUT_FILE" ]; then
  printf 'WARN: Output file already exists: %s\n' "$OUTPUT_FILE" >&2
  printf 'Skipping to avoid overwriting. Delete it first if you want to regenerate.\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Write the test stub
# ---------------------------------------------------------------------------
# Prefer @/ alias inside web/src/, fall back to relative import
if [ -n "$ABS_IMPORT" ]; then
  IMPORT_LINE="import { } from '${ABS_IMPORT}';"
else
  IMPORT_LINE="import { } from '${IMPORT_PATH}';"
fi

printf '/**\n' > "$OUTPUT_FILE"
printf ' * Unit tests for %s\n' "$SOURCE_BASENAME" >> "$OUTPUT_FILE"
printf ' *\n' >> "$OUTPUT_FILE"
printf ' * Auto-generated stub — fill in real assertions.\n' >> "$OUTPUT_FILE"
printf ' * Generated by: .claude/skills/testing/scripts/file-to-test-stub.sh\n' >> "$OUTPUT_FILE"
printf ' */\n' >> "$OUTPUT_FILE"
printf 'import { describe, it, expect, vi, beforeEach } from '\''vitest'\'';\n' >> "$OUTPUT_FILE"
printf '// TODO: update import to include the specific exports you are testing\n' >> "$OUTPUT_FILE"
printf '%s\n' "$IMPORT_LINE" >> "$OUTPUT_FILE"
printf '\n' >> "$OUTPUT_FILE"
printf 'describe('\''%s'\'', () => {\n' "$MODULE_NAME" >> "$OUTPUT_FILE"
printf '  beforeEach(() => {\n' >> "$OUTPUT_FILE"
printf '    vi.clearAllMocks();\n' >> "$OUTPUT_FILE"
printf '  });\n' >> "$OUTPUT_FILE"
printf '%s' "$PLACEHOLDER_TESTS" >> "$OUTPUT_FILE"
printf '});\n' >> "$OUTPUT_FILE"

printf 'PASS: Test stub written to: %s\n' "$OUTPUT_FILE"
printf '\n'
printf 'Next steps:\n'
printf '  1. Open %s\n' "$OUTPUT_FILE"
printf '  2. Update the import to include the specific exports you want to test\n'
printf '  3. Replace the placeholder assertions with real test logic\n'
printf '  4. Run: cd web && npx vitest run %s\n' "$MODULE_NAME"
