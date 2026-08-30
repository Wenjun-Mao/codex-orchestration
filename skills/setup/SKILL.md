---
name: setup
description: Promote an active Codex Flow v0.6 runtime to tracked adoption, retire that adoption, or retire accepted tracked v0.5.1 authority through an exact reviewed plan/apply. Use only for explicitly requested persistent adoption or retirement; ordinary v0.6 runs do not require setup.
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
adoption. Accepted tracked v0.5.1 uses the distinct run-independent
`adopt legacy-retire-plan|legacy-retire-apply` contract. Generate the exact
read-only plan first and present its owned tracked changes, settlement blockers,
retained Git/task state, and Git-common evidence digest. Never apply it merely
because retirement was discussed or planned; apply only the unchanged plan
after explicit review and approval. It makes no commit and does not activate or
adopt v0.6. Byte-preserve the v0.5.1 tag, package/cache identity, Git-common
state, tasks, branches, worktrees, and audit evidence. Other predecessor
versions remain unsupported and blocked.

Read the relevant mode only:

- [New repository](references/new-repository.md) for an explicitly new Git
  repository.
- [Existing repository](references/existing-repository.md) for an established
  repository whose ongoing work must be preserved.

Adoption does not authorize additional task creation. Continue only through
the active run's disclosed workflow, or activate a later explicit run after the
current one closes.
