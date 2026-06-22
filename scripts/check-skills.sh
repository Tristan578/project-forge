#!/usr/bin/env bash
#
# Skill linter — validates every Claude Code skill under .claude/skills/ against
# structural best practices. "Skills are not just markdown": this checks the
# frontmatter schema, the name↔directory contract Claude Code enforces, internal
# link integrity, and that any shipped skill scripts are executable AND
# clean under shellcheck.
#
# Checks per <skill>/SKILL.md:
#   1. SKILL.md exists for every .claude/skills/*/ directory
#   2. Frontmatter present and starts on line 1 (no leading blank/BOM)
#   3. Frontmatter declares `name:` and `description:`
#   4. `name` value equals the directory name (Claude Code requirement)
#   5. `name` is kebab-case and ≤ 64 chars
#   6. `description` is 20–1024 chars
#   7. Body after the frontmatter is non-empty
#   8. Every relative markdown link (references/scripts/...) resolves to a real file
#   9. Every <skill>/scripts/*.sh is chmod +x and shellcheck-clean (if shellcheck present)
#
# Exit 0 = all skills valid. Exit 1 = at least one finding. macOS/BSD-safe
# (bash 3.2, no mapfile/associative arrays, no GNU-only sed). Run from CI or
# locally:  bash scripts/check-skills.sh
#
# Limit to specific skills by passing directory names:
#   bash scripts/check-skills.sh capability-review changelog-review

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

# $SKILLS_DIR / $SKILLS_BASELINE_FILE are TEST-ONLY seams (never set in CI — the
# skills-lint job runs the script with no env) so the unit test can point the
# linter at a temp tree. Same idiom as the openapi-route-sync gate's $OPENAPI_*.
skills_dir="${SKILLS_DIR:-.claude/skills}"
# Ratchet baseline: skill directories with known pre-existing debt (legacy
# lint findings in scripts, imported cross-platform skills with stub frontmatter).
# A finding in a baselined skill is reported as a WARNING and does not fail the
# gate; a finding in ANY other skill (new or touched-clean) fails it. This is the
# same ratchet pattern the repo uses for openapi-route-sync and matches the
# #8676 stance on legacy lint debt: enforce clean on new/touched skills,
# track the legacy tail rather than block on it. Prune an entry once its skill is
# clean (the linter warns when a baselined skill no longer has findings).
baseline_file="${SKILLS_BASELINE_FILE:-scripts/check-skills-baseline.txt}"

checked=0
findings_file="$(mktemp -t check-skills.XXXXXX)"
trap 'rm -f "$findings_file"' EXIT

have_shellcheck=0
command -v shellcheck >/dev/null 2>&1 && have_shellcheck=1

# Record a finding against a skill directory (printed + classified after the loop).
err() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$findings_file"; }   # <skill_dir> <file> <message>
warn() { echo "::warning file=$1::$2" >&2; }

# Is a skill directory baselined as known debt?
is_baselined() {
  [ -f "$baseline_file" ] || return 1
  grep -qxF "$1" <(grep -vE '^[[:space:]]*(#|$)' "$baseline_file")
}

# Which skills to lint: explicit args, else every directory under .claude/skills.
targets=()
if [ "$#" -gt 0 ]; then
  for a in "$@"; do targets+=("$skills_dir/$a"); done
