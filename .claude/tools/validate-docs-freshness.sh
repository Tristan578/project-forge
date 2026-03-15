#!/usr/bin/env bash
# validate-docs-freshness.sh
# Reads YAML frontmatter from docs in docs/ and reports stale docs
# where relatedFiles have been modified after lastVerified.
# Exit 0 always (warning only, not blocking).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"

if [ ! -d "$DOCS_DIR" ]; then
  echo "WARN: docs/ directory not found at $DOCS_DIR" >&2
  exit 0
fi

stale_count=0
clean_count=0

# Find all markdown docs that contain frontmatter
while IFS= read -r doc_path; do
  # Extract YAML frontmatter (content between the first pair of --- lines)
  frontmatter=$(awk 'BEGIN{in_fm=0; found=0} /^---/{if(!found){in_fm=1; found=1; next} else if(in_fm){exit}} in_fm{print}' "$doc_path")

  # Parse lastVerified
  last_verified=$(printf '%s\n' "$frontmatter" | grep '^lastVerified:' | sed 's/^lastVerified:[[:space:]]*//')
  if [ -z "$last_verified" ]; then
    continue
  fi

  # Parse relatedFiles inline list: [file1, file2, ...]
  related_files_raw=$(printf '%s\n' "$frontmatter" | grep '^relatedFiles:' | sed 's/^relatedFiles:[[:space:]]*//' | tr -d '[]')

  doc_relative="${doc_path#$REPO_ROOT/}"
  has_stale=0
  stale_details=()

  IFS=',' read -ra files_array <<< "$related_files_raw"
  for raw_file in "${files_array[@]}"; do
    # Trim leading/trailing whitespace
    file="${raw_file#"${raw_file%%[! ]*}"}"
    file="${file%"${file##*[! ]}"}"
    [ -z "$file" ] && continue

    abs_file="$REPO_ROOT/$file"
    if [ ! -f "$abs_file" ]; then
      continue
    fi

    # Get date of the most recent commit for this file (YYYY-MM-DD)
    last_commit=$(git -C "$REPO_ROOT" log -1 --format="%as" -- "$file" 2>/dev/null)
    if [ -z "$last_commit" ]; then
      continue
    fi

    # Lexicographic date comparison (YYYY-MM-DD sorts correctly)
    if [[ "$last_commit" > "$last_verified" ]]; then
      has_stale=1
      stale_details+=("$file changed $last_commit, doc verified $last_verified")
    fi
  done

  if [ "$has_stale" -eq 1 ]; then
    stale_count=$((stale_count + 1))
    for detail in "${stale_details[@]}"; do
      echo "STALE: $doc_relative ($detail)"
    done
  else
    clean_count=$((clean_count + 1))
  fi

done < <(find "$DOCS_DIR" -name "*.md" -type f | sort)

echo ""
echo "Doc freshness summary: $clean_count clean, $stale_count stale"
exit 0
