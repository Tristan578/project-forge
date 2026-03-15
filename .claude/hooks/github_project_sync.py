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

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
TB_API = "http://localhost:3010/api"


# ---------------------------------------------------------------------------
# Worktree-safe path resolution
# ---------------------------------------------------------------------------
# When running from a git worktree (.claude/worktrees/agent-*/), all paths
# must resolve to the MAIN repo checkout. Otherwise the sync script uses
# a stale DB copy and creates duplicate GitHub issues.

def _find_main_repo_root() -> Path:
    """Return the primary repo root, even when called from a worktree."""
    candidate = SCRIPT_DIR.parent.parent  # .claude/hooks -> .claude -> repo
    parts = candidate.parts
    for i, part in enumerate(parts):
        if part == "worktrees" and i > 0 and parts[i - 1] == ".claude":
            return Path(*parts[: i - 1])
    return candidate


PROJECT_ROOT = _find_main_repo_root()
_MAIN_HOOKS = PROJECT_ROOT / ".claude" / "hooks"
CONFIG_PATH = _MAIN_HOOKS / "github-sync-config.json"
MAP_PATH = _MAIN_HOOKS / "github-project-map.json"
DB_PATH = PROJECT_ROOT / ".claude" / "taskboard.db"


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
    if "project" in _resolved_cache:
        return _resolved_cache["project"]

    project_name = config.get("allowedProjectName")
    if not project_name:
        result = config.get("localProjectId", "")
        if not result:
            print("[FATAL] No allowedProjectName and no localProjectId in config. Cannot resolve project.", file=sys.stderr)
            sys.exit(1)
        _resolved_cache["project"] = result
        return result

    projects = tb_get("/projects")
    if projects:
        for proj in projects:
            if proj.get("name", "").lower() == project_name.lower():
                _resolved_cache["project"] = proj["id"]
                return proj["id"]

    try:
        prefix = config.get("allowedProjectPrefix", "PF")
        new_proj = tb_post("/projects", {"name": project_name, "prefix": prefix})
        pid = new_proj.get("id")
        if pid:
            print(f"  [bootstrap] Created project: {project_name} ({pid})")
            _resolved_cache["project"] = pid
            return pid
    except Exception as e:
        print(f"  [bootstrap] Failed to create project {project_name}: {e}", file=sys.stderr)

    fallback = config.get("localProjectId")
    if not fallback:
        print(f"[FATAL] Project name lookup failed for '{project_name}' and no localProjectId fallback in config.", file=sys.stderr)
        sys.exit(1)
    print(f"  [WARN] Project name lookup failed for '{project_name}', using config fallback: {fallback}", file=sys.stderr)
    _resolved_cache["project"] = fallback
    return fallback


def load_map():
    if MAP_PATH.exists():
        try:
            with open(MAP_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"lastSync": None, "tickets": {}}


def save_map(mapping):
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
    conn = sqlite3.connect(str(DB_PATH))
    _ensure_sync_columns(conn)
    return conn


_migration_checked = False


def _ensure_sync_columns(conn):
    """Auto-migrate: add github_issue_number and sync_repo if missing.

    This runs on EVERY db_connect() call (cached after first check) so that
    new developers pulling the repo get the columns automatically on first sync.
    """
    global _migration_checked
    if _migration_checked:
        return

    columns = {
        row[1]
        for row in conn.execute("PRAGMA table_info(tickets)").fetchall()
    }

    if "github_issue_number" not in columns:
        conn.execute("ALTER TABLE tickets ADD COLUMN github_issue_number INTEGER DEFAULT NULL")
        print("  [migrate] Added github_issue_number column to tickets table")

    if "sync_repo" not in columns:
        conn.execute("ALTER TABLE tickets ADD COLUMN sync_repo TEXT DEFAULT NULL")
        print("  [migrate] Added sync_repo column to tickets table")

    # Create indices if missing (idempotent)
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_github_issue "
            "ON tickets(github_issue_number) WHERE github_issue_number IS NOT NULL"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tickets_sync_repo "
            "ON tickets(sync_repo) WHERE sync_repo IS NOT NULL"
        )
    except Exception:
        pass  # indices may already exist

    conn.commit()
    _migration_checked = True


def db_get_github_issue_number(ticket_id):
    conn = db_connect()
    if not conn:
        return None
    try:
        cur = conn.execute(
            "SELECT github_issue_number FROM tickets WHERE id = ?", (ticket_id,)
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
            "UPDATE tickets SET github_issue_number = ?, sync_repo = ? WHERE id = ?",
            (issue_number, load_config()["repo"], ticket_id),
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
            "SELECT id FROM tickets WHERE github_issue_number = ?", (issue_number,)
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
            "SELECT id FROM tickets WHERE sync_repo = ?", (repo_name,)
        )
        return {row[0] for row in cur.fetchall()}
    finally:
        conn.close()


