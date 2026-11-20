"""Check a pinned SpawnForge release using GitHub deployment and live evidence."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import subprocess
from urllib import error, request


REPO = "repos/Tristan578/project-forge"
ORIGINS = {
    "production": "https://www.spawnforge.ai",
    "staging": "https://spawnforge-staging.vercel.app",
}
CRITICAL = {"Database (Neon)", "Clerk", "Engine CDN", "Chat Backend", "Payments (Stripe)"}
SHA = re.compile(r"[0-9a-f]{40}")


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url):
    opener = request.build_opener(NoRedirect)
    try:
        with opener.open(request.Request(url, headers={"Cache-Control": "no-cache"}), timeout=12) as response:
            return response.status, response.read(262_145)
    except error.HTTPError as response:
        with response:
            return response.code, response.read(262_145)


def github(path):
    raw = subprocess.run(
        ["gh", "api", f"{REPO}/{path}"], capture_output=True,
        check=True, encoding="utf-8", timeout=20,
    ).stdout
    return json.loads(raw)


def observe(environment, release, deploy_id, run_id, fetch_url=fetch, github_api=github, extra_critical=()):
    checks = {}
    critical = CRITICAL | set(extra_critical)

    def check(name, operation):
        try:
            checks[name] = operation()
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
            checks[name] = ("unknown", "required evidence could not be read or validated")

    origin = ORIGINS[environment]
    now = datetime.now(timezone.utc)

    def fresh(value, days=0, minutes=0):
        age = now - datetime.fromisoformat(value)
        return -timedelta(seconds=60) <= age <= timedelta(days=days, minutes=minutes)

    def deployment():
        record = github_api(f"deployments/{deploy_id}")
        if (record["id"], record["sha"], record["environment"]) != (deploy_id, release, environment):
            return "failed", "GitHub deployment identity mismatch"
        statuses = github_api(f"deployments/{deploy_id}/statuses?per_page=1")
        if not statuses:
            return "unknown", "deployment status missing"
        state = statuses[0]["state"]
        if statuses[0]["environment"] != environment:
            return "failed", "GitHub deployment status targets another environment"
        return ("healthy", "matching GitHub deployment") if state == "success" else (
            "failed" if state in {"error", "failure", "inactive"} else "unknown",
            "deployment status " + state,
        )

    def live_health():
        code, body = fetch_url(origin + "/api/health")
        if code not in (200, 503) or len(body) > 262_144:
            return "unknown", f"health endpoint returned HTTP {code} or oversized evidence"
        data = json.loads(body)
        if data["commit"] != release[:8] or data["environment"] != environment:
            return "failed", "live release prefix or environment mismatch"
        if not fresh(data["timestamp"], minutes=10):
            return "unknown", "stale live health receipt"
        services = {}
        for service in data["services"]:
            name = service["name"]
            if name in services or service["status"] not in {"up", "down", "degraded", "unknown", "unconfigured"}:
                return "unknown", "invalid service report"
            if not fresh(service["lastChecked"], minutes=10):
                services[name] = "unknown"
            else:
                services[name] = service["status"]
        unavailable = sorted(name for name in critical if services.get(name) in {"down", "degraded", "unconfigured"})
        if unavailable or code == 503 or data["status"] == "error":
            return "failed", "blocked critical services: " + (", ".join(unavailable) or "application")
        if data["status"] != "ok" or any(services.get(name) in (None, "unknown") for name in critical):
            return "unknown", "critical service evidence missing"
        affected = sorted(name for name, status in services.items() if status != "up")
        return ("degraded", ", ".join(affected)) if affected else ("healthy", "live services up")

    def public_journey():
        for path, label in (("/", "landing"), ("/sign-in", "sign-in")):
            code, body = fetch_url(origin + path)
            if environment == "staging" and code in (301, 302, 307, 308, 401, 403):
                return "unknown", f"staging {label} page requires approved access"
            if code != 200 or b"<html" not in body.lower():
                return "failed", f"{label} page unavailable (HTTP {code})"
            if environment == "production" and b"pk_test_" in body:
                return "failed", f"production {label} page is using test-mode sign-in"
        return "healthy", "public landing and sign-in routes responded"

    def cd_evidence():
        run = github_api(f"actions/runs/{run_id}")
        if (run["id"], run["head_sha"], run["path"]) != (run_id, release, ".github/workflows/cd.yml"):
            return "failed", "CD run does not identify the release"
        if run["status"] != "completed":
            return "unknown", "CD run incomplete"
        if run["conclusion"] != "success":
            return "failed", "CD failed. Inspect run and job diagnostics for cause."
        attempt = run["run_attempt"]
        jobs = github_api(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")["jobs"]
        name = f"Deploy to {environment.title()}"
        matching = [j for j in jobs if j["name"] == name]
        if len(matching) != 1:
            return "unknown", "target deployment job evidence missing or ambiguous"
        job = matching[0]
        steps = {s["name"]: s["conclusion"] for s in job["steps"]}
        if job["conclusion"] != "success" or steps.get(f"Post-deploy health check ({environment})") != "success":
            return "unknown", "no successful target health check in the selected run"
        if steps.get(f"Run {environment} smoke tests") != "success":
            return "unknown", "target customer smoke evidence missing"
        if not fresh(job["completed_at"], days=1):
            return "unknown", "customer smoke evidence is older than 24 hours"
        return "healthy", "fresh target CD health and customer smoke steps passed"

    check("SF-RELEASE-ID", deployment)
    check("SF-LIVE-SERVICES", live_health)
    check("SF-PUBLIC-JOURNEY", public_journey)
    check("SF-CUSTOMER-SMOKE", cd_evidence)
    grades = {grade for grade, _ in checks.values()}
    overall = next((grade for grade in ("failed", "unknown", "degraded") if grade in grades), "healthy")
    return {
        "artifact": "SpawnForge",
        "revision": release,
        "environment": environment,
        "checked_at": now.isoformat(),
        "evidence": {"deployment_id": deploy_id, "run_id": run_id},
        "health": overall,
        "checks": checks,
        "completion": "incomplete",
    }


def completion(plan, report, github_api=github):
    """Resolve a separately approved requirement and discovered-issue inventory."""
    if (
        plan["artifact"] != report["artifact"]
        or plan["environment"] != report["environment"]
        or plan["revision"] != report["revision"]
        or not plan["requirements"]
        or not isinstance(plan["requirements"], dict)
        or not isinstance(plan["issues"], dict)
    ):
        raise ValueError("missing or mismatched completion scope")
    if report["health"] != "healthy":
        return "incomplete"
    checks = report["checks"]
    for check_id in [*plan["requirements"].values(), *plan["issues"].values()]:
        if not isinstance(check_id, str) or checks.get(check_id, ("unknown",))[0] != "healthy":
            return "incomplete"
    for issue in plan["issues"]:
        if not re.fullmatch(r"[1-9][0-9]*", issue):
            raise ValueError("issue inventory requires SpawnForge GitHub issue numbers")
        record = github_api(f"issues/{issue}")
        if (
            record.get("number") != int(issue)
            or "pull_request" in record
            or record.get("state") != "closed"
            or record.get("state_reason") != "completed"
        ):
            return "incomplete"
    return "complete"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", choices=ORIGINS, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--deployment-id", type=int, required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--critical-service", action="append", default=[],
                        help="Additional required service from the release scope")
    parser.add_argument("--completion-plan", type=Path, help="Separately approved scope and issue inventory")
    args = parser.parse_args()
    if not SHA.fullmatch(args.release) or min(args.deployment_id, args.run_id) <= 0:
        parser.error("expected a full release SHA and positive GitHub evidence IDs")
    report = observe(args.environment, args.release, args.deployment_id, args.run_id,
                     extra_critical=args.critical_service)
    if args.completion_plan:
        try:
            report["completion"] = completion(json.loads(args.completion_plan.read_text(encoding="utf8")), report)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
            report["completion_blocker"] = "completion scope or issue evidence could not be validated"
    print(json.dumps(report, indent=2))
    if args.completion_plan and report["health"] == "healthy" and report["completion"] != "complete":
        return 4
    return {"healthy": 0, "failed": 1, "degraded": 2, "unknown": 3}[report["health"]]


if __name__ == "__main__":
    raise SystemExit(main())
