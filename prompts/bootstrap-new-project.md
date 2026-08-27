# Bootstrap Codex Flow In A New Repository

Before pasting this prompt, replace every `{{...}}` placeholder with the exact
accepted package authority for the intended Codex Flow checkpoint.

---

Before doing project work, bootstrap this repository with Codex Flow.

Canonical package authority:

- Path: `{{CODEX_FLOW_PACKAGE_PATH}}`
- Commit: `{{CODEX_FLOW_PACKAGE_COMMIT}}`
- Version: `{{CODEX_FLOW_VERSION}}`

First authenticate that package checkout as clean and exactly at the named
commit and version. Do not use a different revision.

Ensure this project is a Git repository with a named branch and committed
baseline. If it is genuinely uninitialized, initialize Git and commit the
existing project contents without changing them.

Use managed AGENTS mode because this is a new repository. Preserve any existing
`AGENTS.md` content. Create or switch to a dedicated Codex Flow bootstrap branch
before planning; the plan ID is branch- and revision-bound.

Before product changes:

1. Run the canonical `init --plan --json` command. Planning must be read-only.
2. Review the complete write set, `AGENTS.md` before/after result, and conflicts.
3. If the plan is applicable and conflict-free, apply that exact unchanged plan
   ID. If not, stop and report the conflict without writing.
4. Run canonical `init --check` and the pinned `.codex/orchestration` doctor.
5. Run the repository's existing process validators and proportionate tests.
6. Confirm the final diff contains only the planned Codex Flow installation and
   any explicitly authorized repository bootstrap files.
7. Commit and integrate through the repository's normal reviewed path.

After adoption is integrated, run:

```bash
node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator
```

Treat this task as the coordinator and follow the pinned workflow before
creating delegated work. Delegated tasks default to `gpt-5.6-terra` with
`xhigh` reasoning; pass those as actual host-tool arguments, not only prompt
text. Validate the DAG, ownership paths, dependencies, exclusive resources,
and serial gates before fan-out. Use the repository callback journal for
ordinary completion, identified direct delivery only for urgent conditions,
and coordinator-owned integration, reproof, archiving, and cleanup.

Do not modify product files or launch delegated tasks until installation and
doctor checks are green on the authoritative integrated branch.
