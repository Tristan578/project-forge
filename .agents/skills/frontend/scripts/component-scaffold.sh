#!/usr/bin/env bash
# Generate a new React component + test + optional Storybook story.
#
# Usage:
#   bash scripts/component-scaffold.sh ComponentName [directory]
#
# Arguments:
#   ComponentName  PascalCase name of the component (required)
#   directory      Destination directory relative to web/src/components/
#                  Defaults to "editor"
#
# Examples:
#   bash scripts/component-scaffold.sh MyPanel
#   bash scripts/component-scaffold.sh MyPanel editor/panels

set -euo pipefail

COMPONENT_NAME="${1:-}"
DEST_DIR="${2:-editor}"

if [[ -z "$COMPONENT_NAME" ]]; then
  echo "ERROR: ComponentName is required." >&2
  echo "Usage: bash scripts/component-scaffold.sh ComponentName [directory]" >&2
  exit 1
fi

# Resolve repo root (two levels up from this script's location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
COMPONENTS_DIR="$REPO_ROOT/web/src/components/$DEST_DIR"
TESTS_DIR="$COMPONENTS_DIR/__tests__"

if [[ ! -d "$REPO_ROOT/web/src" ]]; then
  echo "ERROR: Cannot locate web/src — is the repo root correct? ($REPO_ROOT)" >&2
  exit 1
fi

mkdir -p "$COMPONENTS_DIR" "$TESTS_DIR"

COMPONENT_FILE="$COMPONENTS_DIR/${COMPONENT_NAME}.tsx"
TEST_FILE="$TESTS_DIR/${COMPONENT_NAME}.test.tsx"

# --- Component file ---
if [[ -f "$COMPONENT_FILE" ]]; then
  echo "SKIP: $COMPONENT_FILE already exists." >&2
else
  cat > "$COMPONENT_FILE" <<COMPONENT
'use client';

import { cn } from '@/lib/utils';

// Props interface — add domain-specific props here.
interface ${COMPONENT_NAME}Props {
  className?: string;
}

/**
 * ${COMPONENT_NAME} — describe what this component does.
 *
 * Usage:
 *   <${COMPONENT_NAME} />
 */
export function ${COMPONENT_NAME}({ className }: ${COMPONENT_NAME}Props) {
  return (
    <div className={cn('', className)}>
      {/* TODO: implement ${COMPONENT_NAME} */}
    </div>
  );
}
COMPONENT
  echo "CREATED: $COMPONENT_FILE"
fi

# --- Test file ---
if [[ -f "$TEST_FILE" ]]; then
  echo "SKIP: $TEST_FILE already exists." >&2
else
  cat > "$TEST_FILE" <<TEST
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ${COMPONENT_NAME} } from '../${COMPONENT_NAME}';

describe('${COMPONENT_NAME}', () => {
  it('renders without crashing', () => {
    render(<${COMPONENT_NAME} />);
    // TODO: add meaningful assertions once the component has real content
  });

  it('accepts a className prop', () => {
    const { container } = render(<${COMPONENT_NAME} className="test-class" />);
    expect(container.firstChild).toHaveClass('test-class');
  });
});
TEST
  echo "CREATED: $TEST_FILE"
fi

echo ""
echo "Scaffold complete for ${COMPONENT_NAME}."
echo "  Component : $COMPONENT_FILE"
echo "  Test      : $TEST_FILE"
echo ""
echo "Next steps:"
echo "  1. Implement the component in $COMPONENT_FILE"
echo "  2. Add assertions in $TEST_FILE"
echo "  3. Run: cd web && npx vitest run src/components/$DEST_DIR/__tests__/${COMPONENT_NAME}.test.tsx"
