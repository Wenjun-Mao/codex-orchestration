---
name: setup
description: Promote an active Codex Flow v0.6 runtime to tracked adoption, or retire that v0.6 adoption, through a reviewed plan/apply. Use only when the user asks for persistent team/headless adoption or v0.6 retirement; ordinary v0.6 runs do not require setup.
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

Permanent adoption is optional and requires a named active v0.6 run. It writes
reviewed policy, instructions, and that run's same exact content-addressed
runtime under `.codex/orchestration/v0.6/`; it does not create a second engine
or migrate the active run. Use `adopt plan|apply|status` with the exact
`run_id`, and apply only the exact unchanged read-only plan after the user
reviews the tracked write set.

`adopt retire-plan|retire-apply` applies only to an existing tracked v0.6
adoption and still requires explicit retirement approval. If tracked v0.5
authority exists, stop: this development checkpoint has no v0.5 retirement
operation, and activation/adoption must remain blocked until a separate
transition contract is approved. Byte-preserve the v0.5 tag, package/cache
identity, Git-common state, and audit evidence. v0.6 never imports v0.5
operational records.

Read the relevant mode only:

- [New repository](references/new-repository.md) for an explicitly new Git
  repository.
- [Existing repository](references/existing-repository.md) for an established
  repository whose ongoing work must be preserved.

Adoption does not authorize additional task creation. Continue only through
the active run's disclosed workflow, or activate a later explicit run after the
current one closes.
