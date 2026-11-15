# Copilot CLI folder trust for this repository

GitHub Copilot CLI asks whether you trust a folder before it works in it. This guide
covers what to trust for SpawnForge, where Copilot keeps that decision, and why none of
it belongs in the repository (#8695).

Everything below was checked against Copilot CLI **1.0.88**: its `--help`,
`copilot help config`, `copilot help permissions` and `copilot help sandbox`, and the
1.0.88 package itself. Recheck it after an upgrade, because Copilot moved its user
settings into a separate file in this release line (see
[Where the decision is stored](#where-the-decision-is-stored)).

## What to trust

Trust the **root of your SpawnForge checkout** and nothing above it: not `~`, not a
`~/src` that holds other projects. Trust gives Copilot "permission to read or execute
files" in that folder (from the `trustedFolders` entry in `copilot help config`). Keep
it as narrow as the one repository you are working in.

Copilot does not act on trust alone. Tool, path and URL approvals are separate.
`copilot help permissions` covers them: `--allow-tool` / `--deny-tool`, `--add-dir`,
`--allow-url`. Denial rules win over allow rules. Trusting this folder is not a reason
to launch with `--allow-all` or `--yolo`.

Trust is also **not a sandbox**. `copilot help sandbox` says command sandboxing is
experimental and off by default. With it off, shell commands the agent runs "run
directly on your machine with the same access your user account has".

## Recommended: answer the prompt

The first time you start `copilot` at the checkout root, it asks:

> Do you trust the files in this folder?

The choices are **Yes**, **Yes, and remember this folder for future sessions**, and
**No**. Choose **Yes, and remember this folder for future sessions**. Copilot then
records the folder itself, with no hand-editing and no chance of a typo in the path.
Choose plain **Yes** if you want the trust to last for this session only.

Git worktrees: in 1.0.88, a worktree that **Copilot itself** creates from a trusted
repository root inherits that trust. A worktree you create some other way (for example
`git worktree add`) is a different folder, and whether it inherits trust was not
checked. If Copilot prompts in the worktree, trust the worktree's root the same way.

## Where the decision is stored

Remembered folders are kept in the `trustedFolders` list. `copilot help config`
documents it as a "list of folders where permission to read or execute files has been
granted". In 1.0.88 the CLI reads that list from its persisted state file, `config.json`,
in the Copilot home directory. That directory is `$COPILOT_HOME` if set, otherwise
`~/.copilot` (`copilot help environment`).

If you must write the entry by hand (for example, when provisioning a new machine),
quit Copilot first. Then add the absolute path of your checkout to the existing list,
and keep every other key in the file:

```json
{
  "trustedFolders": [
    "<absolute path of your checkout>"
  ]
}
```

Replace the placeholder with the path as your machine spells it (what `pwd` prints
at the root of the checkout). On Windows, double every backslash inside JSON. The CLI owns this
file and writes other state to it. As of 1.0.88 it also moves user **settings** out of
`config.json` into a separate `settings.json`, so the prompt above is the safer route
across upgrades.

## Never commit it

`~/.copilot/config.json` is a **local, per-developer file in your home directory**. It
is not part of this repository, and nothing from it should be copied in:

- It holds absolute paths for one person's machine, which are wrong on every other
  machine.
- It holds the rest of the CLI's state for that user (for example, the plugins they
  have installed).
- A repository must never be able to declare itself trusted. Do not try to express
  folder trust in a committed file such as `.github/copilot/settings.json`, the repo
  scope that `/settings --repo` writes. Whether Copilot would honor `trustedFolders`
  there was not checked, and it should not matter, because the entry does not belong
  there.

This file is not the same as `.claude/settings.json` or `.codex/config.toml`. Those two
are committed and are off-limits to agents in this repository. This one lives outside
the repository tree, so that restriction does not apply to it. It still must not be
committed.

## Other CLIs

Codex has its own trust setting. See step 2 of the one-time setup in `.codex/AGENTS.md`
(`trust_level = "trusted"` in `~/.codex/config.toml`). Like this file, it lives in your
home directory and is never committed.
