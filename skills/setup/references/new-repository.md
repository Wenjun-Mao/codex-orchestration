# New Repository Bootstrap

Use this mode only when the user explicitly identifies the repository as new.

## Establish The Baseline

- Preserve all existing bytes and unrelated user work.
- Ensure the project is a Git repository with a named branch and committed
  baseline. If it is genuinely uninitialized, initialize Git and commit the
  existing contents without altering them.
- Create `codex/codex-flow-v0.5-bootstrap` before planning. The branch must not
  already exist locally or remotely; do not overwrite or silently reuse it.
- Use managed AGENTS mode. Preserve any existing `AGENTS.md` content outside
  the bounded Codex Flow block.

## Plan And Activate

Choose one stable `CODEX_FLOW_PROJECT_ID` for the repository before creating
the bootstrap branch. Keep that same exact identifier for plan and apply;
setup fails closed when it is omitted.

From the exact bootstrap worktree, run:

```bash
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" init --plan \
  --setup-mode new --project-id "$CODEX_FLOW_PROJECT_ID" --json
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" init \
  --apply-plan <plan_id> --setup-mode new \
  --project-id "$CODEX_FLOW_PROJECT_ID" --json
```

Review the complete write set, AGENTS before/after result, conflicts, branch,
revision, and cleanliness before applying. Apply only the unchanged plan ID
when `applicable` is true and conflicts are empty. Otherwise stop without
writing and report the smallest compatibility decision.

Then run:

```bash
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" init --check
node .codex/orchestration/bin/codex-flow.mjs doctor
```

Run any existing process validators and proportionate repository checks.
Confirm the diff contains only the planned Codex Flow installation and
explicitly authorized baseline files. Commit and integrate through the
repository's normal reviewed path.

After integration, start coordinator work with the pinned runtime:

```bash
node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator
```

Delegated tasks default to `gpt-5.6-terra` with `xhigh` reasoning, passed as
actual host-tool arguments. Do not modify product files or launch delegated
tasks before the integrated installation and doctor checks are green.
