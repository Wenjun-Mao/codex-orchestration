---
name: integrate
description: Accept durable Codex Flow executor results, integrate or verify no-change, and finalize their lifecycle.
---

# Review and Integrate Results

Use the run-bound runtime. Native task status and final prose are not terminal
result authority.

1. Inspect `callback status` and authenticate the selected receipt against its
   launch, contract, selector evidence, Git outcome, and ownership.
2. Observe that callback and prepare its disposition. Do not consume it bare
   or invent a callback-less cancellation.
3. For a clean commit, use `integration prepare|verification-request|reconcile`
   and integrate serially. Preserve the explicit no-change path; dirty or
   blocked work remains fenced.
4. Run verification at the reconciled state. Finalize only with its
   content-addressed PASS evidence.
5. Use `assignment closeout` in the coordinator phase for eligible child
   archival and cleanup. An archived task may still have a host-managed
   worktree; that is not permission to repeat the archive call.

Use `codex-orchestration:cleanup` for unresolved closeout. Do not include secrets
or private host transcripts in returned evidence.
