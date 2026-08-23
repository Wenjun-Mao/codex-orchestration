# Communication Loop

Use two delivery classes:

- **Urgent:** a true blocker, approval request, or high-risk scope/cost drift
  interrupts the coordinator through the host's Steer surface.
- **Ordinary terminal completion:** persist and queue one bounded callback with
  `codex-flow callback deliver`.

Queued delivery is at least once. Coordinator integration is exactly once by
the deterministic callback ID. The coordinator calls `callback consume` only
after the result has been integrated or deliberately rejected and recorded.

If queue transport is unavailable, exit status 75 means the receipt remains
durable. A monitor or coordinator may inspect `callback status`; it must not
invent a result from task age or UI state.
