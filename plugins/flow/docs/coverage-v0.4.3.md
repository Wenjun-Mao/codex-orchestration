# Codex Flow v0.4.3 coverage

v0.4.3 adopts the Codex App's capability-probed `wait_threads` operation as the
preferred active-turn waiter. It changes guidance and packaged skills only;
the accepted v0.4.2 runtime, schemas, callback journal, and Git lifecycle are
unchanged.

## Covered

- Active coordinators prefer one bounded wait over repeated thread reads.
- Returned task cursors are carried into subsequent waits to suppress repeated
  final text within the active session.
- Every completion wake, needs-attention event, timeout, or interruption returns
  to repository `callback status` before any integration decision.
- The journal remains the sole ordinary-completion authority and durable resume
  point across compaction, restart, or an ended coordinator turn.
- Larger waves are batched within the host-advertised target limit.
- Hosts without `wait_threads` retain bounded list/read or explicit-monitor
  fallback without changing callback semantics.

## Not claimed

- No background waiter after the coordinator turn ends.
- No callback delivery, observation, consumption, deduplication, or integration
  authority from host wait results or task final text.
- No new daemon, automation, queue, schema, journal state, or runtime adapter.
- No public stability guarantee for this Codex App host capability; it must be
  probed in the current session.

## Verification boundary

Source validation and package tests continue to cover the unchanged runtime.
A downstream field use should confirm one multi-task active wave wakes through
`wait_threads`, then integrates only the callback found in the repository
journal. A host replay or wait interruption is claimed only if naturally
observed.
