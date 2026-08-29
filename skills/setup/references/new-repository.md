# New Repository Adoption

Use this mode only when the user explicitly wants permanent tracked Codex Flow
policy in a repository they identify as new.

Preserve all existing bytes and establish a named, committed Git baseline
without rewriting history. Use the repository's normal reviewed branch/worktree
workflow; do not invent or overwrite a branch.

Run `adopt plan` from the exact intended worktree. Review the proposed
`.codex/orchestration/v0.6/` write set, content-addressed runtime bundle,
configuration/policy snapshots, and reviewed instructions. The plan is
read-only and must bind the repository and current state.

Run `adopt apply` only for that exact unchanged plan after explicit review.
Then use `adopt status` and the repository's existing validators. Confirm no
product path changed and integrate the adoption through the repository's normal
review process.

Adoption does not activate a coordinator run or authorize task creation. A
later orchestration request uses the same v0.6 runtime semantics through an
explicit run.
