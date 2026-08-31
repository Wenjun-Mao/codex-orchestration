---
name: integrate
description: Review and disposition durable Codex Flow results, reconcile integration or no-change, run authoritative combined verification, and archive terminal visible tasks. Use after one or more executors return.
---

# Disposition and Integrate Results

Use the exact run-bound v0.7 runtime. Task finals, native waits, direct messages,
branch names, and caller-supplied digests are not result authority.

1. Inspect `callback status` without mutation. Authenticate the terminal
   receipt's release, generated contract, model evidence, exact Git outcome,
   ownership, and current coordinator binding.
2. Observe only the exact durable result selected for a decision. Prepare its
   coordinator-owned disposition with `disposition prepare`; do not expose a
   public bare callback-consume shortcut.
   If delivery was durably `rejected-before-send` before release acceptance or
   callback creation, use `disposition cancel` for the callback-less terminal
   path.
3. For `clean-commit`, use `integration prepare|verification-request|reconcile|status`
   and integrate serially. For `unchanged`, persist the explicit no-change
   path. `dirty-blocked` remains visible and fenced.
4. Run `verification run` against the exact reconciled repository state. A
   content-addressed PASS verification record—not a raw digest supplied by the
   caller—must bind the callback and, when applicable, the integration record.
5. Use `disposition finalize` only after the runtime reloads and matches those
   authoritative records. Finalization performs any internal result
   consumption exactly once.
6. Use `archive prepare|reconcile|status` only after the accepted disposition,
   integration or no-change proof, PASS combined verification, internal
   callback consumption, and exact executor Git resolution are durable. The
   archive worktree path is derived from persisted creation evidence, never
   supplied by the caller. Native archive acceptance is asynchronous: archived
   visibility may produce `archived-awaiting-worktree-reclamation` while the
   exact host-managed path remains. Do not replay the host archive call or
   delete the path. Reconcile the same attempt and archived observation later;
   cleanup and closure remain blocked until exact absence completes it.

Rejected or blocked work receives an explicit durable disposition and remains
visible whenever user attention or dirty state is unresolved. Archive and Git
cleanup are separate actions. After archival, use `codex-orchestration:cleanup`
to derive the exact read-only branch/worktree plan. v0.7 does not apply Git
deletion.

Read [Communication loop](../../templates/references/communication-loop.md)
for quiet versus urgent delivery and [Task lifecycle](../../templates/references/task-lifecycle.md)
for the full proof chain.
