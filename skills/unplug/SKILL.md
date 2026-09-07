---
name: unplug
description: Plan and explicitly authorize a repository-scoped Codex Flow clean start.
---

# Unplug a Repository

Run `unplug plan` before mutation. Approve its exact targets and digest, not a
blanket deletion of Flow state. Discovery is not predecessor migration.

Archive the named tasks. If public archive indexing lags, use
`unplug observe-private` for exact archived/no-active evidence.

`unplug apply` revalidates task, Git, path, byte, and attachment evidence.
Remove only eligible worktrees, then local branches, then planned state.
Preserve remote refs, protected branches, unmerged work, unrelated repositories,
and the caller checkout. Require zero residue before declaring completion.

Do not silently clean a running workflow. Plugin uninstallation is a separate
explicit request.