else
  for d in "$skills_dir"/*/; do
    [ -d "$d" ] && targets+=("${d%/}")
  done
fi

if [ "${#targets[@]}" -eq 0 ]; then
  echo "No skills found under $skills_dir — nothing to lint." >&2
  exit 0
fi

# Field extraction from YAML frontmatter (between the first two `---` fences).
# Returns the raw value after `<key>:`, quote-stripped and trimmed.
fm_field() {
  local file="$1" key="$2"
  awk -v key="$key" '
    NR==1 && $0!="---" { exit }            # frontmatter must start on line 1
    NR==1 { infm=1; next }
    infm && $0=="---" { exit }
    infm {
      # match `key:` at line start
      if (index($0, key ":") == 1) {
        val = substr($0, length(key) + 2)
        sub(/^[[:space:]]+/, "", val)
        sub(/[[:space:]]+$/, "", val)
        # strip one layer of surrounding quotes
        sub(/^"/, "", val); sub(/"$/, "", val)
        sub(/^'"'"'/, "", val); sub(/'"'"'$/, "", val)
        print val
        exit
      }
    }
  ' "$file"
}

# Does the file have a closing `---` for its frontmatter (a body follows)?
has_body() {
  awk '
    NR==1 && $0!="---" { print "no"; ok=1; exit }
    NR==1 { infm=1; next }
    infm && $0=="---" { infm=0; next }
    !infm && NF { print "yes"; ok=1; exit }
    END { if (!ok) print "no" }
  ' "$1"
}

checked_dirs=""
for skill_path in "${targets[@]}"; do
  name_expected="$(basename "$skill_path")"
  md="$skill_path/SKILL.md"
  checked=$((checked + 1))
  checked_dirs="$checked_dirs$name_expected
"

  # 1. SKILL.md exists
  if [ ! -f "$md" ]; then
    err "$name_expected" "$skill_path" "missing SKILL.md (a skill directory must contain SKILL.md)"
    continue
  fi

  # 2. Frontmatter starts on line 1
  first_line="$(head -1 "$md")"
  if [ "$first_line" != "---" ]; then
    err "$name_expected" "$md" "frontmatter must start on line 1 with '---' (found: '${first_line}'); check for a BOM or CRLF line endings"
    continue
  fi

  # 3 + 4 + 5. name
  name_val="$(fm_field "$md" name)"
  if [ -z "$name_val" ]; then
    err "$name_expected" "$md" "frontmatter is missing a non-empty 'name:' field"
  else
    if [ "$name_val" != "$name_expected" ]; then
      err "$name_expected" "$md" "frontmatter name '$name_val' must equal the directory name '$name_expected'"
    fi
    if ! printf '%s' "$name_val" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
      err "$name_expected" "$md" "name '$name_val' must be kebab-case ([a-z0-9] words joined by single hyphens)"
    fi
    if [ "${#name_val}" -gt 64 ]; then
      err "$name_expected" "$md" "name is ${#name_val} chars; must be ≤ 64"
    fi
  fi

  # 6. description
  desc_val="$(fm_field "$md" description)"
  if [ -z "$desc_val" ]; then
    err "$name_expected" "$md" "frontmatter is missing a non-empty 'description:' field"
  else
    dlen="${#desc_val}"
    if [ "$dlen" -lt 20 ]; then
      err "$name_expected" "$md" "description is ${dlen} chars; too short to convey when to use the skill (need ≥ 20)"
    fi
    if [ "$dlen" -gt 1024 ]; then
      err "$name_expected" "$md" "description is ${dlen} chars; must be ≤ 1024"
    fi
  fi

  # 7. body present
  if [ "$(has_body "$md")" != "yes" ]; then
    err "$name_expected" "$md" "SKILL.md has no body content after the frontmatter"
  fi

  # 8. relative markdown link integrity
  # Match proper [text](path) links only, with fenced code blocks stripped first
  # (so `arr['key'](x)` and other code samples aren't mistaken for links).
  # Skip http(s), mailto, and #anchors.
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac
    # strip any #anchor suffix
    path="${target%%#*}"
    [ -z "$path" ] && continue
    if [ ! -e "$skill_path/$path" ] && [ ! -e "$path" ]; then
      err "$name_expected" "$md" "broken link: '$target' does not resolve to a file"
    fi
  done < <(
    awk 'BEGIN{f=0} /^[[:space:]]*```/{f=!f; next} f{next} {print}' "$md" \
      | grep -oE '\[[^]]*\]\([^)]+\)' 2>/dev/null \
      | sed -E 's/.*\]\(//; s/\)$//'
  )

  # 9. skill scripts must be executable + shellcheck-clean
  if [ -d "$skill_path/scripts" ]; then
    while IFS= read -r sh; do
      [ -z "$sh" ] && continue
      if [ ! -x "$sh" ]; then
        err "$name_expected" "$sh" "skill script is not executable (chmod +x it)"
      fi
      if [ "$have_shellcheck" -eq 1 ]; then
        if ! shellcheck -S warning "$sh" >/dev/null 2>&1; then
          err "$name_expected" "$sh" "shellcheck reported findings (run: shellcheck $sh)"
        fi
      fi
    done < <(find "$skill_path/scripts" -name '*.sh' -type f 2>/dev/null)
  fi
done

if [ "$have_shellcheck" -eq 0 ]; then
  warn "scripts/check-skills.sh" "shellcheck not installed — skill scripts were not lint-checked"
fi

# ---- Classify findings against the ratchet baseline -------------------------
fail=0
known=0
dirty_dirs="$(cut -f1 "$findings_file" 2>/dev/null | sort -u)"

for dir in $dirty_dirs; do
  if is_baselined "$dir"; then
    known=$((known + 1))
    while IFS=$'\t' read -r d file msg; do
      [ "$d" = "$dir" ] && warn "$file" "[baselined: $dir] $msg"
    done < "$findings_file"
  else
    fail=1
    while IFS=$'\t' read -r d file msg; do
      [ "$d" = "$dir" ] && echo "::error file=$file::$msg" >&2
    done < "$findings_file"
  fi
done

# Anti-rot: a baselined skill that now lints clean should be pruned. Read the
# baseline into a variable first so the filename isn't a redirect source and a
# warn() argument at once (avoids a spurious SC2094).
if [ -f "$baseline_file" ]; then
  baseline_lines="$(grep -vE '^[[:space:]]*(#|$)' "$baseline_file")"
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    # Only claim "now clean" for skills actually checked this run — a scoped run
    # didn't evaluate the rest, so it can't say anything about them.
    printf '%s\n' "$checked_dirs" | grep -qxF "$b" || continue
    if [ -d "$skills_dir/$b" ] && ! printf '%s\n' "$dirty_dirs" | grep -qxF "$b"; then
      warn "$baseline_file" "baselined skill '$b' now lints clean — prune it from $baseline_file"
    fi
  done <<EOF
$baseline_lines
EOF
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Skill lint FAILED: a non-baselined skill has findings (above). Fix them, or — only for" >&2
  echo "pre-existing legacy/imported debt — add the skill dir to $baseline_file with a reason." >&2
  exit 1
fi

echo "Skill lint passed: $checked skill(s) checked, $known with baselined (known) debt."
