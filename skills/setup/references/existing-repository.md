# Existing Repository Adoption

Adopt Codex Flow without disrupting ongoing work.

## Preserve Existing Ownership

- Preserve project files, repository instructions, dirty work, active tasks,
  branches, linked worktrees, ignored files, and user-owned state.
- Do not stash, reset, rewrite, commit, or repair unrelated changes.
- Do not migrate or assume ownership of tasks launched before adoption.
- Codex Flow becomes authoritative only for tasks launched after the adoption
  branch is integrated.
- Legacy branches and worktrees require a separate audit and are never cleanup
  candidates merely because of their names.

Authenticate the clean authoritative default-branch revision. Create a clean
linked worktree and new `codex/codex-flow-v0.5-adoption` branch from that exact
revision, leaving any dirty checkout untouched. The branch must not already
exist locally or remotely. Stop if a clean authoritative baseline cannot be
established safely.

Inspect existing `AGENTS.md` files and process validators. Default to managed
AGENTS mode, which preserves all existing content and owns one bounded block.
External mode is allowed only when an explicitly reviewed equivalent Codex
Flow contract already exists and a human authorizes attestation of that exact
file state. Never infer equivalence merely because instructions exist.

## Plan And Activate

Create the adoption branch before planning, then run from its exact worktree:

```bash
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" init --plan --setup-mode existing --json
node "$CODEX_FLOW_PLUGIN_ROOT/bin/codex-flow.mjs" init \
  --apply-plan <plan_id> --setup-mode existing --json
```

Review the complete write set, AGENTS before/after result, conflicts, branch,
revision, and cleanliness. Apply only the exact unchanged plan when it is
applicable and conflict-free. Otherwise stop without writing.

For a human-authorized equivalent external contract, pass these same options
to both plan and apply:

```bash
--agents-mode external --external-agents-path AGENTS.md --attest-external-agents
```

After apply, run canonical `init --check`, the pinned `doctor`, existing process
validators, and proportionate repository checks. Confirm the diff contains
only planned Codex Flow files and instruction integration. Commit and integrate
through the repository's normal reviewed path; never integrate an adoption
that weakens an existing contract.

After integration, use the pinned coordinator workflow for newly launched
tasks. Pre-adoption tasks finish under their original contract and must not be
retroactively journaled, integrated, archived, or cleaned by Codex Flow.
