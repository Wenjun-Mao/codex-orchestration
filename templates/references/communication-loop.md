# Communication Loop

Use two delivery classes:

- **Urgent:** a true blocker, approval request, or high-risk scope/cost drift
  interrupts the coordinator through the host's Steer surface.
- **Ordinary terminal completion:** persist one bounded callback with
  `codex-flow callback deliver`; the declared journal monitor is the sole
  integration authority.

Coordinator integration is exactly once by the deterministic callback ID.
Persisted integration lifecycle is `persisted`, `observed`, then `consumed`;
explicit `superseded` and `expired` are terminal alternatives. Notification
lifecycle is independent. The default `journal-monitor` authority disables
host queue notification entirely. The coordinator calls `callback observe`
with `--source journal-monitor`, then calls `callback consume` only after the
result has been integrated or deliberately rejected and recorded.

A monitor or coordinator inspects `callback status`; it suppresses duplicate
IDs and remains silent on unchanged state. It must not invent a result from
task age, UI state, or arrival order. Never combine monitor integration with a
separate ordinary-completion queue. Legacy records with potentially live queue
notifications remain fail-closed until the actual queue turn arrives or a
retractable identity is proven.

Bind one coordinator lineage before launch. After a fork or authoritative
replacement, fence and rebind that lineage to the new thread generation.
Delivery resolves stale packets to the current generation; observation and
consumption require the current generation. Supply a retained
`next-fence-token` when rebind output could be interrupted, so the exact rebind
can be replayed idempotently.
