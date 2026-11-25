---
name: arch-validator
description: Validate Rust engine architecture boundaries — ensure core/ has no browser deps, bridge/ is properly isolated. Run after any engine/ changes or when "architecture violation", "import boundary", or "bridge isolation" is mentioned.
paths: "engine/src/**"
---

# Architecture Validator

Run the python script located in this directory.

```
$ python3 .claude/skills/arch-validator/check_arch.py
```

Run it from the repository root. Every rule reads paths relative to the
current directory; from anywhere else (for example `engine/`) the script exits
2 with a message on stderr instead of walking an empty relative path and
printing a pass. `--strict` exits 1 on any violation; the default run exits 1
only for a bridge-isolation violation and reports the rest as warnings.

If it fails, FIX the code immediately to remove the dependency.
