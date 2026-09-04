---
name: unplug
description: Plan and, with explicit approval, apply a repository-scoped clean start that archives known Codex Flow tasks and removes exact local Flow state.
---

# Unplug a Repository Cleanly

Run `unplug plan` first. It is version-agnostic discovery, not migration: it
classifies bounded namespace directories and opaque root files by exact path,
type, size, and digest; authenticates local Git resources; and identifies every
task that must be archived. Host-managed turn-diff refs are observations, not
source identity, while source/local/remote/tag refs relevant to planned
resources remain binding.

Archive every named task through the App. If public archive indexing lags, use
`unplug observe-private` for a digest-bound observation of the exact archived
session and absent active counterpart.

Apply only an approved exact plan with `unplug apply`. Revalidate all task,
Git, path, byte, and attachment evidence immediately before mutation. Remove
eligible worktrees before local branches. Never remove remote refs, protected
branches, unmerged work, another repository, or the coordinator checkout.
Delete exact planned state paths last and require zero residue.

Unplug does not reinterpret predecessor records or silently clean a running
workflow. Optional plugin uninstallation is a separate explicit request.
