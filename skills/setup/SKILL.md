---
name: setup
description: Set up or adopt the installed Codex Flow plugin in a repository when the user explicitly asks to bootstrap, install, set up, or adopt Codex Flow. Do not invoke for ordinary orchestration in an already configured repository or for unrelated project setup.
---

# Set Up Codex Flow

Treat the installed plugin containing this skill as the accepted package
authority. Let `CODEX_FLOW_SETUP_SKILL_DIR` be the absolute directory that
contains this loaded `SKILL.md`, then run exactly:

```bash
CODEX_FLOW_PLUGIN_ROOT="$(node \
  "$CODEX_FLOW_SETUP_SKILL_DIR/scripts/resolve-plugin-root.mjs")"
```

Do not shorten that path to `<plugin-root>/scripts/resolve-plugin-root.mjs`;
the resolver is packaged under `skills/setup/scripts/`. Use its single stdout
line as `CODEX_FLOW_PLUGIN_ROOT`; the resolver fails unless package, plugin,
and runtime versions agree. Run the bundled CLI with:

```bash
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" ...
```

Do not ask the user for a package checkout path, Git commit, npm installation,
or copy-paste prompt. The canonical CLI validates the installed plugin metadata
before planning and pins the target runtime by package version and exact file
hashes.

Automatic discovery is not mutation authority by itself. Modify a repository
only when the user's request unmistakably asks to set up, bootstrap, install,
or adopt Codex Flow. A question about Codex Flow receives an explanation only.

Inspect before choosing a mode:

1. If `.codex/orchestration/version.json` exists at package version `0.5.1`,
   run canonical `init --check` and the pinned `doctor`; do not reinstall.
2. If an installed runtime names any other package version, stop. Codex Flow is
   pre-stable and requires explicit retirement and fresh installation rather
   than an in-place compatibility path.
3. For an explicitly new repository, read
   [New repository](references/new-repository.md).
4. For an existing Git repository without Codex Flow, read
   [Existing repository](references/existing-repository.md).
5. A populated non-Git directory whose new-versus-existing status is ambiguous
   receives read-only inspection only. Do not invent history or commit files.

Planning is always read-only and branch-bound. Apply only the exact unchanged,
conflict-free plan. Do not launch delegated tasks until the setup commit is
integrated on the authoritative branch and pinned `doctor` is green.
