---
name: cleanup
description: Inspect or resume exact Codex Flow iteration closeout when ordinary finalization leaves pending resources.
---

# Resolve Pending Closeout

Inspect `assignment status --assignment-id ID`. Resume the coordinator phase
with `assignment closeout --assignment-id ID --file request.json`; the director
resumes accepted closeout with `assignment accept` for the same reviewed report.
See the [request fields](../../templates/references/assignment-and-reporting.md).
Do not reconstruct member lists or manually edit the registry.

Distinguish accepted work, archived task visibility, worktree reclamation,
and local-branch cleanup. Reconcile independently confirmed prior archival;
never repeat a host action solely because its worktree remains.

An accepted iteration member with fresh authenticated archived/no-active
evidence may be reclaimed by the command. It revalidates the persisted exact
path, attachment, clean commit, ownership, sharing, and primary preservation,
then uses non-force Git removal. Do not run `git worktree remove` separately.

Preserve retained/shared tasks, the director and caller checkout, unrelated
resources, unmerged work, and unresolved identities. Membership is not discard
authority. An ambiguous host result must not be blindly retried.

Return completed, pending, or blocked with the exact remaining action. A
refused or ineligible reclamation is not completion and does not warrant a
polling loop.
