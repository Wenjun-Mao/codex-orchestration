# Codex App host operations

The CLI governs authorization and records evidence; Codex App performs native
task creation, waiting, messaging, archival, and managed-worktree operations.

## Native-first visible-task launch

1. Run `task launch prepare`. Use the emitted full contract and exact
   `task launch start` command as the initial prompt.
2. Run `task launch attempt` immediately before the external call.
3. Make one native creation call with the exact saved project, worktree
   starting state, title, model, reasoning effort, and initial prompt.
4. Pass the returned ready ID, provisional ID, or bounded opaque result to
   `task launch reconcile`. Unknown future shapes remain opaque evidence and
   never authorize another call.
5. The executor runs `task launch start` before source access. Its authenticated
   claim establishes identity, verifies the linked worktree, and attaches the
   reserved branch before useful work begins in that same turn.

Do not infer identity from title, project, recency, path, or timing. A known App
identity and the executor claim must agree. A stalled provisional task that
never starts may use the registered read-only mapping capsule only to recover
the exact ready ID needed for archival.

## Waiting and archival

Waits are liveness signals. Durable results come from the journal. Archive one
exact task only after terminal acceptance and verification. Public archive
indexing and host worktree reclamation are distinct observations; do not replay
an accepted archive call merely because the worktree remains attached.
