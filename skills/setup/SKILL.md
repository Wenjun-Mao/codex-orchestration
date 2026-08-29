---
name: setup
description: Permanently adopt or explicitly retire the installed Codex Flow runtime in a repository through a reviewed tracked plan/apply. Use only when the user asks for persistent team/headless setup, adoption, installation, or retirement; ordinary v0.6 runs do not require setup.
---

# Permanently Adopt Codex Flow

Treat the installed plugin containing this skill as package authority. Let
`CODEX_FLOW_SETUP_SKILL_DIR` be the absolute directory containing this
`SKILL.md`, then resolve the bundled root exactly:

```bash
CODEX_FLOW_PLUGIN_ROOT="$(node \
  "$CODEX_FLOW_SETUP_SKILL_DIR/scripts/resolve-plugin-root.mjs")"
```

Use `node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" ...` and inspect its
current `--help` for flags. Do not ask for a checkout path, npm install, or
copied runtime. Automatic skill discovery is not mutation authority.

Permanent adoption is optional. It writes reviewed policy, instructions, and
the same exact content-addressed runtime used by run-scoped activation under
`.codex/orchestration/v0.6/`; it does not create a second engine or migrate an
active run. Use `adopt plan|apply|status` and apply only the exact unchanged
read-only plan after the user reviews the tracked write set.

If tracked v0.5 authority exists, stop. Use the separate
`adopt retire-plan|retire-apply` flow only with explicit retirement approval,
and byte-preserve the v0.5 tag, package/cache identity, Git-common state, and
audit evidence. v0.6 never imports v0.5 operational records.

Read the relevant mode only:

- [New repository](references/new-repository.md) for an explicitly new Git
  repository.
- [Existing repository](references/existing-repository.md) for an established
  repository whose ongoing work must be preserved.

Do not launch tasks merely because adoption completed. A later actionable
orchestration request still activates an explicit run and discloses its plan,
model routing, and external task creation.
