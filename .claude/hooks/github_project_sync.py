#!/usr/bin/env python3
"""
github_project_sync.py - Bidirectional sync between local taskboard and GitHub Projects v2

ARCHITECTURE (v3 — github_issue_number is source of truth):
  - Local tickets have `github_issue_number` (INTEGER) and `sync_repo` (TEXT) columns.
  - `sync_repo` MUST equal the configured repo name for a ticket to be synced.
  - Push: only syncs tickets WHERE sync_repo = config.repo. Matches by github_issue_number.
  - Pull: only imports issues whose SPAWNFORGE_METADATA.projectId matches, or are already linked.
  - The JSON map file is a CACHE — the SQLite columns are the authoritative state.
  - Title-based matching is NEVER used. Only github_issue_number links local <-> remote.

Usage:
  python3 github_project_sync.py push       # Push changed tickets to GitHub
  python3 github_project_sync.py push-all   # Push ALL tickets including done
  python3 github_project_sync.py pull       # Pull GitHub changes to local taskboard
  python3 github_project_sync.py status     # Show sync status

Requires: gh CLI (authenticated), taskboard API at localhost:3010, SQLite DB
"""

# fcntl is POSIX-only. Importing it unconditionally made this whole module
# unimportable on Windows, which failed all 56 tests in
# .claude/hooks/__tests__/github_project_sync.test.sh for a reason that had
# nothing to do with what they test (#9606). msvcrt provides the equivalent
# non-blocking byte-range lock on Windows; see _try_lock_exclusive below.
try:
    import fcntl

    msvcrt = None
except ModuleNotFoundError:  # Windows
    fcntl = None
    import msvcrt
import hashlib
import taskboard_runtime
import taskboard_sync
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
# Use Portless for all traffic (project rule — keeps us off stale direct ports).
#
# Portless 302-redirects plain HTTP to HTTPS. urllib's default redirect handler
# downgrades POST/PUT to GET on a 302 (per RFC 7231), which silently turned
# every ticket create into a list-fetch and exploded with "'list' object has
# no attribute 'get'". Fix: hit HTTPS directly, and accept Portless's
# self-signed cert via an unverified SSL context.
import ssl
import urllib.request
TB_API = os.environ.get("TASKBOARD_API", "http://localhost:3010/api").rstrip("/")
TB_API_WRITE = TB_API
_TB_SSL_CTX = None


# ---------------------------------------------------------------------------
# Worktree-safe path resolution
# ---------------------------------------------------------------------------
# When running from a git worktree (.claude/worktrees/agent-*/), all paths
# must resolve to the MAIN repo checkout. Otherwise the sync script uses
# a stale DB copy and creates duplicate GitHub issues.

def _find_main_repo_root() -> Path:
    return taskboard_runtime.repo_root(SCRIPT_DIR)


PROJECT_ROOT = _find_main_repo_root()
_MAIN_HOOKS = PROJECT_ROOT / ".claude" / "hooks"
CONFIG_PATH = _MAIN_HOOKS / "github-sync-config.json"
MAP_PATH = _MAIN_HOOKS / "github-project-map.json"



def _find_taskboard_db() -> Path:
    return taskboard_runtime.default_db()


DB_PATH = _find_taskboard_db()

# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------
# Sync runs unattended from the Stop hook after EVERY assistant response. When
# it misbehaves there is no interactive moment in which to stop it, and the only
# lever anyone had was to hold the flock from a detached process and remember to
# kill that pid later. Both wrapper scripts and this module check the same two
# signals so the switch works from any entry point.
DISABLE_MARKER = _MAIN_HOOKS / ".sync-disabled"
DISABLE_ENV = "SPAWNFORGE_SYNC_DISABLED"


def sync_disabled_reason():
    """Return a human-readable reason the sync is switched off, else None."""
    env = os.environ.get(DISABLE_ENV, "")
    if env and env != "0":
        return f"{DISABLE_ENV}={env}"
    if DISABLE_MARKER.exists():
        try:
            note = DISABLE_MARKER.read_text().strip()
        except OSError:
            note = ""
        return f"{DISABLE_MARKER.name} present" + (f" ({note})" if note else "")
    return None


# ---------------------------------------------------------------------------
# Projects v2 node ids
# ---------------------------------------------------------------------------
# A Projects v2 item id is an opaque GraphQL global node id (`PVTI_...`). pull()
# used to synthesize `issue-<number>` as a stand-in so its own reverse lookup
# had a key, and push() then fed that stand-in straight to
# `gh project item-edit --id`, which can only ever answer "Could not resolve to
# a node with the global id of 'issue-N'". The raise aborted the ticket's update
# block BEFORE its memo fields were written, so the change detector fired again
# on the next run — 922 tickets, once per Stop hook, forever. Anything that is
# not a real node id must never reach a GraphQL mutation.
_SYNTHETIC_ITEM_ID_RE = re.compile(r"^issue-\d+$")


def is_real_project_item_id(value):
    """True only for an id GitHub can resolve as a Projects v2 item node."""
    if not value or not isinstance(value, str):
        return False
    if _SYNTHETIC_ITEM_ID_RE.match(value):
        return False
    # Global node ids are opaque, but every Projects v2 item id GitHub has ever
    # issued carries the typename prefix. Requiring it keeps this a whitelist:
    # an unrecognised shape is refused rather than forwarded to a mutation.
    return value.startswith("PVTI_")


# Wall-clock ceiling for one push. The Stop hook fires per response, so a push
# that overruns is not merely slow — it holds the lock across the next several
# turns and starves every later run. Stopping early is safe: push is
# incremental and idempotent, so the remainder is simply picked up next turn.
def _budget_from_env(name, default):
    """Read a seconds budget from the environment, falling back on nonsense.

    These are read at import time on the Stop-hook path, so a typo'd value must
    not raise there: the sync would then fail before it could even report why.
    """
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


PUSH_TIME_BUDGET_SECONDS = _budget_from_env("SPAWNFORGE_SYNC_PUSH_BUDGET", 120.0)
RECONCILE_TIME_BUDGET_SECONDS = _budget_from_env(
    "SPAWNFORGE_SYNC_RECONCILE_BUDGET", 300.0
)
# How many project-field (GraphQL mutation) failures a single run tolerates
# before it stops issuing them altogether.
PROJECT_FIELD_FAILURE_LIMIT = 3


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


