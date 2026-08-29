---
name: cleanup
description: Audit retained Codex Flow run state and safely reconcile eligible task branches, worktrees, leases, and fences from authoritative lifecycle records. Use after disposition and archival, or for stale-state and disk-hygiene review.
---

# Audit and Reconcile Orchestration State

Start read-only and name the exact `run_id`. Inspect active/abandoned runs,
runtime bindings, callbacks, urgent signals, dispositions, integrations,
verification, archive operations, path/resource/branch/operation fences,
leases, worktrees, and exact refs.

Archive is a reconciled host lifecycle, not Git deletion. Do not archive a
blocked or dirty task merely because its turn ended, and do not infer archive
success from a setter response when the host cannot expose the resulting state.

Git cleanup requires the accepted result-to-disposition-to-integration/no-change
to-PASS-verification proof chain and exact current tips. Review a deterministic
cleanup plan before applying it. Drift, active leases, ambiguous operations,
dirty files, protected refs, or uniquely unmerged commits fail closed. A
partial apply invalidates its plan; audit the remaining state and make a fresh
one. Never delete by branch-name pattern or remove repository/product/user
files through this workflow.

Closing a run requires a current passing `run audit`, which re-derives every
source record and proves that no unresolved fence remains. A prior audit cannot
authorize close after state drift. Explicit abandonment keeps every unresolved
fence and lease durable; a later run may proceed only when its plan is disjoint.
v0.6 does not prune runtime snapshots or import/remove retained v0.5 evidence.
