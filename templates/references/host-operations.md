# Codex App host operations

## Visible-task creation

1. Run `task launch prepare`; keep its emitted full contract and start command
   as the initial prompt.
2. Record `task launch attempt`, then make one native creation call with its
   exact project, starting state, title, model, effort, and prompt.
3. Reconcile the returned ready ID, provisional ID, or bounded opaque result.
   An unknown shape never authorizes a retry.
4. The executor runs `task launch start` before source access. Its exact claim
   may establish ready identity independently; known host IDs must agree.

Title, project, recency, and path do not establish identity. A stalled
provisional task may use the registered read-only mapping capsule for archival
recovery, not activation or a replacement creation call.

## Archival

Use command-managed closeout for exact eligible members. Task visibility and
host worktree reclamation are separate facts. An accepted archive call must
not repeat merely because its worktree remains. Use authenticated private
archive observation only when public indexing is insufficient. For an accepted
iteration member, closeout may use that fresh archived/no-active proof to
revalidate its persisted clean, unshared, integrated Git identity and remove
the exact worktree without force. A refusal or drift remains pending; it never
widens deletion authority.