_resolved_cache = {}


def resolve_team_id(config):
    if "team" in _resolved_cache:
        return _resolved_cache["team"]

    team_name = config.get("allowedTeamName")
    if not team_name:
        result = config.get("allowedTeamId")
        _resolved_cache["team"] = result
        return result

    teams = tb_get("/teams")
    if teams:
        for team in teams:
            if team.get("name", "").lower() == team_name.lower():
                _resolved_cache["team"] = team["id"]
                return team["id"]

    try:
        new_team = tb_post("/teams", {"name": team_name})
        tid = new_team.get("id")
        if tid:
            print(f"  [bootstrap] Created team: {team_name} ({tid})")
            _resolved_cache["team"] = tid
            return tid
    except Exception as e:
        print(f"  [bootstrap] Failed to create team {team_name}: {e}", file=sys.stderr)

    _resolved_cache["team"] = None
    return None


def resolve_project_id(config):
    taskboard_runtime.verify_database(DB_PATH)
    with taskboard_sync.connect(DB_PATH) as conn:
        return taskboard_sync.bind_project(conn, config)


def load_map():
    if MAP_PATH.exists():
        try:
            with open(MAP_PATH) as f:
                return _strip_synthetic_item_ids(json.load(f))
        except (json.JSONDecodeError, IOError):
            pass
    return {"lastSync": None, "tickets": {}}


def _strip_synthetic_item_ids(mapping):
    """Drop `githubItemId` values GitHub cannot resolve.

    The map on disk is a cache, so the 922 `issue-<number>` stand-ins already
    written into it are load-bearing only in the sense that push keeps feeding
    them to a mutation that always fails. Removing them on load is the
    migration: an entry with no item id takes the "resolve it, or skip the
    field update" path instead.
    """
    for entry in (mapping.get("tickets") or {}).values():
        if not isinstance(entry, dict):
            continue
        if "githubItemId" in entry and not is_real_project_item_id(entry["githubItemId"]):
            entry.pop("githubItemId", None)
    return mapping


