# Communication Loop

Use two delivery classes:

- **Urgent:** a true blocker, approval request, or high-risk scope/cost drift
  interrupts the coordinator through the host's Steer surface.
- **Ordinary terminal completion:** persist and queue one bounded callback with
  `codex-flow callback deliver`.

Queued delivery is at least once. Coordinator integration is exactly once by
the deterministic callback ID. Persisted lifecycle is `persisted`,
`enqueue-attempted`, `enqueued`, `observed`, then `consumed`; explicit
`superseded` and `expired` are terminal alternatives. The coordinator calls
`callback consume` only after the result has been integrated or deliberately
rejected and recorded.

If queue transport is unavailable, exit status 75 means the receipt remains
durable. A queue timeout is ambiguous and must be reconciled before retrying.
A monitor or coordinator may inspect `callback status`; it suppresses duplicate
IDs and remains silent on unchanged state. It must not invent a result from
task age, UI state, or arrival order.

Bind one coordinator lineage before launch. After a fork or authoritative
replacement, fence and rebind that lineage to the new thread generation.
Delivery resolves stale packets to the current generation; observation and
consumption require the current generation. Supply a retained
`next-fence-token` when rebind output could be interrupted, so the exact rebind
can be replayed idempotently.
