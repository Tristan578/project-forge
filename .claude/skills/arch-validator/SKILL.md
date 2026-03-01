---
name: arch-validator
description: Run this skill AFTER writing any Rust code to ensure you haven't violated the architectural boundaries.
---

# Architecture Validator

Run the python script located in this directory.

```
$ python3 .claude/skills/arch-validator/check_arch.py
```

If it fails, FIX the code immediately to remove the dependency.