def db_find_by_title(title, repo_name):
    """Find the canonical ticket ID for a given title (lowest number = original).
    Returns (ticket_id, github_issue_number) or (None, None).
    """
    conn = db_connect()
    if not conn:
        return None, None
    try:
        cur = conn.execute(
            "SELECT id, github_issue_number FROM tickets "
            "WHERE title = ? AND sync_repo = ? "
            "ORDER BY number ASC LIMIT 1",
            (title, repo_name),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else (None, None)
    finally:
        conn.close()


def db_find_by_title_scoped(title, repo_name, project_id=None):
    """Find a ticket with this title scoped to the target repo OR untagged.
    Never crosses project boundaries — only matches tickets that belong to
    the same repo or have no sync_repo set (untagged orphans).

    When project_id is provided, the untagged-orphan branch of the OR clause
    is further constrained to that project so tickets from other projects are
    not matched.

    Returns (ticket_id, github_issue_number) or (None, None).
    """
    conn = db_connect()
    if not conn:
        return None, None
    try:
        if project_id:
            cur = conn.execute(
                "SELECT id, github_issue_number FROM tickets "
                "WHERE title = ? AND ("
                "  sync_repo = ? "
                "  OR ((sync_repo IS NULL OR sync_repo = '') AND project_id = ?)"
                ") "
                "ORDER BY number ASC LIMIT 1",
                (title, repo_name, project_id),
            )
        else:
            cur = conn.execute(
                "SELECT id, github_issue_number FROM tickets "
                "WHERE title = ? AND (sync_repo = ? OR sync_repo IS NULL OR sync_repo = '') "
                "ORDER BY number ASC LIMIT 1",
                (title, repo_name),
            )
        row = cur.fetchone()
        return (row[0], row[1]) if row else (None, None)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# V2 body format: regex constants
# ---------------------------------------------------------------------------

METADATA_RE = re.compile(
    r"<!-- SPAWNFORGE_METADATA\n(.*?)\nSPAWNFORGE_METADATA -->",
    re.DOTALL,
)
OLD_TASKBOARD_RE = re.compile(
    r"\*\*Taskboard:\*\*\s*PF-(\d+)\s*\(([A-Z0-9]+)\)"
)
SUBTASK_RE = re.compile(r"^[ \t]*[-*] \[([ xX])\] (.+)$", re.MULTILINE)


# ---------------------------------------------------------------------------
# V2 body format: helpers
# ---------------------------------------------------------------------------

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
    project_id = ticket.get("projectId", "01KK974VMNC16ZAW7MW1NH3T3M")

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

def tb_available():
    try:
        urllib.request.urlopen(f"{TB_API}/board", timeout=2)
        return True
    except Exception:
        return False


def tb_get(path):
    try:
        resp = urllib.request.urlopen(f"{TB_API}{path}", timeout=5)
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
    resp = urllib.request.urlopen(req, timeout=10)
    return json.loads(resp.read())


def tb_put(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{TB_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    resp = urllib.request.urlopen(req, timeout=10)
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
    output = gh_run([
        "gh", "project", "item-list", str(config["projectNumber"]),
        "--owner", config["owner"], "--format", "json", "--limit", "1000",
    ])
    return json.loads(output)


def gh_create_issue_and_add_to_project(config, title, body="", labels=None):
    owner = config["owner"]
    repo = config["repo"]

    create_args = [
        "gh", "issue", "create",
        "--repo", f"{owner}/{repo}",
        "--title", title,
        "--body", body or "",
    ]
    if labels:
        for label in labels:
            create_args.extend(["--label", label])

    result = subprocess.run(
        create_args,
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Issue creation failed: {result.stderr.strip()}")

    issue_url = result.stdout.strip()
    issue_number = int(issue_url.rstrip("/").split("/")[-1])

    add_result = gh_run([
        "gh", "project", "item-add", str(config["projectNumber"]),
        "--owner", owner,
        "--url", issue_url,
        "--format", "json",
    ])
    item_data = json.loads(add_result)
    item_id = item_data.get("id", "")

    if not item_id:
        raise RuntimeError(f"Failed to get project item ID for issue #{issue_number}")

    return item_id, issue_number


def gh_set_status(config, item_id, local_status):
    option_id = config["statusOptions"].get(local_status)
    if not option_id:
        return
    gh_run([
        "gh", "project", "item-edit",
        "--project-id", config["projectId"],
        "--id", item_id,
        "--field-id", config["statusFieldId"],
        "--single-select-option-id", option_id,
    ])


def gh_sync_issue_state(config, issue_number, local_status, prev_status=None):
    """Close GitHub issue when ticket moves to done, reopen only if moving back from done."""
    owner = config["owner"]
    repo = config["repo"]
    repo_arg = f"{owner}/{repo}"
    if local_status == "done":
        gh_run(["gh", "issue", "close", str(issue_number), "--repo", repo_arg,
                "--reason", "completed"], check=False)
    elif prev_status == "done":
        # Only reopen if the ticket was previously done — avoids overriding
        # manual GitHub issue closures for tickets that were never done locally
        gh_run(["gh", "issue", "reopen", str(issue_number), "--repo", repo_arg],
               check=False)


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

def push(include_done=False):
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)
    if not project_id:
        print("[FATAL] resolve_project_id() returned empty/None. Aborting push.", file=sys.stderr)
        sys.exit(1)
    target_repo = config["repo"]

    # HARD FILTER: Only sync tickets whose sync_repo matches this project
    syncable_ids = db_get_syncable_ticket_ids(target_repo)

    tickets = tb_get(f"/tickets?project={project_id}")
    if tickets is None:
        print("[SYNC] Taskboard API unavailable — skipping push")
        return

    created = 0
    updated = 0
    skipped = 0
    filtered = 0
    errors = 0

    for ticket in tickets:
        tid = ticket["id"]
        status = ticket.get("status", "todo")
        title = ticket.get("title", "Untitled")
        number = ticket.get("number", 0)
        display = f"PF-{number}: {title}" if number else title

        # HARD PROJECT ISOLATION: skip any ticket not marked for this repo.
        # Auto-tag PF-project tickets that haven't been tagged yet
        # (covers tickets created via taskboard UI or MCP before sync_repo existed).
        if tid not in syncable_ids:
            # Check if this ticket belongs to the PF project — if so, auto-tag it
            ticket_project = ticket.get("projectId", "")
            if ticket_project == project_id:
                conn = db_connect()
                if conn:
                    try:
                        conn.execute(
                            "UPDATE tickets SET sync_repo = ? WHERE id = ? AND sync_repo IS NULL",
                            (target_repo, tid),
                        )
                        conn.commit()
                    finally:
                        conn.close()
                    syncable_ids.add(tid)
                # Now it's syncable, continue processing
            else:
                filtered += 1
                continue

        # Skip done tickets that were already synced as done
        if status == "done" and not include_done:
            if tid in tmap and tmap[tid].get("lastLocalStatus") == "done":
                skipped += 1
                continue

        # Check SQLite for existing github_issue_number (source of truth)
        gh_issue_num = db_get_github_issue_number(tid)

        # Fetch full ticket with subtasks
        full_ticket = tb_get(f"/tickets/{tid}")
        if full_ticket is None:
            full_ticket = ticket
        full_ticket["id"] = tid

        cur_body_hash = compute_body_hash(full_ticket)
        cur_subtask_hash = compute_subtask_hash(full_ticket.get("subtasks", []))

        if gh_issue_num is None and tid not in tmap:
            # --- DEDUP CHECK: does another local ticket with the same title
            #     already have a github_issue_number?  If so, this is a dup
            #     created by a previous pull cycle — skip it. ---
            canonical_tid, canonical_gh = db_find_by_title(title, target_repo)
            if canonical_gh and canonical_tid and canonical_tid != tid:
                # This is a dup — skip creating a new issue.
                # Do NOT set github_issue_number on the dup (UNIQUE constraint).
                # Just record the mapping so we can track it.
                tmap[tid] = {
                    "githubIssueNumber": canonical_gh,
                    "lastLocalStatus": status,
                    "lastGithubStatus": local_to_github(config, status),
                    "title": display,
                    "number": number,
                    "bodyHash": cur_body_hash,
                    "subtaskHash": cur_subtask_hash,
                    "metadataVersion": 3,
                }
                skipped += 1
                continue

            # --- New ticket: create GitHub Issue ---
            try:
                body = format_github_body(full_ticket)
                item_id, new_gh_num = gh_create_issue_and_add_to_project(
                    config, display, body
                )
                gh_set_status(config, item_id, status)
                # Close the issue immediately if created as done
                if status == "done":
                    gh_sync_issue_state(config, new_gh_num, status)

                # IMMEDIATELY write github_issue_number back to SQLite
                db_set_github_issue_number(tid, new_gh_num)

                tmap[tid] = {
                    "githubItemId": item_id,
                    "githubIssueNumber": new_gh_num,
                    "lastLocalStatus": status,
                    "lastGithubStatus": local_to_github(config, status),
                    "title": display,
                    "number": number,
                    "bodyHash": cur_body_hash,
                    "subtaskHash": cur_subtask_hash,
                    "metadataVersion": 3,
                }
                created += 1
                print(f"  + {display} [{status}] -> #{new_gh_num}")
            except Exception as e:
                errors += 1
                print(f"  ! Create failed {display}: {e}", file=sys.stderr)

        elif gh_issue_num is not None:
            # --- Existing ticket: check for changes ---
            # Ensure map entry exists (may have been lost)
            if tid not in tmap:
                tmap[tid] = {
                    "githubIssueNumber": gh_issue_num,
                    "lastLocalStatus": "",
                    "lastGithubStatus": "",
                    "title": display,
                    "number": number,
                    "bodyHash": "",
                    "subtaskHash": "",
                    "metadataVersion": 2,
                }

            entry = tmap[tid]
            # Sync github issue number from DB if map is stale
            if not entry.get("githubIssueNumber"):
                entry["githubIssueNumber"] = gh_issue_num

            status_changed = entry.get("lastLocalStatus") != status
            body_changed = entry.get("bodyHash") != cur_body_hash
            subtask_changed = entry.get("subtaskHash") != cur_subtask_hash
            needs_upgrade = entry.get("metadataVersion", 0) < 3

            if not (status_changed or body_changed or subtask_changed or needs_upgrade):
                skipped += 1
                continue

            try:
                body = format_github_body(full_ticket)
                gh_update_issue(config, gh_issue_num, body=body)

                if status_changed:
                    item_id = entry.get("githubItemId")
                    if item_id:
                        gh_set_status(config, item_id, status)
                    # Close/reopen the GitHub issue to match local status
                    gh_sync_issue_state(config, gh_issue_num, status,
                                        prev_status=entry.get("lastLocalStatus"))

                entry["lastLocalStatus"] = status
                entry["lastGithubStatus"] = local_to_github(config, status)
                entry["bodyHash"] = cur_body_hash
                entry["subtaskHash"] = cur_subtask_hash
                entry["metadataVersion"] = 3
                updated += 1

                reasons = []
                if status_changed:
                    reasons.append(f"status->{status}")
                if body_changed:
                    reasons.append("body")
                if subtask_changed:
                    reasons.append("subtasks")
                print(f"  ~ {display} [{', '.join(reasons)}]")
            except Exception as e:
                errors += 1
                print(f"  ! Update failed {display}: {e}", file=sys.stderr)

        else:
            # tid in tmap but no github_issue_number in DB — legacy entry
            # Re-populate DB from map if possible
            map_num = tmap.get(tid, {}).get("githubIssueNumber")
            if map_num:
                db_set_github_issue_number(tid, map_num)
            skipped += 1

    mapping["tickets"] = tmap
    save_map(mapping)

    if filtered:
        print(f"  [filter] {filtered} tickets skipped (wrong sync_repo)")

    if created or updated or errors:
        parts = []
        if created:
            parts.append(f"{created} created")
        if updated:
            parts.append(f"{updated} updated")
        if errors:
            parts.append(f"{errors} errors")
        print(f"[SYNC->GH] {', '.join(parts)}")


# ---------------------------------------------------------------------------
# PULL: GitHub Project → local taskboard
# ---------------------------------------------------------------------------

def pull():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)
    if not project_id:
        print("[FATAL] resolve_project_id() returned empty/None. Aborting pull.", file=sys.stderr)
        sys.exit(1)
    target_repo = config["repo"]

    if not tb_available():
        print("[SYNC] Taskboard API unavailable — skipping pull")
        return

    try:
        gh_data = gh_get_project_items(config)
    except Exception as e:
        print(f"[SYNC] GitHub fetch failed: {e}", file=sys.stderr)
        return

    items = gh_data.get("items", [])

    # Build reverse map: GitHub item ID → local ticket ID
    reverse_item = {e["githubItemId"]: tid for tid, e in tmap.items() if e.get("githubItemId")}
    # Build reverse map: GitHub issue number → local ticket ID (from SQLite)
    reverse_issue = {}
    conn = db_connect()
    if conn:
        try:
            for row in conn.execute(
                "SELECT id, github_issue_number FROM tickets WHERE github_issue_number IS NOT NULL AND sync_repo = ?",
                (target_repo,),
            ):
                reverse_issue[row[1]] = row[0]
        finally:
            conn.close()

    created = 0
    updated = 0
    relinked = 0
    skipped = 0
    filtered = 0
    errors = 0

    for item in items:
        item_id = item.get("id", "")
        gh_status = item.get("status", "") or ""
        title = item.get("title", "")

        content = item.get("content") or {}
        if content.get("title"):
            title = content["title"]

        if not title:
            skipped += 1
            continue

        local_status = github_to_local(config, gh_status)
        body = content.get("body", "") if content else ""
        parsed = parse_github_body(body)
        gh_issue_num = content.get("number") if content else None

        # --- Priority 1: Match by github_issue_number (authoritative) ---
        if gh_issue_num and gh_issue_num in reverse_issue:
            tid = reverse_issue[gh_issue_num]
            entry = tmap.get(tid, {})
            any_change = False

            if entry.get("lastGithubStatus") != gh_status:
                try:
                    tb_post(f"/tickets/{tid}/move", {"status": local_status})
                    any_change = True
                except Exception as e:
                    errors += 1
                    print(f"  ! Status update failed {title}: {e}", file=sys.stderr)

            # Ensure map entry is current
            if tid not in tmap:
                tmap[tid] = {}
            tmap[tid].update({
                "githubItemId": item_id,
                "githubIssueNumber": gh_issue_num,
                "lastLocalStatus": local_status if any_change else entry.get("lastLocalStatus", local_status),
                "lastGithubStatus": gh_status,
                "title": title,
            })

            if parsed and parsed.get("version", 0) >= 2:
                remote_body_hash = parsed.get("bodyHash", "")
                if remote_body_hash and entry.get("bodyHash") != remote_body_hash:
                    update_fields = {}
                    if parsed.get("description"):
                        update_fields["description"] = parsed["description"]
                    if parsed.get("priority"):
                        update_fields["priority"] = parsed["priority"]
                    if update_fields:
                        try:
                            tb_put(f"/tickets/{tid}", update_fields)
                        except Exception:
                            pass
                    tmap[tid]["bodyHash"] = remote_body_hash
                    any_change = True

                remote_subtask_hash = parsed.get("subtaskHash", "")
                if remote_subtask_hash and entry.get("subtaskHash") != remote_subtask_hash:
                    try:
                        sync_subtasks_from_github(tid, parsed.get("subtasks", []))
                    except Exception:
                        pass
                    tmap[tid]["subtaskHash"] = remote_subtask_hash
                    any_change = True

            if any_change:
                updated += 1
                print(f"  ~ {title} -> {local_status}")
            else:
                skipped += 1
            continue

        # --- Priority 2: Match by map item ID (legacy compat) ---
        if item_id in reverse_item:
            tid = reverse_item[item_id]
            entry = tmap[tid]
            any_change = False

            if entry.get("lastGithubStatus") != gh_status:
                try:
                    tb_post(f"/tickets/{tid}/move", {"status": local_status})
                    entry["lastLocalStatus"] = local_status
                    entry["lastGithubStatus"] = gh_status
                    any_change = True
                except Exception as e:
                    errors += 1

            # Backfill github_issue_number into SQLite if missing
            if gh_issue_num and not db_get_github_issue_number(tid):
                db_set_github_issue_number(tid, gh_issue_num)
                entry["githubIssueNumber"] = gh_issue_num

            if any_change:
                updated += 1
            else:
                skipped += 1
            continue

        # --- Priority 3: Untracked item — strict filtering before import ---
        content_type = content.get("type", "") if content else ""
        if content_type not in ("Issue", "DraftIssue", ""):
            skipped += 1
            continue

        # HARD FILTER: Only import if metadata confirms this is a SpawnForge ticket
        if not parsed:
            filtered += 1
            continue

        sync_repo = parsed.get("syncRepo", "")
        if sync_repo and sync_repo != target_repo:
            filtered += 1
            continue

        # If syncRepo matches, allow. Otherwise, projectId MUST match local PF project.
        meta_project = parsed.get("projectId", "")
        if not sync_repo:
            if not meta_project or meta_project != project_id:
                filtered += 1
                continue

        # Check for re-link by ticketId in metadata
        if parsed.get("ticketId"):
            meta_tid = parsed["ticketId"]
            local_ticket = tb_get(f"/tickets/{meta_tid}")
            if local_ticket and meta_tid not in tmap:
                # Only re-link if the local ticket belongs to this project
                if local_ticket.get("projectId") != project_id:
                    filtered += 1
                    continue
                entry_data = {
                    "githubItemId": item_id,
                    "lastLocalStatus": local_ticket.get("status", "todo"),
                    "lastGithubStatus": gh_status,
                    "title": title,
                    "number": local_ticket.get("number", 0),
                    "bodyHash": parsed.get("bodyHash", ""),
                    "subtaskHash": parsed.get("subtaskHash", ""),
                    "metadataVersion": parsed.get("version", 2),
                }
                if gh_issue_num:
                    entry_data["githubIssueNumber"] = gh_issue_num
                    db_set_github_issue_number(meta_tid, gh_issue_num)
                tmap[meta_tid] = entry_data

                if local_ticket.get("status") != local_status:
                    try:
                        tb_post(f"/tickets/{meta_tid}/move", {"status": local_status})
                        tmap[meta_tid]["lastLocalStatus"] = local_status
                    except Exception:
                        pass
                relinked += 1
                print(f"  * Re-linked {title} by ULID")
                continue

        # --- DEDUP CHECK: does a local ticket with this title already exist? ---
        clean_title = title
        if title.startswith("PF-") and ": " in title:
            clean_title = title.split(": ", 1)[1]

        existing_tid, existing_gh = db_find_by_title_scoped(clean_title, target_repo, project_id)
        # Only relink if the existing ticket has no GH issue yet, or already
        # points to the same GH issue.  If it points to a DIFFERENT issue,
        # this is a genuine different ticket with the same title — skip dedup.
        # Also reject drafts (gh_issue_num=None) trying to claim a ticket
        # that already has a GH issue link.
        can_relink = (
            existing_tid
            and (not existing_gh or (gh_issue_num and existing_gh == gh_issue_num))
        )
        if can_relink:
            if gh_issue_num and not existing_gh:
                db_set_github_issue_number(existing_tid, gh_issue_num)
            # Ensure sync_repo is set (tag untagged orphans)
            conn = db_connect()
            if conn:
                try:
                    conn.execute(
                        "UPDATE tickets SET sync_repo = ? WHERE id = ? AND (sync_repo IS NULL OR sync_repo = '')",
                        (target_repo, existing_tid),
                    )
                    conn.commit()
                finally:
                    conn.close()

            entry_data = {
                "githubItemId": item_id,
                "lastLocalStatus": local_status,
                "lastGithubStatus": gh_status,
                "title": title,
                "bodyHash": parsed.get("bodyHash", ""),
                "subtaskHash": parsed.get("subtaskHash", ""),
                "metadataVersion": parsed.get("version", 2),
            }
            if gh_issue_num:
                entry_data["githubIssueNumber"] = gh_issue_num
            tmap[existing_tid] = entry_data

            # Update status if changed
            local_ticket = tb_get(f"/tickets/{existing_tid}")
            if local_ticket and local_ticket.get("status") != local_status:
                try:
                    tb_post(f"/tickets/{existing_tid}/move", {"status": local_status})
                    entry_data["lastLocalStatus"] = local_status
                except Exception:
                    pass

            relinked += 1
            print(f"  * Linked existing {clean_title} to #{gh_issue_num or '?'}")
            continue

        # --- Create new local ticket (truly new — no local match) ---
        priority = parsed.get("priority") or "medium"
        description = parsed.get("description") or body
        team_id = parsed.get("teamId")

        try:
            create_data = {
                "title": clean_title,
                "description": description,
                "priority": priority,
                "projectId": project_id,
            }
            if team_id:
                create_data["teamId"] = team_id

            new_ticket = tb_post("/tickets", create_data)
            new_tid = new_ticket.get("id", "")
            new_num = new_ticket.get("number", 0)

            if new_tid:
                if local_status != "todo":
                    tb_post(f"/tickets/{new_tid}/move", {"status": local_status})

                # Write github_issue_number to SQLite immediately
                if gh_issue_num:
                    db_set_github_issue_number(new_tid, gh_issue_num)

                if parsed.get("subtasks"):
                    for st in parsed["subtasks"]:
                        try:
                            tb_post(f"/tickets/{new_tid}/subtasks", {
                                "title": st.get("title", ""),
                                "completed": st.get("completed", False),
                            })
                        except Exception:
                            pass

                new_entry = {
                    "githubItemId": item_id,
                    "lastLocalStatus": local_status,
                    "lastGithubStatus": gh_status,
                    "title": title,
                    "number": new_num,
                    "bodyHash": parsed.get("bodyHash", ""),
                    "subtaskHash": parsed.get("subtaskHash", ""),
                    "metadataVersion": parsed.get("version", 1),
                }
                if gh_issue_num:
                    new_entry["githubIssueNumber"] = gh_issue_num
                tmap[new_tid] = new_entry
                created += 1
                print(f"  + PF-{new_num}: {clean_title} [{local_status}]")
        except Exception as e:
            errors += 1
            print(f"  ! Create local failed {title}: {e}", file=sys.stderr)

    mapping["tickets"] = tmap
    save_map(mapping)

    if filtered:
        print(f"  [filter] {filtered} items skipped (wrong project / no metadata)")

    if created or updated or relinked or errors:
        parts = []
        if created:
            parts.append(f"{created} created locally")
        if updated:
            parts.append(f"{updated} updated locally")
        if relinked:
            parts.append(f"{relinked} re-linked")
        if errors:
            parts.append(f"{errors} errors")
        print(f"[SYNC<-GH] {', '.join(parts)}")


# ---------------------------------------------------------------------------
# STATUS
# ---------------------------------------------------------------------------

def show_status():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)
    if not project_id:
        print("[FATAL] resolve_project_id() returned empty/None. Aborting status.", file=sys.stderr)
        sys.exit(1)
    target_repo = config["repo"]

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

        full_ticket = tb_get(f"/tickets/{tid}")
        if not full_ticket:
            skipped += 1
            continue

        full_ticket["id"] = tid

        try:
            body = format_github_body(full_ticket)
            new_item_id, gh_issue_number = gh_create_issue_and_add_to_project(
                config, title, body
            )
            gh_set_status(config, new_item_id, status)

            if old_item_id:
                try:
                    gh_run([
                        "gh", "project", "item-delete",
                        str(config["projectNumber"]),
                        "--owner", config["owner"],
                        "--id", old_item_id,
                    ])
                except Exception:
                    pass

            entry["githubItemId"] = new_item_id
            entry["githubIssueNumber"] = gh_issue_number
            entry["bodyHash"] = compute_body_hash(full_ticket)
            entry["subtaskHash"] = compute_subtask_hash(full_ticket.get("subtasks", []))
            entry["metadataVersion"] = 3

            # Write to SQLite
            db_set_github_issue_number(tid, gh_issue_number)

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
    """Delete duplicate local tickets, keeping only the lowest-number copy.

    For each group of tickets with the same title:
      - Keep the one with the lowest PF number (the original)
      - If the original has no github_issue_number but a dup does, copy it over
      - Delete all other copies from SQLite and remove from map
    """
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    target_repo = config["repo"]

    conn = db_connect()
    if not conn:
        print("[DEDUP] Cannot connect to database")
        return

    try:
        # Resolve project_id: prefer tickets already tagged to this repo, fall
        # back to resolve_project_id() so dedup works even on a fresh DB.
        pid_row = conn.execute(
            "SELECT project_id FROM tickets WHERE sync_repo = ? LIMIT 1",
            (target_repo,),
        ).fetchone()
        resolved_project_id = pid_row[0] if pid_row else None
        if not resolved_project_id:
            resolved_project_id = resolve_project_id(config)
        if not resolved_project_id:
            print("[DEDUP] Cannot determine project_id — no tagged tickets and resolve_project_id() returned None. Skipping.")
            return

        # Find all titles with duplicates (across ALL sync_repo values, not just target)
        cur = conn.execute(
            "SELECT title, COUNT(*) as cnt FROM tickets "
            "WHERE project_id = ? "
            "GROUP BY title HAVING cnt > 1",
            (resolved_project_id,),
        )
        dup_titles = [(row[0], row[1]) for row in cur.fetchall()]

        if not dup_titles:
            print("[DEDUP] No duplicates found")
            return

        total_removed = 0
        total_groups = len(dup_titles)

        for title, count in dup_titles:
            cur = conn.execute(
                "SELECT id, number, github_issue_number FROM tickets "
                "WHERE title = ? ORDER BY number ASC",
                (title,),
            )
            rows = cur.fetchall()

            # Keep the first (lowest number) as canonical
            canonical_id, canonical_num, canonical_gh = rows[0]

            # Find if any dup has a github_issue_number we should inherit
            inherit_gh = None
            if not canonical_gh:
                for _, _, gh_num in rows[1:]:
                    if gh_num:
                        inherit_gh = gh_num
                        break

            # Delete all duplicates FIRST (before updating canonical,
            # to avoid UNIQUE constraint violation on github_issue_number)
            for dup_id, dup_num, _ in rows[1:]:
                conn.execute("DELETE FROM tickets WHERE id = ?", (dup_id,))
                # Remove subtasks for this ticket
                try:
                    conn.execute("DELETE FROM subtasks WHERE ticket_id = ?", (dup_id,))
                except Exception:
                    pass  # subtasks table may not exist or have different schema
                # Remove from map
                tmap.pop(dup_id, None)
                total_removed += 1

            # Now safe to inherit github_issue_number (dups are deleted)
            if inherit_gh:
                canonical_gh = inherit_gh
                conn.execute(
                    "UPDATE tickets SET github_issue_number = ? WHERE id = ?",
                    (inherit_gh, canonical_id),
                )

            print(f"  PF-{canonical_num}: {title} — kept, removed {count - 1} dups")

        conn.commit()
        mapping["tickets"] = tmap
        save_map(mapping)
        print(f"\n[DEDUP] Removed {total_removed} duplicates across {total_groups} groups")

    finally:
        conn.close()


def close_orphan_issues():
    """Close GitHub issues that are duplicates (same title, higher issue number).

    Groups issues by full title. For each group with >1 issue,
    keeps the lowest issue number open and closes the rest (without comment,
    to minimize API calls and rate limit impact).

    Rate-limited: processes in batches with delays to avoid GitHub API limits.
    """
    config = load_config()
    owner = config["owner"]
    repo = config["repo"]

    print("[CLOSE-ORPHANS] Fetching all open issues...")

    # Fetch all open issues (paginated)
    all_issues = []
    page = 1
    while True:
        try:
            output = gh_run([
                "gh", "api", f"repos/{owner}/{repo}/issues",
                "--method", "GET",
                "-f", "state=open",
                "-f", f"per_page=100",
                "-f", f"page={page}",
            ], timeout=60)
            issues = json.loads(output)
            if not issues:
                break
            # Filter out PRs (they show up in issues API too)
            real_issues = [i for i in issues if "pull_request" not in i]
            all_issues.extend(real_issues)
            page += 1
        except Exception as e:
            print(f"  [WARN] Fetch page {page} failed: {e}", file=sys.stderr)
            break

    print(f"  Found {len(all_issues)} open issues")

    # Group by title — only consider issues with PF- prefixed titles to avoid
    # accidentally closing unrelated issues that happen to share a title.
    PF_TITLE_RE = re.compile(r"^PF-\d+: ")
    by_title = {}
    for issue in all_issues:
        title = issue.get("title", "")
        if not PF_TITLE_RE.match(title):
            continue
        if title not in by_title:
            by_title[title] = []
        by_title[title].append(issue)

    # Find groups with duplicates
    to_close = []
    for title, issues in by_title.items():
        if len(issues) <= 1:
            continue
        # Sort by issue number — keep lowest
        issues.sort(key=lambda i: i["number"])
        canonical = issues[0]
        for dup in issues[1:]:
            to_close.append((dup["number"], canonical["number"], title))

    if not to_close:
        print("[CLOSE-ORPHANS] No duplicate issues found")
        return

    print(f"  Will close {len(to_close)} duplicate issues")

    import time
    closed = 0
    errors = 0
    for dup_num, canonical_num, title in to_close:
        try:
            # Close without comment to avoid rate limits on addComment
            gh_run([
                "gh", "issue", "close", str(dup_num),
                "--repo", f"{owner}/{repo}",
            ])
            closed += 1
            if closed % 10 == 0:
                print(f"  ... closed {closed}/{len(to_close)}")
                sys.stdout.flush()
            # Rate limit: ~1 req/sec to stay under GitHub secondary limits
            time.sleep(1.0)
        except Exception as e:
            errors += 1
            print(f"  ! Close #{dup_num} failed: {e}", file=sys.stderr)
            # If rate limited, back off more
            if "too quickly" in str(e) or "rate" in str(e).lower():
                time.sleep(10.0)

    print(f"[CLOSE-ORPHANS] Closed {closed} duplicates, {errors} errors")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

COMMANDS = {
    "push": lambda: push(include_done=False),
    "push-all": lambda: push(include_done=True),
    "pull": pull,
    "status": show_status,
    "migrate-drafts": migrate_drafts,
    "dedup": dedup_local,
    "close-orphans": close_orphan_issues,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Usage: {sys.argv[0]} {{{' | '.join(COMMANDS)}}}")
        sys.exit(1)

    try:
        COMMANDS[sys.argv[1]]()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        print(f"[SYNC ERROR] {e}", file=sys.stderr)
        sys.exit(1)
