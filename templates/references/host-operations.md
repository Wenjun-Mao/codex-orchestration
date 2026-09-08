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

Use command-managed closeout for exact eligible members. Give the command the
requested active-task observation. When it returns `host-action-required`, call
the Codex App archive tool once with the exact `host_request`, then return only
the matching `attempt_id`, `thread_id`, outcome (`accepted`,
`rejected-before-send`, or `ambiguous`), and an optional bounded safe reason or
error code as `host_result`. A replayed prepared action has
`call_required: false`: reconcile or observe it; do not call again.

Task visibility, run archive completion, and host worktree reclamation are
separate facts. Use the returned archive identity and authenticated private
archive observation when public indexing is insufficient. Closeout binds that
observation to the persisted attempt, revalidates the exact clean, unshared,
integrated Git identity, removes the worktree without force, and completes the
run archive. A refusal or drift remains pending; it never widens deletion
authority. Patch-equivalent cleanup requires the exact accepted integration
evidence, not a new similarity calculation.
