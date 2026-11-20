"""Exercise the installed Claude Code with a loopback model and synthetic files."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from review_board import isolated_command, run_seat


class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        return

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if "/messages?" not in self.path and not self.path.endswith("/messages"):
            self.send_error(404)
            return
        tools = {tool["name"] for tool in payload.get("tools", [])}
        self.server.tool_sets.append(tools)
        messages = payload.get("messages", [])
        results = [
            block for message in messages if isinstance(message["content"], list)
            for block in message["content"] if block.get("type") == "tool_result"
        ]
        if results:
            self.server.tool_results.extend(results)
        call = None
        if self.server.attempt and not results:
            call = self.server.attempt
        elif "Read" in tools and not results:
            call = ("Read", {"file_path": str(self.server.fixture)})
        elif "StructuredOutput" in tools and not results:
            call = ("StructuredOutput", {"verdict": "PASS", "findings": []})

        content = (
            {"type": "tool_use", "id": "toolu_fixture", "name": call[0], "input": call[1]}
            if call else {"type": "text", "text": "synthetic fixture response"}
        )
        reason = "tool_use" if call else "end_turn"
        usage = {"input_tokens": 10, "output_tokens": 10}
        message = {
            "id": "msg_fixture", "type": "message", "role": "assistant",
            "model": payload["model"], "content": [content],
            "stop_reason": reason, "stop_sequence": None, "usage": usage,
        }
        self.send_response(200)
        if payload.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if call:
                start = {**content, "input": {}}
                delta = {"type": "input_json_delta", "partial_json": json.dumps(call[1])}
            else:
                start = {"type": "text", "text": ""}
                delta = {"type": "text_delta", "text": content["text"]}
            events = [
                ("message_start", {"message": {**message, "content": [], "stop_reason": None}}),
                ("content_block_start", {"index": 0, "content_block": start}),
                ("content_block_delta", {"index": 0, "delta": delta}),
                ("content_block_stop", {"index": 0}),
                ("message_delta", {"delta": {"stop_reason": reason, "stop_sequence": None}, "usage": usage}),
                ("message_stop", {}),
            ]
            for kind, data in events:
                self.wfile.write(f"event: {kind}\ndata: {json.dumps({'type': kind, **data})}\n\n".encode())
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(message).encode())


class NativeReviewer(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cwd = Path(directory.name)
        self.fixture = self.cwd / "test.txt"
        self.fixture.write_text("SYNTHETIC READ MARKER", encoding="utf8")
        server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        server.fixture = self.fixture
        server.tool_sets = []
        server.tool_results = []
        server.attempt = None
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.server = server
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_port}",
            "ANTHROPIC_API_KEY": "synthetic-no-real-credential",
            "CLAUDE_CONFIG_DIR": str(self.cwd / "config"),
            "DISABLE_TELEMETRY": "1",
            "DISABLE_ERROR_REPORTING": "1",
        }).start()

    def test_isolated_seat_only_has_output_channel(self):
        self.assertEqual(run_seat("Synthetic seat", "Synthetic project diff")["verdict"], "PASS")
        self.assertTrue(self.server.tool_sets)
        for tools in self.server.tool_sets:
            self.assertLessEqual(tools, {"StructuredOutput"})
        self.assertEqual(self.fixture.read_text(encoding="utf8"), "SYNTHETIC READ MARKER")

    def test_board_entrypoint_uses_the_isolated_runtime(self):
        def git(*args):
            return subprocess.run(["git", *args], cwd=self.cwd, check=True,
                                  capture_output=True, text=True, timeout=10).stdout.strip()

        git("init")
        git("config", "user.email", "fixture@example.invalid")
        git("config", "user.name", "Synthetic Reviewer")
        git("remote", "add", "origin", "https://github.com/Tristan578/project-forge.git")
        directory = self.cwd / ".claude/agents"
        directory.mkdir(parents=True)
        for role in ("security-reviewer", "test-reviewer", "ux-reviewer", "dx-guardian"):
            (directory / f"{role}.md").write_text("Synthetic role checklist.")
        git("add", ".claude", self.fixture.name)
        git("commit", "-m", "Synthetic base")
        base = git("rev-parse", "HEAD")
        self.fixture.write_text("SYNTHETIC CHANGED FILE", encoding="utf8")
        git("add", self.fixture.name)
        git("commit", "-m", "Synthetic committed change")
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("review_board.py")), "--base", base, "--fixture"],
            cwd=self.cwd, capture_output=True, text=True, encoding="utf8", timeout=75,
        )
        self.assertEqual(result.returncode, 0, result.stdout or result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["revision"], git("rev-parse", "HEAD"))
        self.assertEqual(report["overall"], "PASS")
        self.assertEqual(len(report["seats"]), 5)
        self.assertGreaterEqual(len(self.server.tool_sets), 5)
        self.assertTrue(all(tools <= {"StructuredOutput"} for tools in self.server.tool_sets))

    def test_pretool_hook_registration_and_failure(self):
        counter = self.cwd / "hook-count.txt"
        script = self.cwd / "count_hook.py"
        script.write_text("with open('hook-count.txt', 'a') as stream:\n    stream.write('hook\\n')\n")
        commands = {
            "deny": ("python -c \"import sys; sys.exit(2)\"", "Read"),
            "unregistered": ("python -c \"import sys; sys.exit(2)\"", "Write"),
            "missing": ("spawnforge-fixture-missing-handler", "Read"),
            "malformed": ("python -c \"print('{malformed')\"", "Read"),
            "timeout": ("python -c \"import time; time.sleep(5)\"", "Read"),
            "duplicate": ("python count_hook.py", "Read"),
        }
        for case, (command, matcher) in commands.items():
            with self.subTest(case=case):
                self.server.tool_results.clear()
                hook = {"type": "command", "command": command, "timeout": 1}
                registrations = [hook, hook] if case == "duplicate" else [hook]
                settings = {"hooks": {"PreToolUse": [{"matcher": matcher, "hooks": registrations}]}}
                result = subprocess.run(
                    [
                        "claude", "--restricted", "--strict-mcp-config", "--settings", json.dumps(settings),
                        "--tools", "Read", "--allowedTools", "Read", "--no-session-persistence",
                        "-p", "--model", "sonnet", "--output-format", "json", "Read the fixture.",
                    ],
                    cwd=self.cwd, capture_output=True, text=True, encoding="utf8",
                    timeout=45,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(self.server.tool_results, "no tool result observed by synthetic model")
                read = "SYNTHETIC READ MARKER" in json.dumps(self.server.tool_results)
                print(f"native PreToolUse {case}: {'continued' if read else 'blocked'}")
                self.assertEqual(read, case != "deny")
                if case == "duplicate":
                    count = len(counter.read_text().splitlines())
                    print(f"native duplicate handler ran {count} time(s)")
                    self.assertEqual(count, 1)

    def test_disabled_action_tools_do_not_execute(self):
        for tool, tool_input in (
            ("Write", {"file_path": str(self.fixture), "content": "UNEXPECTED"}),
            ("Bash", {"command": "python --version"}),
            ("mcp__fixture__create", {"title": "SYNTHETIC"}),
            ("WebFetch", {"url": "http://127.0.0.1/", "prompt": "Read fixture"}),
        ):
            with self.subTest(tool=tool):
                self.server.attempt = (tool, tool_input)
                self.server.tool_results.clear()
                subprocess.run(
                    isolated_command() + ["-p", "This is a synthetic tool-permission check."],
                    cwd=self.cwd, capture_output=True, timeout=30,
                )
                self.assertTrue(self.server.tool_results)
                self.assertTrue(all(result.get("is_error") for result in self.server.tool_results))
                self.assertEqual(self.fixture.read_text(encoding="utf8"), "SYNTHETIC READ MARKER")


if __name__ == "__main__":
    unittest.main()
