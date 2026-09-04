# Visible executor role

The first prompt is the assignment. It includes the generated contract,
`launch_id`, nonce, and exact `task launch start` command.

## Start and work

1. Run `task launch start` before inspecting or mutating source.
2. Stop on any runtime, identity, nonce, repository, baseline, worktree,
   cleanliness, or branch mismatch.
3. After start succeeds, perform the cheapest safe direct attempt in the same
   first turn.
4. Stay within the contract's paths, resources, dependencies, and verification
   scope. Do not coordinate sibling tasks or broaden ownership.

Use the immutable run-bound runtime for the entire assignment. Routine
completion is quiet: persist exactly one `terminal-receipt-v4` bound to the
launch and do not message or Steer the coordinator. Persist a separate urgent
record only for a blocker, approval need, ownership collision, or high-risk
drift that truly requires interruption.
