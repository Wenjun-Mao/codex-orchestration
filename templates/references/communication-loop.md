# Communication Loop

Use two delivery classes:

- **Urgent:** a true blocker, approval request, or high-risk scope/cost drift
  is persisted with `urgent persist`, assigned one numbered delivery attempt,
  and sent through the host's Steer surface using the returned `host_prompt`
  string unchanged.
- **Ordinary terminal completion:** persist one bounded callback with
  `codex-flow callback deliver`; the declared journal monitor is the sole
  integration authority.

Coordinator integration is exactly once by the deterministic callback ID.
Persisted integration lifecycle is `persisted`, `observed`, then `consumed`;
explicit `superseded` and `expired` are terminal alternatives. The v0.4
`journal-monitor` authority creates no host queue notification. The coordinator
calls `callback observe`, then `callback consume` only after the result has
been integrated or deliberately rejected and recorded.

A monitor or coordinator inspects `callback status`; it suppresses duplicate
IDs and remains silent on unchanged state. It must not invent a result from
task age, UI state, or arrival order. Never combine monitor integration with a
separate ordinary-completion queue. v0.4 rejects older callback journals rather
than retaining a second delivery model.

When the current Codex host exposes `wait_threads`, prefer it as the active
coordinator's transient wake-up mechanism. Wait on the active wave, carry each
returned cursor into the next bounded wait, and inspect `callback status` after
a completion wake. A wait result, final task text, timeout, or needs-attention
event is never a receipt and cannot authorize integration. The repository
journal survives compaction, restart, and interrupted waits; wait cursors do
not replace it. A coordinator that has ended its turn still needs an explicit
resume or automation rather than an assumed background wait.

Bind one coordinator lineage before launch. After a fork or authoritative
replacement, fence and rebind that lineage to the new thread generation.
Delivery resolves stale packets to the current generation; observation and
consumption require the current generation. Supply a retained
`next-fence-token` when rebind output could be interrupted, so the exact rebind
can be replayed idempotently.

Urgent delivery is idempotent by logical `urgent_id`, independently of host
envelope shape. Before each host call, run `urgent attempt prepare`; call the
host exactly once only when `dispatch_permitted` is true, then run
`urgent attempt reconcile --host-call-result sent|rejected-before-send|ambiguous`
with the operator-observed result. The recipient must run `urgent observe`
before acting, then use its exact `consume_arguments` afterward. Consumption
names `--sender-executor-id`; it is not the receiver task ID. One attempt
observed twice is a host replay; distinct attempts for one urgent signal are
sender retries. Both are suppressed after the first observation. Corrections
advance the signal sequence. Never send raw urgent content without the
persisted IDs.
