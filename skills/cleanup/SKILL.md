---
name: cleanup
description: Audit retained Codex Flow run state and derive an exact read-only cleanup plan for eligible task branches and worktrees. Use after disposition and archival, or for stale-state and disk-hygiene review.
---

# Audit and Plan Orchestration Cleanup

Name the exact `run_id`. Inspect active/abandoned runs, runtime bindings,
callbacks, urgent signals, dispositions, integrations, verification, archive
operations, the path/resource/branch reservation envelope, worktrees, and
exact refs.

Archive is a reconciled host lifecycle, not Git deletion. Do not archive a
blocked or dirty task merely because its turn ended, and do not infer archive
success from a setter response when the host cannot expose the resulting state.

Use `cleanup plan --run-id ...` to derive the deterministic exact-state plan.
It reloads the completed disposition/archive chain, terminal Git receipt,
current local ref, expected and configured upstream, original worktree path,
and every current attachment. Missing or unsafe lifecycle evidence, exact-tip
drift, upstream mismatch, or an attached worktree fails closed. `run audit`
separately reloads the authoritative PASS verification before closure. v0.7
exposes no cleanup apply command: do not delete branches, worktrees, or refs
through this workflow.

Closing a run requires a current passing `run audit`, which re-derives every
source record and proves that no live executor ref, attached worktree, retained
visible task, or unresolved reservation remains. A prior audit cannot authorize
close after state drift. Explicit abandonment keeps the complete admitted
path/resource/branch envelope durable; a later run may proceed only when its
plan is disjoint. v0.7 does not prune runtime snapshots or inspect, import,
migrate, retire, or remove predecessor operational records.
