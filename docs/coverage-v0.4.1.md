# Codex Flow v0.4.1 coverage

v0.4.1 retains the held-out-proven v0.4 host-worktree, callback, integration,
and Git cleanup lifecycle. This checkpoint adds urgent direct-delivery identity
without changing ordinary terminal completion.

## Covered

- Strict urgent signals for blocker, approval, and high-risk-drift only.
- Deterministic logical urgent IDs independent of mutable prose and host-added
  envelope fields.
- Immutable numbered delivery attempts bound to the current recipient target.
- One host-call authorization per attempt, explicit reconciled retries, and no
  host call while a journal lock is held.
- First-observation processing with durable suppression and classification of
  same-attempt host replay versus distinct sender attempt.
- Exactly-once logical consumption, correction sequence, supersession of an
  unobserved predecessor, expiry, and recipient-generation fencing.
- Strict allowlists, bounded fields and records, and rejection of secret-like
  material, application/account identifiers, raw logs/transcripts, and user
  identity data.
- Doctor and cleanup-audit visibility for pending signals and suppressed
  duplicate evidence.
- Dependency-free operation in the existing v0.4 repository state namespace.
- One held-out visible Terra/xhigh host-worktree executor through urgent
  persist, attempt preparation, one direct host call, observe, consume,
  ordinary callback integration, doctor, and exact Git cleanup.

## Not claimed

- No prevention of the host injecting a duplicate user turn; the journal makes
  the duplicate nonauthoritative and suppresses repeated action.
- No inference of host replay from sender retries or arrival order.
- No automatic resend, direct-host-call implementation, daemon, MCP service,
  queue adapter, or experimental app-server dependency.
- No acceptance of identity-less direct Steer for new work.
- No held-out reproduction of the original host replay yet.

## Held-out result

The 2026-08-25 UK Dev pilot accepted exact package revision `520a3e8` through a
visible Terra/xhigh host-worktree task. One urgent attempt made one sender host
call, returned `process` on observation, consumed once, and returned
`already-consumed` on repeat. Ordinary completion remained exactly-once;
doctor, integration reproof, audit, and exact worktree/local/remote cleanup
passed. No natural host replay occurred, so same-attempt replay suppression
remains regression-proven rather than held-out host evidence.
