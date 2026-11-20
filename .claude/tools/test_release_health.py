"""Check the release gate with synthetic GitHub and live service responses."""

from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "skills/env-health-check/scripts/release_health.py"
SPEC = importlib.util.spec_from_file_location("release_health", SCRIPT)
health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health)
RELEASE = "a" * 40


class Health(unittest.TestCase):
    def setUp(self):
        now = datetime.now(timezone.utc)
        self.age = now.isoformat()
        self.reported = {
            "commit": RELEASE[:8], "environment": "production", "status": "ok", "timestamp": self.age,
            "services": [{"name": name, "status": "up", "lastChecked": self.age} for name in health.CRITICAL],
        }
        self.records = {
            "deployments/42": {"id": 42, "sha": RELEASE, "environment": "production"},
            "deployments/42/statuses?per_page=1": [{"state": "success", "environment": "production"}],
            "actions/runs/24": {"id": 24, "head_sha": RELEASE, "path": ".github/workflows/cd.yml",
                                "status": "completed", "conclusion": "success", "run_attempt": 1},
            "actions/runs/24/attempts/1/jobs?per_page=100": {
                "jobs": [{
                    "name": "Deploy to Production", "conclusion": "success", "completed_at": self.age,
                    "steps": [{"name": name, "conclusion": "success"} for name in (
                        "Post-deploy health check (production)", "Run production smoke tests",
                    )],
                }],
            },
            "issues/123": {"number": 123, "state": "closed", "state_reason": "completed"},
        }
        self.plan = {
            "artifact": "SpawnForge", "environment": "production", "revision": RELEASE,
            "requirements": {"authentication": "SF-PUBLIC-JOURNEY"},
            "issues": {"123": "SF-CUSTOMER-SMOKE"},
        }

    def fake_http(self, url):
        if url.endswith("/api/health"):
            return 200, json.dumps(self.reported).encode()
        return 200, b"<html>Synthetic page</html>"

    def run_cli(self, with_plan=True, extra=()):
        args = [str(SCRIPT), "--environment", "production", "--release", RELEASE,
                "--deployment-id", "42", "--run-id", "24", *extra]
        with tempfile.TemporaryDirectory() as tmp:
            if with_plan:
                path = Path(tmp) / "approved-plan.json"
                path.write_text(json.dumps(self.plan))
                args += ["--completion-plan", str(path)]
            report = io.StringIO()
            with (
                patch.object(sys, "argv", args),
                patch.object(health, "observe", wraps=lambda *argv, **kwargs: observe(*argv, self.fake_http, self.records.__getitem__, **kwargs)),
                patch.object(health, "completion", wraps=lambda *argv: completion(*argv, self.records.__getitem__)),
                redirect_stdout(report),
            ):
                code = health.main()
        return code, json.loads(report.getvalue())

    def test_healthy_release_and_verified_scope_can_complete(self):
        code, report = self.run_cli()
        self.assertEqual(code, 0)
        self.assertEqual(report["completion"], "complete")
        self.assertEqual(self.run_cli(with_plan=False)[1]["completion"], "incomplete")

    def test_wrong_release_and_wrong_environment_fail(self):
        for field, value in (("commit", "bbbbbbbb"), ("environment", "staging")):
            original = self.reported[field]
            self.reported[field] = value
            code, result = self.run_cli()
            self.assertEqual(code, 1)
            self.assertEqual(result["completion"], "incomplete")
            self.reported[field] = original

    def test_provider_grading_keeps_critical_outage_and_optional_impact(self):
        self.reported["services"].append({"name": "AI Providers", "status": "degraded", "lastChecked": self.age})
        self.assertEqual(self.run_cli()[1]["health"], "degraded")
        self.assertEqual(self.run_cli(extra=("--critical-service", "AI Providers"))[1]["health"], "failed")
        self.reported["services"][0]["status"] = "down"
        self.assertEqual(self.run_cli()[1]["health"], "failed")

    def test_stale_observation_or_smoke_remains_unknown(self):
        job = self.records["actions/runs/24/attempts/1/jobs?per_page=100"]["jobs"][0]
        job["completed_at"] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        self.assertEqual(self.run_cli()[1]["health"], "unknown")
        job["completed_at"] = self.age
        self.reported["timestamp"] = (datetime.now(timezone.utc) - timedelta(minutes=12)).isoformat()
        self.assertEqual(self.run_cli()[1]["health"], "unknown")

    def test_outstanding_or_unmapped_issue_cannot_complete(self):
        self.records["issues/123"]["state"] = "open"
        self.assertEqual(self.run_cli()[0], 4)
        self.records["issues/123"]["state"] = "closed"
        self.plan["issues"]["123"] = "unavailable-behavior-proof"
        self.assertEqual(self.run_cli()[0], 4)


observe = health.observe
completion = health.completion

if __name__ == "__main__":
    unittest.main()
