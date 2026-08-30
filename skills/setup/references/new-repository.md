# New Repository Adoption

Use this mode only when the user explicitly wants permanent tracked Codex Flow
policy in a repository they identify as new.

Preserve all existing bytes and establish a named, committed Git baseline
without rewriting history. Use the repository's normal reviewed branch/worktree
workflow; do not invent or overwrite a branch.

First activate a named v0.7 run through an authorized actionable workflow;
adoption promotes that run's runtime and cannot bootstrap one. Then run `adopt
plan --run-id ...` from the exact intended worktree. Review the proposed
`.codex/orchestration/v0.7/` write set, content-addressed runtime bundle,
configuration snapshot, and structured policy. It must not propose
`INSTRUCTIONS.md`, `AGENTS.md`, or another instruction authority. The plan is
read-only and must bind the repository and current state.

Run `adopt apply --run-id ...` only for that exact unchanged plan after
explicit review. Then use `adopt status --run-id ...` and the repository's
existing validators. Confirm no product path changed and integrate the
adoption through the repository's normal review process.

Adoption does not authorize additional task creation. Continue only through
the named run's already disclosed workflow, or activate a later explicit run
after it closes.
