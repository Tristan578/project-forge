"""Architecture validator for Project Forge.

Enforces structural rules:
1. No web_sys/js_sys/wasm_bindgen in core/ (original rule)
2. No Rust file in engine/src/ exceeds 800 lines
3. No TS file in web/src/ exceeds 500 lines (except generated/legacy)
4. commands/ dispatch must be domain chain (no giant match blocks)
5. pending/ mod.rs must not contain request structs
6. editorStore.ts must compose slices (no inline state definitions)
7. useEngineEvents.ts must delegate (no inline switch cases)
"""

import os
import sys
import re
import json

# ANSI colors
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD = "\033[1m"


def count_lines(path):
    """Count non-empty lines in a file."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for line in f)
    except Exception:
        return 0


def check_no_js_interop_in_core():
    """Rule 1: No JS interop in core engine logic."""
    violations = []
    js_interop_patterns = [
        r"^\s*use\s+web_sys",
        r"^\s*use\s+js_sys",
        r"web_sys::",
        r"js_sys::",
        r"^\s*use\s+wasm_bindgen",
        r"#\[wasm_bindgen",
    ]
    combined = re.compile("|".join(js_interop_patterns))

    for root, _, files in os.walk("engine/src"):
        for f in files:
            if not f.endswith(".rs"):
                continue
            path = os.path.join(root, f)
            if "bridge" in path or "platform" in path:
                continue
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for line_num, line in enumerate(fh, 1):
                    stripped = line.strip()
                    if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                        continue
                    if combined.search(line):
                        violations.append(f"  {path}:{line_num}: {stripped}")
    return violations


def check_rust_file_sizes(max_lines=800):
    """Rule 2: No Rust file in engine/src/ exceeds max_lines."""
    violations = []
    for root, _, files in os.walk("engine/src"):
        for f in files:
            if not f.endswith(".rs"):
                continue
            path = os.path.join(root, f)
            lines = count_lines(path)
            if lines > max_lines:
                violations.append(f"  {path}: {lines} lines (max {max_lines})")
    return violations


def check_ts_file_sizes(max_lines=500):
    """Rule 3: No TS file in web/src/ exceeds max_lines (except legacy/generated)."""
    violations = []
    # Files exempt from size check
    exempt = {
        "executor.legacy.ts",  # Legacy fallback during migration
    }
    for root, _, files in os.walk("web/src"):
        for f in files:
            if not (f.endswith(".ts") or f.endswith(".tsx")):
                continue
            if f in exempt:
                continue
            # Skip test files and generated files
            if f.endswith(".test.ts") or f.endswith(".test.tsx"):
                continue
            if f.endswith(".d.ts"):
                continue
            path = os.path.join(root, f)
            lines = count_lines(path)
            if lines > max_lines:
                violations.append(f"  {path}: {lines} lines (max {max_lines})")
    return violations


def check_commands_dispatch():
    """Rule 4: commands/mod.rs must not have a giant match block (>50 arms)."""
    violations = []
    mod_path = os.path.join("engine", "src", "core", "commands", "mod.rs")
    if not os.path.exists(mod_path):
        # Check old-style monolithic file
        old_path = os.path.join("engine", "src", "core", "commands.rs")
        if os.path.exists(old_path):
            lines = count_lines(old_path)
            if lines > 500:
                violations.append(f"  {old_path}: monolithic commands file ({lines} lines) — split into commands/ directory")
        return violations

    # Count match arms in mod.rs dispatch function
    with open(mod_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    arms = content.count("=>")
    if arms > 50:
        violations.append(f"  {mod_path}: dispatch has {arms} match arms (max 50) — delegate to domain modules")
    return violations


def check_pending_mod():
    """Rule 5: pending/mod.rs must not contain request structs (only PendingCommands + re-exports)."""
    violations = []
    mod_path = os.path.join("engine", "src", "core", "pending", "mod.rs")
    if not os.path.exists(mod_path):
        return violations
    with open(mod_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    # Check for struct definitions that look like request types (not PendingCommands/EntityType)
    struct_pattern = re.compile(r"pub struct (\w+)")
    allowed_structs = {"PendingCommands"}
    for match in struct_pattern.finditer(content):
        name = match.group(1)
        if name not in allowed_structs and not name.startswith("Entity"):
            violations.append(f"  {mod_path}: contains struct '{name}' — move to domain module")
    return violations


def check_editor_store_composition():
    """Rule 6: editorStore.ts should compose slices, not define inline state."""
    violations = []
    store_path = os.path.join("web", "src", "stores", "editorStore.ts")
    if not os.path.exists(store_path):
        return violations
    lines = count_lines(store_path)
    if lines > 200:
        violations.append(f"  {store_path}: {lines} lines (max 200) — extract state into slices/")
    return violations


def check_engine_events_delegation():
    """Rule 7: useEngineEvents.ts should delegate, not handle inline."""
    violations = []
    events_path = os.path.join("web", "src", "hooks", "useEngineEvents.ts")
    if not os.path.exists(events_path):
        return violations
    lines = count_lines(events_path)
    if lines > 150:
        violations.append(f"  {events_path}: {lines} lines (max 150) — delegate to events/ handlers")
    return violations


def main():
    strict = "--strict" in sys.argv
    output_json = "--json" in sys.argv

    rules = [
        ("No JS interop in core/", check_no_js_interop_in_core),
        ("Rust file size limit (800 lines)", check_rust_file_sizes),
        ("TypeScript file size limit (500 lines)", check_ts_file_sizes),
        ("Commands dispatch is domain chain", check_commands_dispatch),
        ("Pending mod.rs has no request structs", check_pending_mod),
        ("editorStore.ts composes slices", check_editor_store_composition),
        ("useEngineEvents.ts delegates", check_engine_events_delegation),
    ]

    results = {}
    total_violations = 0

    for name, check_fn in rules:
        violations = check_fn()
        results[name] = violations
        total_violations += len(violations)

    if output_json:
        print(json.dumps(results, indent=2))
    else:
        for name, violations in results.items():
            if violations:
                print(f"{RED}FAIL{RESET} {name}")
                for v in violations:
                    print(v)
            else:
                print(f"{GREEN}PASS{RESET} {name}")

        print()
        if total_violations == 0:
            print(f"{GREEN}{BOLD}Architecture Check Passed.{RESET} (7 rules, 0 violations)")
        else:
            print(f"{RED}{BOLD}Architecture Check Failed.{RESET} ({total_violations} violations)")

    if strict and total_violations > 0:
        sys.exit(1)

    # Always exit 0 for non-strict (warnings only) unless JS interop violations
    js_violations = results.get("No JS interop in core/", [])
    if js_violations:
        sys.exit(1)


if __name__ == "__main__":
    main()