def save_map(mapping):
    # Strip on the way out as well as in. pull() writes `githubItemId` from four
    # branches and normalizes REST issues into board-item shape to do it, so a
    # guard at any one of those sites is one refactor away from being bypassed.
    # The two serialization choke points cannot be.
    _strip_synthetic_item_ids(mapping)
    mapping["lastSync"] = datetime.now(timezone.utc).isoformat()
    with open(MAP_PATH, "w") as f:
        json.dump(mapping, f, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# SQLite direct access — github_issue_number is the authoritative link
# ---------------------------------------------------------------------------

def db_connect():
    if not DB_PATH.exists():
        return None
    taskboard_runtime.verify_database(DB_PATH)
    conn = sqlite3.connect(str(DB_PATH))
    _ensure_sync_columns(conn)
    return conn


_migration_checked = False


def _ensure_sync_columns(conn):
    taskboard_sync.ensure_schema(conn)
    conn.commit()


def db_get_github_issue_number(ticket_id):
    conn = db_connect()
    if not conn:
        return None
    try:
        cur = conn.execute(
            "SELECT github_issue_number FROM tickets WHERE id = ? AND sync_repo = ? AND sync_owner = ?", (ticket_id, load_config()["repo"], load_config()["owner"].lower())
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def db_set_github_issue_number(ticket_id, issue_number):
    conn = db_connect()
    if not conn:
        return
    try:
        conn.execute(
            "UPDATE tickets SET github_issue_number = ?, sync_repo = ?, sync_owner = ? WHERE id = ? AND (sync_repo IS NULL OR sync_repo = ?)",
            (issue_number, load_config()["repo"], load_config()["owner"].lower(), ticket_id, load_config()["repo"]),
        )
        conn.commit()
    finally:
        conn.close()


def db_find_by_github_issue(issue_number):
    conn = db_connect()
    if not conn:
        return None
    try:
        cur = conn.execute(
            "SELECT id FROM tickets WHERE github_issue_number = ? AND sync_repo = ? AND sync_owner = ?", (issue_number, load_config()["repo"], load_config()["owner"].lower())
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def db_get_syncable_ticket_ids(repo_name):
    """Return set of ticket IDs where sync_repo matches the target repo."""
    conn = db_connect()
    if not conn:
        return set()
    try:
        cur = conn.execute(
            "SELECT id FROM tickets WHERE sync_repo = ? AND sync_owner = ?", (repo_name, load_config()["owner"].lower())
        )
        return {row[0] for row in cur.fetchall()}
    finally:
        conn.close()


# Ticket title and JSON map entries are not identity. No title-based relinking.


def compute_body_hash(ticket):
    desc = ticket.get("description", "") or ""
    priority = ticket.get("priority", "") or ""
    team_id = ticket.get("teamId", "") or ""
    raw = f"{desc}|{priority}|{team_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def compute_subtask_hash(subtasks):
    if not subtasks:
        return hashlib.sha256(b"").hexdigest()[:16]
    items = sorted(
        f"{s.get('title', '')}:{s.get('completed', False)}" for s in subtasks
    )
    raw = "|".join(items)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def format_github_body(ticket):
    priority = ticket.get("priority", "medium") or "medium"
    desc = ticket.get("description", "") or ""
    tid = ticket.get("id", "")
    number = ticket.get("number", 0)
    team_id = ticket.get("teamId", "") or ""
    subtasks = ticket.get("subtasks", [])
    project_id = ticket.get("projectId", "01KMM9ZA6SBZ7RKJZJTZS9VR4R")

    parts = [f"**Priority:** {priority}", ""]

    if desc.strip():
        parts.append(desc.strip())
        parts.append("")

    if subtasks:
        parts.append("## Subtasks")
        for st in subtasks:
            check = "x" if st.get("completed") else " "
            title = st.get("title", "Untitled")
            parts.append(f"- [{check}] {title}")
        parts.append("")

    body_hash = compute_body_hash(ticket)
    subtask_hash = compute_subtask_hash(subtasks)

    metadata = {
        "version": 3,
        "ticketId": tid,
        "number": number,
        "priority": priority,
        "teamId": team_id,
        "projectId": project_id,
        "syncRepo": "project-forge",
        "bodyHash": body_hash,
        "subtaskHash": subtask_hash,
    }

    parts.append("---")
    parts.append("<!-- SPAWNFORGE_METADATA")
    parts.append(json.dumps(metadata, indent=2))
    parts.append("SPAWNFORGE_METADATA -->")

    return "\n".join(parts)


def parse_github_body(body):
    if not body:
        return None

    m = METADATA_RE.search(body)
    if m:
        try:
            meta = json.loads(m.group(1))
        except (json.JSONDecodeError, ValueError):
            meta = {}

        desc = ""
        lines = body.split("\n")
        desc_lines = []
        in_desc = False
        for line in lines:
            if line.startswith("**Priority:**"):
                in_desc = True
                continue
            if in_desc:
                if line.startswith("## Subtasks") or line.strip() == "---":
                    break
                desc_lines.append(line)
            if "<!-- SPAWNFORGE_METADATA" in line:
                break
        desc = "\n".join(desc_lines).strip()

        subtasks = []
        for sm in SUBTASK_RE.finditer(body):
            completed = sm.group(1).lower() == "x"
            subtasks.append({"title": sm.group(2).strip(), "completed": completed})

        return {
            "version": meta.get("version", 2),
            "ticketId": meta.get("ticketId", ""),
            "number": meta.get("number", 0),
            "priority": meta.get("priority", ""),
            "teamId": meta.get("teamId", ""),
            "projectId": meta.get("projectId", ""),
            "syncRepo": meta.get("syncRepo", ""),
            "bodyHash": meta.get("bodyHash", ""),
            "subtaskHash": meta.get("subtaskHash", ""),
            "description": desc,
            "subtasks": subtasks,
        }

    m = OLD_TASKBOARD_RE.search(body)
    if m:
        return {
            "version": 1,
            "ticketId": m.group(2),
            "number": int(m.group(1)),
            "priority": "",
            "teamId": "",
            "projectId": "",
            "syncRepo": "",
            "bodyHash": "",
            "subtaskHash": "",
            "description": "",
            "subtasks": [],
        }

    return None


def sync_subtasks_from_github(ticket_id, gh_subtasks):
    local_ticket = tb_get(f"/tickets/{ticket_id}")
    if not local_ticket:
        return
    local_subtasks = local_ticket.get("subtasks", [])
    local_by_title = {s.get("title", ""): s for s in local_subtasks}

    for gh_st in gh_subtasks:
        title = gh_st.get("title", "")
        completed = gh_st.get("completed", False)

        if title in local_by_title:
            local_st = local_by_title[title]
            if local_st.get("completed", False) != completed:
                st_id = local_st.get("id", "")
                if st_id:
                    try:
                        tb_put(f"/tickets/{ticket_id}/subtasks/{st_id}", {
                            "completed": completed,
                        })
                    except Exception:
                        pass
        else:
            try:
                tb_post(f"/tickets/{ticket_id}/subtasks", {
                    "title": title,
                    "completed": completed,
                })
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Taskboard API helpers
# ---------------------------------------------------------------------------

def _tb_urlopen(req_or_url, timeout):
    if _TB_SSL_CTX is not None:
        return urllib.request.urlopen(req_or_url, timeout=timeout, context=_TB_SSL_CTX)
    return urllib.request.urlopen(req_or_url, timeout=timeout)


def tb_available():
    try:
        _tb_urlopen(f"{TB_API}/board", timeout=2)
        return True
    except Exception:
        return False


def tb_get(path):
    try:
        resp = _tb_urlopen(f"{TB_API}{path}", timeout=5)
        return json.loads(resp.read())
    except Exception:
        return None


def tb_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{TB_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = _tb_urlopen(req, timeout=10)
    return json.loads(resp.read())


def tb_put(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{TB_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    resp = _tb_urlopen(req, timeout=10)
    return json.loads(resp.read())


# ---------------------------------------------------------------------------
# GitHub helpers (via gh CLI)
# ---------------------------------------------------------------------------

def gh_run(args, timeout=30, check=True):
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"gh failed: {result.stderr.strip()}")
    return result.stdout


def gh_get_project_items(config):
    # Check GraphQL rate limit before making expensive project query.
    # Each item costs ~1 token. With 800+ items, this call costs ~1000 tokens.
    # If budget is too low, skip the fetch entirely.
    try:
        rate_check = subprocess.run(
            ["gh", "api", "rate_limit", "--jq", ".resources.graphql.remaining"],
            capture_output=True, text=True, timeout=10,
        )
        remaining = int(rate_check.stdout.strip()) if rate_check.returncode == 0 else 5000
        if remaining < 1500:
            raise RuntimeError(
                f"GraphQL rate limit too low ({remaining}/5000). "
                f"Need ~1000 tokens for project sync. Skipping to preserve budget for PR ops."
            )
    except (ValueError, subprocess.TimeoutExpired):
        pass  # If rate check fails, proceed with the sync

    output = gh_run([
        "gh", "project", "item-list", str(config["projectNumber"]),
        "--owner", config["owner"], "--format", "json", "--limit", "1000",
    ])
    return json.loads(output)


def gh_get_repo_issues(config, state="open", limit=500):
    """Fetch issues directly from the repo via REST API (not the project board).

    This avoids the GraphQL project-items endpoint which is bloated with PRs
    and costs ~1 GraphQL token per item. The REST issues endpoint is cheaper
    and returns only issues (not PRs).
    """
    owner = config["owner"]
    repo = config["repo"]
    result = subprocess.run(
        [
            "gh", "issue", "list",
            "--repo", f"{owner}/{repo}",
            "--state", state,
            "--limit", str(limit),
            "--json", "number,title,body,state,labels,createdAt,closedAt",
        ],
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh issue list failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def gh_create_issue_and_add_to_project(config, ticket_id, title, body="", labels=None):
    owner = config["owner"]
    repo = config["repo"]

    create_args = [
        "gh", "api", f"repos/{owner}/{repo}/issues",
        "--method", "POST",
        "--raw-field", f"title={title}",
        "--raw-field", f"body={body or ''}",
    ]
    if labels:
        for label in labels:
            create_args.extend(["--field", f"labels[]={label}"])

    try:
        issue_data = json.loads(gh_run(create_args))
        issue_number = int(issue_data["number"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as e:
        raise RuntimeError(f"Issue creation returned an invalid response: {e}") from e

    # The REST issue is authoritative and already exists. Persist its number
    # before the best-effort Projects v2 mutation below so a GraphQL outage (or
    # a process killed immediately afterwards) cannot make the next push create
    # the same issue again.
    db_set_github_issue_number(ticket_id, issue_number)
    # The canonical URL is derivable from the persisted number. Do not make an
    # optional response field another failure point after creation succeeded.
    issue_url = f"https://github.com/{owner}/{repo}/issues/{issue_number}"

    item_id = gh_add_issue_to_project(config, issue_url, issue_number)
    return item_id, issue_number


def gh_add_issue_to_project(config, issue_url, issue_number):
    """Best-effort Projects v2 attachment for an existing REST issue."""
    try:
        add_result = gh_run([
            "gh", "project", "item-add", str(config["projectNumber"]),
            "--owner", config["owner"],
            "--url", issue_url,
            "--format", "json",
        ])
        item_id = json.loads(add_result).get("id", "")
        if not is_real_project_item_id(item_id):
            raise RuntimeError("project item-add returned no usable item ID")
    except Exception as e:
        print(
            f"  ! Issue #{issue_number} created, but project add failed: {e}",
            file=sys.stderr,
        )
        return None

    return item_id


def retry_project_attachment(config, entry, issue_number):
    """Retry pending project attachment/deletion without recreating an issue."""
    issue_url = (
        f"https://github.com/{config['owner']}/{config['repo']}/issues/{issue_number}"
    )

    if entry.get("projectAttachmentPending"):
        old_item_id = entry.get("githubItemId")
        # A process can die after the project mutation succeeds but before the
        # map is saved. Resolve first so recovery never adds a second item.
        new_item_id = gh_resolve_project_item_id(config, issue_number)
        if not new_item_id:
            new_item_id = gh_add_issue_to_project(config, issue_url, issue_number)
        if not new_item_id:
            return False
        entry["githubItemId"] = new_item_id
        entry.pop("projectAttachmentPending", None)
        entry["projectStatusPending"] = True
        if is_real_project_item_id(old_item_id) and old_item_id != new_item_id:
            entry["legacyProjectItemId"] = old_item_id

    legacy_item_id = entry.get("legacyProjectItemId")
    if is_real_project_item_id(legacy_item_id):
        try:
            gh_run([
                "gh", "project", "item-delete",
                str(config["projectNumber"]),
                "--owner", config["owner"],
                "--id", legacy_item_id,
            ])
            entry.pop("legacyProjectItemId", None)
        except Exception as e:
            text = str(e)
            if (
                "Could not resolve to a node" in text
                or "Could not find" in text
                or "not found" in text.lower()
            ):
                # Crash-idempotence: deletion may have succeeded immediately
                # before the process stopped and saved the map. Missing now is
                # the desired state, so clear the durable retry marker.
                entry.pop("legacyProjectItemId", None)
                return not entry.get("projectAttachmentPending")
            print(
                f"  ! Issue #{issue_number} attached, but old project item "
                f"cleanup failed: {e}",
                file=sys.stderr,
            )
            return False

    return not entry.get("projectAttachmentPending")


def gh_set_status(config, item_id, local_status):
    # Refusing here rather than at the call site makes the guard unbypassable:
    # every path into the Status mutation goes through this function, and a
    # synthetic id reaching GitHub costs a billed request that cannot succeed.
    # A refusal is reported as False, never raised — raising is what aborted the
    # ticket's update block before its memo fields were written, which is how
    # one failing mutation came back on every subsequent run.
    if not is_real_project_item_id(item_id):
        return False
    option_id = config["statusOptions"].get(local_status)
    if not option_id:
        return False
    gh_run([
        "gh", "project", "item-edit",
        "--project-id", config["projectId"],
        "--id", item_id,
        "--field-id", config["statusFieldId"],
        "--single-select-option-id", option_id,
    ])
    return True


def is_project_item_node_id(item_id):
    """Whether an ID can be passed to Projects v2 field mutations (#9429 name).

    Pull uses ``issue-<number>`` as a local correlation key for REST results.
    That value is deliberately not a GitHub node ID and must never reach
    ``gh project item-edit``. Tickets without a mapped project item still sync
    their issue body/state; only the project status-field mutation is skipped.

    Delegates to :func:`is_real_project_item_id`, which whitelists the ``PVTI_``
    typename prefix instead of blacklisting the one synthetic shape we happen to
    mint today — an unrecognised shape is refused rather than forwarded.
    """
    return is_real_project_item_id(item_id)


_ITEM_ID_QUERY = """
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    issue(number:$number) {
      projectItems(first: 20) { nodes { id project { id } } }
    }
  }
}
"""


def gh_resolve_project_item_id(config, issue_number):
    """Return the real Projects v2 item id for an issue, or None.

    None is a legitimate answer, not an error: an issue that was never added to
    the project has no item, and the Status field simply does not apply to it.

    This is a GraphQL *query* against one issue, not the `gh project item-list`
    fetch the rest of this module avoids — that one pages ~8000 board items and
    costs ~1000 points. It runs only when a ticket's status actually changed and
    the map has no cached id, so a converged board issues none at all.
    """
    try:
        out = gh_run([
            "gh", "api", "graphql",
            "-f", f"query={_ITEM_ID_QUERY}",
            # -f keeps a value a string; -F infers a type. owner/repo must stay
            # strings (a numeric-looking repo name would otherwise be sent as an
            # Int and fail the schema), and `number` must be an Int.
            "-f", f"owner={config['owner']}",
            "-f", f"repo={config['repo']}",
            "-F", f"number={int(issue_number)}",
        ], timeout=30)
    except Exception:
        return None
    try:
        nodes = (
            json.loads(out)["data"]["repository"]["issue"]["projectItems"]["nodes"]
        )
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    for node in nodes or []:
        if (node.get("project") or {}).get("id") == config["projectId"]:
            candidate = node.get("id")
            if is_real_project_item_id(candidate):
                return candidate
    return None


def gh_get_issue_state(config, issue_number):
    """Return "OPEN"/"CLOSED" for one issue, or None if it cannot be read."""
    owner = config["owner"]
    repo = config["repo"]
    try:
        out = gh_run([
            "gh", "issue", "view", str(issue_number),
            "--repo", f"{owner}/{repo}", "--json", "state",
        ], timeout=30)
        return json.loads(out).get("state")
    except Exception:
        return None


def gh_sync_issue_state(config, issue_number, local_status, prev_status=None):
    """Close GitHub issue when ticket moves to done, reopen only if moving back from done.

    Raises when the issue does not end up in the intended state. The close/reopen
    calls stay check=False because `gh` also exits non-zero for benign no-ops
    (closing an already-closed issue), so the exit code is not a usable signal —
    the resulting STATE is. Without this verification a silently-failed close
    still let the caller write `lastLocalStatus`, and the push-side change
    detector — which compares against that memo — never fired for the ticket
    again, latching the drift permanently.
    """
    owner = config["owner"]
    repo = config["repo"]
    repo_arg = f"{owner}/{repo}"
    if local_status == "done":
        want = "CLOSED"
        gh_run(["gh", "issue", "close", str(issue_number), "--repo", repo_arg,
                "--reason", "completed"], check=False)
    elif prev_status == "done":
        # Only reopen if the ticket was previously done — avoids overriding
        # manual GitHub issue closures for tickets that were never done locally
        want = "OPEN"
        gh_run(["gh", "issue", "reopen", str(issue_number), "--repo", repo_arg],
               check=False)
    else:
        return

    actual = gh_get_issue_state(config, issue_number)
    if actual != want:
        # `actual is None` means the state could not be read at all. That is an
        # UNVERIFIED state, not a passing one: letting it through would record
        # the memo for a close nothing confirmed, which is precisely the latch
        # this function exists to remove. Every call site treats the raise as a
        # per-ticket error and carries on, so failing here costs one ticket's
        # sync for this run rather than the run.
        raise RuntimeError(
            f"issue #{issue_number} is {actual or 'unreadable'}, expected "
            f"{want} after state sync"
        )


def gh_update_issue(config, issue_number, title=None, body=None):
    owner = config["owner"]
    repo = config["repo"]
    args = [
        "gh", "issue", "edit", str(issue_number),
        "--repo", f"{owner}/{repo}",
    ]
    if title:
        args.extend(["--title", title])
    if body:
        args.extend(["--body", body])
    if len(args) > 5:
        gh_run(args)


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

def local_to_github(config, local_status):
    return config["localToGithubStatus"].get(local_status, "Todo")


def github_to_local(config, github_status):
    reverse = {v: k for k, v in config["localToGithubStatus"].items()}
    return reverse.get(github_status, "todo")


# ---------------------------------------------------------------------------
# PUSH: local taskboard → GitHub Project
# ---------------------------------------------------------------------------

class BoundedErrorLog:
    """Print the first few errors of a kind, then just count the rest.

    A run that fails once per ticket used to emit one stderr line per ticket —
    894 of them, which is how a systemic failure came to look like ordinary
    noise in `.sync.log` for weeks. The first few lines carry the diagnosis; the
    count carries the scale.
    """

    def __init__(self, limit=5):
        self.limit = limit
        self.count = 0

    def add(self, message):
        self.count += 1
        if self.count <= self.limit:
            print(f"  ! {message}", file=sys.stderr)
        elif self.count == self.limit + 1:
            print("  ! (further errors suppressed — see the run summary)",
                  file=sys.stderr)

    def summary(self, label):
        if self.count > self.limit:
            return f"{self.count} {label} (first {self.limit} shown)"
        return f"{self.count} {label}" if self.count else ""


class ProjectFieldSync:
    """Best-effort Projects v2 Status writes, with a per-run circuit breaker.

    The board's Status field is a MIRROR of the ticket status; the issue's
    open/closed state (verified by gh_sync_issue_state) is the load-bearing
    signal. So a failure here must never abort the ticket's update block — that
    is precisely what latched the change detector and made every push replay the
    whole board. It is counted, capped, and reported instead.
    """

    def __init__(self, limit=PROJECT_FIELD_FAILURE_LIMIT):
        self.limit = limit
        self.failures = 0
        self.applied = 0
        self.unmapped = 0
        self.tripped = False

    def _trip(self, reason):
        if not self.tripped:
            self.tripped = True
            print(f"  [project-field] disabled for this run: {reason}",
                  file=sys.stderr)

    def apply(self, config, entry, issue_number, status, display):
        """Mirror `status` onto the board. Never raises."""
        if self.tripped:
            return False
        item_id = entry.get("githubItemId")
        if not is_real_project_item_id(item_id):
            item_id = gh_resolve_project_item_id(config, issue_number) if issue_number else None
            if not item_id:
                # The issue is not on the board (or could not be read). There is
                # no field to write, so this is not an error — it is a no-op we
                # record once so the summary can show it.
                self.unmapped += 1
                entry.pop("githubItemId", None)
                return False
            entry["githubItemId"] = item_id
        try:
            if not gh_set_status(config, item_id, status):
                # The id we resolved is not one GitHub can act on after all, or
                # the status has no board option. Nothing was spent; record it
                # the same way an issue that is not on the board is recorded.
                self.unmapped += 1
                entry.pop("githubItemId", None)
                return False
            self.applied += 1
            return True
        except Exception as e:
            self.failures += 1
            text = str(e)
            if "Could not resolve to a node" in text:
                # Systemic: the ids we hold are not ids GitHub knows. Retrying
                # per ticket only spends quota, so stop after the first one.
                entry.pop("githubItemId", None)
                self._trip(f"unresolvable project item id ({text[:120]})")
                return False
            print(f"  ! Board status failed {display}: {text}", file=sys.stderr)
            if self.failures >= self.limit:
                self._trip(f"{self.failures} consecutive failures")
            return False

    def summary(self):
        parts = []
        if self.applied:
            parts.append(f"{self.applied} board-status")
        if self.unmapped:
            parts.append(f"{self.unmapped} not on board")
        if self.failures:
            parts.append(f"{self.failures} board-status failed")
        return parts


def _try_lock_exclusive(lock_fd):
    """Take a non-blocking exclusive lock on an open file. False if held.

    Both backends are chosen so the OS drops the lock when the process dies:
    a crashed sync must not wedge every later run. An atomic O_EXCL lock file
    would have been simpler and would have had exactly that failure mode.
    """
    try:
        if fcntl is not None:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            lock_fd.seek(0)
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except (IOError, OSError):
        return False


def _release_lock(lock_fd):
    """Release a lock taken by _try_lock_exclusive.

    Failures are swallowed: closing the handle releases the lock on both
    platforms anyway, and raising here would mask the caller's own exception
    when this runs in a finally block.
    """
    try:
        if fcntl is not None:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        else:
            lock_fd.seek(0)
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
    except (IOError, OSError):
        pass


LOCK_PATH = _MAIN_HOOKS / ".sync-push.lock"
LOCK_WANTED_PATH = _MAIN_HOOKS / ".sync-lock-wanted"
# How recently another run must have asked for the lock for the holder to yield.
LOCK_WANTED_TTL_SECONDS = 300


def request_sync_lock():
    """Record that a run wanted the lock but could not get it."""
    try:
        LOCK_WANTED_PATH.write_text(str(time.time()))
    except OSError:
        pass


def sync_lock_wanted():
    """True if another run asked for the lock recently and is still waiting."""
    try:
        stamp = float(LOCK_WANTED_PATH.read_text().strip())
    except (OSError, ValueError):
        return False
    return 0 <= (time.time() - stamp) <= LOCK_WANTED_TTL_SECONDS


def clear_sync_lock_request():
    try:
        LOCK_WANTED_PATH.unlink()
    except OSError:
        pass


def with_sync_lock(label, fn):
    """Run `fn` under the exclusive sync lock, or skip if another run holds it.

    push and reconcile write the same two systems, so they must not interleave:
    reconcile decides from a snapshot of GitHub state that a concurrent push is
    busy invalidating. Shared rather than duplicated because reconcile now runs
    detached from session start, which is what makes the overlap reachable.

    A skipped run leaves a note behind. The holder is the long reconcile sweep
    over every issue in the repo; without the note it has no way to learn that
    the interactive push it is blocking has come and gone, and the Stop hook
    fires often enough that the sweep could starve several turns' worth of them
    in a row.
    """
    lock_fd = open(LOCK_PATH, "w")
    if not _try_lock_exclusive(lock_fd):
        print(f"[SYNC] Another sync is already running — skipping {label}")
        request_sync_lock()
        lock_fd.close()
        return
    clear_sync_lock_request()
    try:
        return fn()
    finally:
        _release_lock(lock_fd)
        lock_fd.close()


def push(include_done=False):
    return with_sync_lock("push", lambda: _push_inner(include_done))


def _push_inner(include_done=False):
    return taskboard_sync.run(sys.modules[__name__], "push", include_done)



def pull():
    return with_sync_lock("pull", lambda: taskboard_sync.run(sys.modules[__name__], "pull"))


def show_status():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)
    if not project_id:
        print("[FATAL] resolve_project_id() returned empty/None. Aborting status.", file=sys.stderr)
        sys.exit(1)
    target_repo = config["repo"]

    print(f"Database: {DB_PATH} ({'exists' if DB_PATH.exists() else 'MISSING'})")
    print(f"GitHub Project: {config['owner']}/{config['repo']} #{config['projectNumber']}")
    print(f"Last sync: {mapping.get('lastSync') or 'never'}")
    print(f"Tracked tickets (map): {len(tmap)}")

    syncable = db_get_syncable_ticket_ids(target_repo)
    print(f"Syncable tickets (DB sync_repo={target_repo}): {len(syncable)}")

    conn = db_connect()
    if conn:
        cur = conn.execute("SELECT COUNT(*) FROM tickets WHERE github_issue_number IS NOT NULL")
        linked = cur.fetchone()[0]
        cur = conn.execute("SELECT COUNT(*) FROM tickets")
        total = cur.fetchone()[0]
        conn.close()
        print(f"Linked to GitHub issues: {linked}/{total}")

    tickets = tb_get(f"/tickets?project={project_id}")
    if tickets:
        pending = []
        for t in tickets:
            tid = t["id"]
            if tid in tmap and tmap[tid].get("lastLocalStatus") != t.get("status"):
                num = t.get("number", "?")
                pending.append(
                    f"  PF-{num}: {tmap[tid]['lastLocalStatus']} -> {t['status']}"
                )

        if pending:
            print(f"\nPending outbound changes ({len(pending)}):")
            for p in pending:
                print(p)
        else:
            print("No pending outbound changes")


# ---------------------------------------------------------------------------
# MIGRATE DRAFTS (legacy compat)
# ---------------------------------------------------------------------------

def migrate_drafts():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})

    legacy = {tid: e for tid, e in tmap.items() if not e.get("githubIssueNumber")}
    total = len(legacy)
    if total == 0:
        print("[MIGRATE] No legacy draft items to migrate.")
        return

    print(f"[MIGRATE] Found {total} legacy draft items to convert to real issues.")

    migrated = 0
    errors = 0
    skipped = 0

    for tid, entry in legacy.items():
        old_item_id = entry.get("githubItemId", "")
        title = entry.get("title", "Untitled")
        status = entry.get("lastLocalStatus", "todo")

        # The database is the durable deduplication source. A previous process
        # may have been killed after REST creation persisted this link but before
        # the map was saved; recover that issue instead of creating another one.
        existing_issue_number = db_get_github_issue_number(tid)
        if existing_issue_number is not None:
            entry["githubIssueNumber"] = existing_issue_number
            entry["projectAttachmentPending"] = True
            migrated += 1
            print(f"  -> {title} -> recovered issue #{existing_issue_number}")
            continue

        full_ticket = tb_get(f"/tickets/{tid}")
        if not full_ticket:
            skipped += 1
            continue

        full_ticket["id"] = tid

        try:
            body = format_github_body(full_ticket)
            new_item_id, gh_issue_number = gh_create_issue_and_add_to_project(
                config, tid, title, body
            )
            # Record the durable issue link before any best-effort board write.
            entry["githubIssueNumber"] = gh_issue_number
            if new_item_id:
                entry["githubItemId"] = new_item_id
                entry.pop("projectAttachmentPending", None)
                try:
                    if not gh_set_status(config, new_item_id, status):
                        entry["projectStatusPending"] = True
                except Exception as e:
                    entry["projectStatusPending"] = True
                    print(
                        f"  ! Issue #{gh_issue_number} created, but project "
                        f"status failed: {e}",
                        file=sys.stderr,
                    )
                if is_real_project_item_id(old_item_id) and old_item_id != new_item_id:
                    entry["legacyProjectItemId"] = old_item_id
                    retry_project_attachment(config, entry, gh_issue_number)
            else:
                # Preserve the legacy item until a later push successfully adds
                # the already-created REST issue and can delete the replacement.
                entry["projectAttachmentPending"] = True
            entry["bodyHash"] = compute_body_hash(full_ticket)
            entry["subtaskHash"] = compute_subtask_hash(full_ticket.get("subtasks", []))
            entry["metadataVersion"] = 3

            migrated += 1
            print(f"  -> {title} -> Issue #{gh_issue_number}")
        except Exception as e:
            errors += 1
            print(f"  ! {title}: {e}", file=sys.stderr)

        if migrated % 5 == 0:
            mapping["tickets"] = tmap
            save_map(mapping)

    mapping["tickets"] = tmap
    save_map(mapping)
    print(f"[MIGRATE] Done: {migrated} migrated, {skipped} skipped, {errors} errors")


# ---------------------------------------------------------------------------
# DEDUP: Clean up duplicate local tickets
# ---------------------------------------------------------------------------

def dedup_local():
    raise RuntimeError("Automatic duplicate deletion is disabled. Reconcile explicit repository/issue identities; never titles.")


def close_orphan_issues():
    raise RuntimeError("Automatic orphan closure is disabled. Equal titles do not establish duplicate identity.")


def assert_not_truncated(row_count, limit):
    """Raise when a listing came back at its own limit.

    A truncated list is worse than a failed one: every unseen issue looks
    "missing" to classify_drift(), which declines to touch it, so the drift is
    silently preserved rather than fixed. Measured 2026-08-18 — a limit of
    5000 against 7954 issues hid ~2950 and misreported 8 live links as gone.
    """
    if row_count >= limit:
        raise RuntimeError(
            f"issue listing returned {row_count} rows at limit {limit} — the "
            "list is truncated and reconcile would misreport the unseen "
            "issues as missing. Raise the limit."
        )


def classify_drift(tickets, tmap, states, resolve_link=None, syncable_ids=None):
    """Sort tickets into the four reconciliation buckets.

    Does no I/O of its own — every input, including the link lookup, is
    injected, which is what makes the decision logic testable at all.

    `states` maps issue number -> "OPEN"/"CLOSED". Terminal state wins in both
    directions: a closed issue means the ticket is done, a done ticket means
    the issue should be closed. Tickets absent from `tmap` are not ours to
    reconcile and are skipped entirely.

    `resolve_link(ticket_id)` supplies the authoritative issue number from the
    taskboard database, which is the precedence push() itself applies: the map
    file is a cache and can be stale or lost, and reconciling against a stale
    number is worse than not reconciling at all. Injected rather than called
    directly so this stays pure and testable; omitted, the map is used alone.

    `syncable_ids` is the set of ticket IDs whose `sync_repo` names the repo
    these `states` came from — the same hard filter push() applies. The
    taskboard holds tickets for more than one repo, and an issue number is only
    meaningful against the repo it was minted in: #500 exists in most repos, so
    a ticket belonging to another one can be read against a same-numbered issue
    here and marked done off a closure that has nothing to do with it. Injected
    for the same reason as `resolve_link`; omitted, no scope filter is applied.
    """
    to_close = []      # local done, issue open
    to_done = []       # issue closed, local not done
    unlinked = []      # carries an issue number this repo does not have
    never_linked = []  # no issue number at all — nothing to reconcile against

    for t in tickets:
        if syncable_ids is not None and t["id"] not in syncable_ids:
            # Belongs to another repo. Its issue number indexes a different
            # issue list, so nothing here can say anything true about it.
            continue
        entry = tmap.get(t["id"])
        if not entry:
            continue
        num = resolve_link(t["id"]) if resolve_link else None
        if not num:
            num = entry.get("githubIssueNumber")
        if not num:
            # Distinct from a dangling link: no issue was ever created, so
            # there is no GitHub state to disagree with. push() creates one
            # for any non-done ticket; a done one stays as-is.
            never_linked.append((t, num))
            continue
        state = states.get(num)
        if state is None:
            unlinked.append((t, num))
            continue
        local_done = t.get("status") == "done"
        gh_closed = state == "CLOSED"
        if local_done == gh_closed:
            continue
        (to_close if local_done else to_done).append((t, num))

    return to_close, to_done, unlinked, never_linked


def gh_get_issue_states(config, limit=50000):
    """Every issue in the repo as {number: state}.

    pull() fetches only the 100 most recently closed issues, which is a
    recency WINDOW, not a view of the repo: an issue closed before that window
    can never be seen by pull again, so a ticket left behind by a bulk closure
    is unreachable by the normal sync no matter how many times it runs.

    `limit` must exceed the repo's issue count or this reintroduces exactly
    that defect at a larger size — a truncated list reports every unseen issue
    as "missing", which reconcile then declines to touch, so the drift is
    silently preserved rather than fixed. Getting back exactly `limit` rows
    means truncation is possible, so it raises instead of returning a partial
    view. (Measured 2026-08-18: 7954 issues; the original 5000 hid ~2950.)
    """
    owner = config["owner"]
    repo = config["repo"]
    result = subprocess.run(
        [
            "gh", "issue", "list",
            "--repo", f"{owner}/{repo}",
            "--state", "all",
            "--limit", str(limit),
            "--json", "number,state",
        ],
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh issue list failed: {result.stderr.strip()}")
    rows = json.loads(result.stdout)
    assert_not_truncated(len(rows), limit)
    return {i["number"]: i["state"] for i in rows}


def reconcile(apply_changes=False):
    return with_sync_lock("reconcile", lambda: _reconcile_inner(apply_changes))


def _reconcile_inner(apply_changes=False):
    """Idempotent, state-based reconciliation of local status vs GitHub issue state.

    push() and pull() both decide whether to act by comparing against a
    REMEMBERED value in the map (`lastLocalStatus` / `lastGithubStatus`). That
    memo is written from intent rather than from observation, so any ticket
    whose update failed once — or whose issue sits outside pull's closed-issue
    recency window — is latched: the change detector never fires for it again
    and the two systems disagree forever.

    This pass compares the two systems' ACTUAL states, so it cannot latch and
    is safe to re-run. Terminal state wins in both directions: a closed issue
    marks its ticket done, a done ticket closes its issue.
    """
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)
    if not project_id:
        print("[FATAL] resolve_project_id() returned empty/None. Aborting.", file=sys.stderr)
        sys.exit(1)

    if not tb_available():
        print("[SYNC] Taskboard API unavailable — skipping reconcile")
        return

    tickets = tb_get(f"/tickets?project={project_id}")
    if tickets is None:
        print("[SYNC] Taskboard API unavailable — skipping reconcile")
        return

    # HARD FILTER: only reconcile tickets whose sync_repo matches this repo —
    # the same scope push() enforces. Without it a ticket belonging to another
    # repo is read against THIS repo's issue list, where its number names an
    # unrelated issue, and a closure over there marks it done over here.
    syncable_ids = db_get_syncable_ticket_ids(config["repo"])
    if not syncable_ids:
        # Empty means the database could not be read (db_connect returns None
        # on failure and this returns an empty set for it), not that the repo
        # legitimately owns nothing — push auto-tags every ticket it touches.
        # Reconciling against an empty scope is a silent no-op that reads as a
        # clean run, so say so and stop.
        print(
            "[SYNC] No tickets carry sync_repo for "
            f"{config['repo']} (database unreadable?) — skipping reconcile",
            file=sys.stderr,
        )
        return

    states = gh_get_issue_states(config)
    in_scope = sum(1 for t in tickets if t["id"] in syncable_ids)
    print(
        f"  [reconcile] {in_scope} local tickets in scope "
        f"({len(tickets) - in_scope} for other repos) vs {len(states)} GitHub issues"
    )

    to_close, to_done, unlinked, never_linked = classify_drift(
        tickets,
        tmap,
        states,
        resolve_link=db_get_github_issue_number,
        syncable_ids=syncable_ids,
    )

    print(f"  issue CLOSED but ticket not done : {len(to_done)}")
    print(f"  ticket done but issue OPEN       : {len(to_close)}")
    print(f"  mapped to a missing issue        : {len(unlinked)}")
    print(f"  no issue ever created            : {len(never_linked)}")

    if not apply_changes:
        for t, n in to_done[:20]:
            print(f"    would set done   PF-{t['number']:<5} #{n:<6} {t['title'][:56]}")
        for t, n in to_close[:20]:
            print(f"    would close      PF-{t['number']:<5} #{n:<6} {t['title'][:56]}")
        for t, n in unlinked[:20]:
            print(f"    ! no such issue  PF-{t['number']:<5} #{n}")
        print("  (dry run — pass 'reconcile-apply' to write these changes)")
        return

    fixed = 0
    errlog = BoundedErrorLog()
    deferred = 0
    started = time.monotonic()

    # This sweep runs detached from SessionStart and holds the same exclusive
    # lock push takes, so every second it spends is a Stop-hook push that
    # skipped. Give it a ceiling, and let a waiting push cut it short: the
    # sweep is state-based and idempotent, so an early stop costs nothing but
    # the remainder, which the next sweep recomputes from scratch.
    def _should_stop():
        return (
            time.monotonic() - started > RECONCILE_TIME_BUDGET_SECONDS
            or sync_lock_wanted()
        )

    for t, num in to_done:
        if _should_stop():
            deferred += 1
            continue
        try:
            tb_post(f"/tickets/{t['id']}/move", {"status": "done"})
            e = tmap.setdefault(t["id"], {})
            e["lastLocalStatus"] = "done"
            e["lastGithubStatus"] = local_to_github(config, "done")
            fixed += 1
        except Exception as exc:
            errlog.add(f"PF-{t['number']} -> done failed: {exc}")

    for t, num in to_close:
        if _should_stop():
            deferred += 1
            continue
        try:
            gh_sync_issue_state(config, num, "done", prev_status="in_progress")
            e = tmap.setdefault(t["id"], {})
            e["lastLocalStatus"] = "done"
            e["lastGithubStatus"] = local_to_github(config, "done")
            fixed += 1
        except Exception as exc:
            errlog.add(f"close #{num} failed: {exc}")

    mapping["tickets"] = tmap
    save_map(mapping)
    summary = f"[reconcile] {fixed} reconciled, {errlog.count} errors, {len(unlinked)} unlinked left alone"
    if deferred:
        summary += f", {deferred} deferred (yielded to a waiting push)"
    print(f"{summary} ({time.monotonic() - started:.1f}s)")


COMMANDS = {
    "push": lambda: push(include_done=False),
    "push-all": lambda: push(include_done=True),
    "pull": pull,
    "status": show_status,
    "migrate-drafts": migrate_drafts,
    "dedup": dedup_local,
    "close-orphans": close_orphan_issues,
    "reconcile": lambda: reconcile(apply_changes=False),
    "reconcile-apply": lambda: reconcile(apply_changes=True),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Usage: {sys.argv[0]} {{{' | '.join(COMMANDS)}}}")
        sys.exit(1)

    # Checked here as well as in the wrapper scripts: `status` and the manual
    # commands are run by hand, and a switch that only some entry points honour
    # is not a switch. Exit 0 — a disabled sync is a deliberate state, not a
    # failure, and the Stop hook must not surface it as one.
    _off = sync_disabled_reason()
    if _off:
        print(f"[SYNC] disabled ({_off}) — skipping {sys.argv[1]}")
        sys.exit(0)

    try:
        COMMANDS[sys.argv[1]]()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        print(f"[SYNC ERROR] {e}", file=sys.stderr)
        sys.exit(1)
