# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

Every PR that changes user-facing behavior should include a changeset file.
Run `npx changeset` to create one interactively, or create a `.changeset/<name>.md` file manually:

```markdown
---
"web": patch
---

Fixed the widget alignment in the inspector panel.
```

## Skip changesets

Add the `skip changeset` label to PRs that don't need a changeset (docs-only, CI config, etc.).
