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

## Not claimed

- No prevention of the host injecting a duplicate user turn; the journal makes
  the duplicate nonauthoritative and suppresses repeated action.
- No inference of host replay from sender retries or arrival order.
- No automatic resend, direct-host-call implementation, daemon, MCP service,
  queue adapter, or experimental app-server dependency.
- No acceptance of identity-less direct Steer for new work.
- No held-out reproduction of the original host replay yet.

## Held-out gate

Install the exact v0.4.1 checkpoint in a disposable repository task lifecycle.
Send one identified urgent signal between visible Terra/xhigh tasks, observe and
consume it once, and verify doctor/cleanup state. If the host replays the same
attempt, verify that the second envelope is classified and suppressed. Do not
manufacture a replay and report it as host evidence.
