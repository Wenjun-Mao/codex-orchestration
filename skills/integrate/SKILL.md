---
name: integrate
description: Review and disposition durable Codex Flow results, reconcile integration or no-change, run combined verification, and archive terminal visible tasks.
---

# Disposition and Integrate Results

Use the exact run-bound runtime. Native waits, task finals, messages, branch
names, and caller-supplied digests are not result authority.

1. Inspect `callback status`. Authenticate terminal receipt v4 against its
   launch_id, generated contract, executor start claim, selector evidence, Git
   outcome, ownership, and coordinator binding.
2. Observe the selected callback and use `disposition prepare`. There is no
   callback-less cancellation path and no public bare consume shortcut.
3. For `clean-commit`, use `integration prepare|verification-request|reconcile`.
   Integrate serially. For `unchanged`, retain the explicit no-change path.
   Dirty or blocked work stays fenced and visible.
4. Run `verification run` at the exact reconciled state. Only a
   content-addressed PASS verification record can authorize finalization.
5. Use `disposition finalize`; it reloads the launch, callback, integration or
   no-change evidence, consumes the callback exactly once, and records the
   final decision.
6. Use `archive prepare|reconcile|observe-private|status` only after acceptance
   and PASS verification. The worktree path derives from the authenticated
   launch. Public archive visibility and host worktree reclamation are separate
   observations; never replay archive merely because the worktree remains.

## Finalization

After archive completion, use `codex-orchestration:cleanup` and a fresh run
audit. Results must exclude secrets, raw transcripts, and private host data.
