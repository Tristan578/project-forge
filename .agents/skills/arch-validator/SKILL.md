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

If it fails, FIX the code immediately to remove the dependency.
