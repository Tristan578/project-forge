#!/usr/bin/env bash
# Tests for .claude/hooks/taskboard-launch.mjs — the ONE entry point every
# taskboard start goes through (#9995 / #10291). `.mcp.json` dials it for the
# MCP server; the hooks, rules, skills and READMEs now tell an operator to run
# `node .claude/hooks/taskboard-launch.mjs start`. That guidance is only honest
# if the launcher really forwards `start` (and every other subcommand) to
# taskboard_runtime.py, on a host where `python3` may not be a valid executable
# name (CPython for Windows ships python.exe) — so this suite drives the real
# launcher, not a description of it.
#
# Hermetic: TASKBOARD_DB points into a temp dir and TASKBOARD_API at a locally
# refused port (case 5: a file:// directory in the temp dir), so no server is
# contacted, no binary is spawned, and the runtime's own guards are what answer.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$HERE/../taskboard-launch.mjs"
[ -f "$LAUNCHER" ] || { echo "FAIL launcher not found: $LAUNCHER"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL node is required to run this suite (the launcher is a node script)"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PYTHONDONTWRITEBYTECODE=1

# run_launcher <subcommand> [VAR=value ...] — prints "<exit>|<output>".
# TASKBOARD_API defaults to a refused port; it precedes "$@" so a case can
# override it (env applies assignments left to right, the last one wins).
run_launcher() {
  local sub="$1" out rc
  shift
  out="$(env TASKBOARD_API="http://127.0.0.1:0/api" "$@" node "$LAUNCHER" "$sub" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_launcher

PY="$(command -v python3 || command -v python || true)"

# file_url <absolute-path> [windows] — the file:// URL that Python's urllib,
# the runtime's api(), maps back to <path>. Python builds it; it is never
# spliced together as "file://$path". Under Git Bash, mktemp returns a POSIX
# path (/tmp/tmp.XXXX). MSYS rewrites that to C:/... when it is a whole argv
# or env value handed to a native program, but not inside a URL, so
# "file://$TMP/..." reached the Windows runtime as file:///tmp/..., which
# url2pathname maps to \tmp\... on the current drive, a directory that does
# not exist. As an argv value "$1" IS rewritten, so Python sees the native
# path and as_uri() spells it file:///C:/... `windows` builds the URI with
# PureWindowsPath, the flavour pathlib.Path is on Windows, so case 5s checks
# the Windows spelling on any host. sys.stdout.write, not print: print on
# Windows ends the line with \r\n, and $(...) strips only the \n.
file_url() {
  "$PY" -c 'import pathlib, sys; cls = pathlib.PureWindowsPath if sys.argv[2:] == ["windows"] else pathlib.Path; sys.stdout.write(cls(sys.argv[1]).as_uri())' "$@"
}
readonly -f file_url

echo "=== taskboard-launch.mjs tests ==="

# ---- 1. argv forwarding: db-path prints the runtime's resolved path ---------
sentinel="$TMP/forwarded/taskboard.db"
res="$(run_launcher db-path TASKBOARD_DB="$sentinel")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 0 ] && grep -qF "forwarded" <<<"$out" && grep -qF "taskboard.db" <<<"$out"; then
  ok "1. 'db-path' is forwarded to taskboard_runtime.py and prints the resolved path"
else
  bad "1. expected exit 0 with the sentinel path, got exit $rc: $out"
fi

# ---- 2. 'start' reaches ensure_running(): a missing database is refused ------
#      BEFORE any spawn, and nothing is created on disk (#10291 security finding).
absent="$TMP/never-created/taskboard.db"
res="$(run_launcher start TASKBOARD_DB="$absent")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 1 ] && grep -qF "Taskboard database is missing" <<<"$out"; then
  ok "2. 'start' is forwarded and refuses a missing database with exit 1"
else
  bad "2. expected exit 1 + 'Taskboard database is missing', got exit $rc: $out"
fi
if [ ! -e "$absent" ] && [ ! -e "$TMP/never-created" ]; then
  ok "2b. no database file or directory was created by the refused start"
else
  bad "2b. the refused start created something under $TMP/never-created"
fi

# ---- 3. an unusable PYTHON override falls through to a real interpreter -----
#      (the probe loop is the whole reason the launcher exists: 'python3' is
#      not a valid executable name on Windows CPython, so a bad first guess
#      must not be fatal).
res="$(run_launcher db-path TASKBOARD_DB="$sentinel" PYTHON="definitely-not-a-python-$$")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 0 ] && grep -qF "forwarded" <<<"$out"; then
  ok "3. a non-existent PYTHON override falls back to the next candidate interpreter"
else
  bad "3. expected the probe loop to fall back, got exit $rc: $out"
fi

# ---- 4. 'init' is forwarded to init_database(), not the start path ----------
#      A populated database makes init refuse BEFORE any spawn with a message
#      only init_database() produces ("already exists and is populated"). The
#      start path would instead try to start a server on it, so this message
#      proves the launcher forwarded `init` and the runtime dispatched it as
#      init. Nothing is spawned, so the case is hermetic on every platform.
populated="$TMP/populated/taskboard.db"
if [ -z "$PY" ]; then
  bad "4. python is required to plant the populated database fixture"
else
  mkdir -p "$TMP/populated"
  "$PY" -c 'import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT)"); c.execute("INSERT INTO projects VALUES(?, ?)", ("p1", "existing")); c.commit(); c.close()' "$populated"
  before="$(cksum < "$populated")"
  res="$(run_launcher init TASKBOARD_DB="$populated")"
  rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" -eq 1 ] && grep -qF "already exists and is populated" <<<"$out"; then
    ok "4. 'init' is forwarded and refuses a populated database with exit 1"
  else
    bad "4. expected exit 1 + 'already exists and is populated', got exit $rc: $out"
  fi
  if [ "$(cksum < "$populated")" = "$before" ]; then
    ok "4b. the refused init left the populated database byte-identical"
  else
    bad "4b. the refused init modified $populated"
  fi
fi

# ---- 5. a sqlite error reaches the operator as one [taskboard] line ---------
#      taskboard_runtime.py's __main__ handler catches sqlite3.Error alongside
#      RuntimeError/OSError. `doctor` against an API that answers (a file://
#      directory serving a `projects` document) and a TASKBOARD_DB that is not
#      a sqlite file makes verify_database()'s PRAGMA raise sqlite3.DatabaseError,
#      which nothing below __main__ converts. Without that handler the operator
#      gets a raw traceback. The "not a database" assertion proves the failure
#      really came from sqlite, so the case cannot pass on some other refusal
#      (a missing file, an unreachable API) that the handler already covered.
#      Case 5a is the positive control: the same file:// API with case 4's
#      populated database must answer "matched", so an API URL the runtime
#      cannot open fails there by name. (An unopenable URL reads as "server
#      down", and doctor then refuses for want of a taskboard binary, which
#      is the shape this case took on windows-latest before file_url.)
api_dir="$TMP/file-api"
mkdir -p "$api_dir" "$TMP/garbage"
printf '[{"id":"p1"}]' > "$api_dir/projects"
garbage="$TMP/garbage/taskboard.db"
printf 'this is not a sqlite database, only enough bytes to fill a header.........................\n' > "$garbage"
api_url=""
[ -n "$PY" ] && api_url="$(file_url "$api_dir")"
if [ -n "$api_url" ] && [ -f "$populated" ]; then
  res="$(run_launcher doctor TASKBOARD_DB="$populated" TASKBOARD_API="$api_url")"
  rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" -eq 0 ] && grep -qF '"apiIdentity": "matched"' <<<"$out"; then
    ok "5a. the runtime opens the file:// API fixture ($api_url) and matches the populated database"
  else
    bad "5a. expected exit 0 + apiIdentity matched through $api_url, got exit $rc: $out"
  fi
else
  bad "5a. python and case 4's populated database are required to build and prove the file:// API fixture"
fi
res="$(run_launcher doctor TASKBOARD_DB="$garbage" TASKBOARD_API="$api_url")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 1 ] && grep -q '^\[taskboard\] ' <<<"$out" && grep -qF "not a database" <<<"$out"; then
  ok "5. a sqlite3.Error in doctor exits 1 with a '[taskboard] ' line naming the sqlite failure"
else
  bad "5. expected exit 1 + a '[taskboard] ' line containing 'not a database', got exit $rc: $out"
fi
if ! grep -qF "Traceback" <<<"$out"; then
  ok "5b. the sqlite failure is reported without a Python traceback"
else
  bad "5b. the sqlite failure escaped as a raw traceback: $out"
fi

# ---- 5s. the Windows spelling of the file:// fixture, checked on any host ----
#      On Windows the runtime's urllib decodes a file URL with nturl2path, so
#      the URL file_url builds there must decode back to the native directory.
#      nturl2path is importable on every platform, so this runs the Windows
#      decode on Linux too. A spliced "file://C:/..." puts the drive in the
#      host field and decodes to \Users\..., which this case reports. The
#      space proves the percent-encoding round-trips.
if [ -n "$PY" ]; then
  win_dir='C:/Users/Runner Admin/AppData/Local/Temp/tmp.AbC/file-api'
  win_url="$(file_url "$win_dir" windows)"
  decoded="$("$PY" -W ignore::DeprecationWarning -c 'import nturl2path, sys, urllib.parse; sys.stdout.write(nturl2path.url2pathname(urllib.parse.urlsplit(sys.argv[1] + "/projects").path))' "$win_url")"
  if [ "$decoded" = 'C:\Users\Runner Admin\AppData\Local\Temp\tmp.AbC\file-api\projects' ]; then
    ok "5s. file_url's Windows spelling ($win_url) decodes back to the native fixture path"
  else
    bad "5s. file_url gave $win_url, which Windows urllib decodes to '$decoded', not the fixture directory"
  fi
else
  bad "5s. python is required to check the Windows file:// spelling"
fi

echo
echo "taskboard-launch.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
