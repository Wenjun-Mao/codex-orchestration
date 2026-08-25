# ADR 0009: Journaled urgent direct delivery

## Status

Accepted for v0.4.1 and amended for the v0.4.2 operator surface. The normal
direct-delivery path is held-out proven; a natural host replay remains pending
field evidence.

## Context

Ordinary terminal completion already has a deterministic callback ID and an
exactly-once repository journal. Urgent blockers, approvals, and high-risk
drift still used raw direct Steer messages. A real Desktop run delivered one
sender call twice: both receiver envelopes contained the same source thread and
payload, while the later envelope added a host field. The originating turn
contained exactly one sender tool call, so the duplicate occurred after sender
acceptance. Exact-text matching would be brittle, and host envelope fields are
not stable identity.

## Decision

Urgent direct delivery is journaled before the host call. One logical signal
has a deterministic `urgent_id` derived from recipient lineage, executor, run,
and logical sequence. Its bounded classification, summary, requested action,
expiry, and predecessor are immutable under that identity.

Each host call has a separate `delivery_attempt_id` derived from the urgent ID,
attempt sequence, and recipient generation frozen under the recipient lock.
Preparing an existing attempt never authorizes another host call. A retry
requires the prior attempt to be reconciled, a new contiguous sequence, and an
explicit reason. No host call occurs while a journal lock is held.

The sender passes the returned bounded `host_prompt` string unchanged to Steer
and reports the operator-observed result as `sent`, `rejected-before-send`, or
`ambiguous`. The public names deliberately describe the host call rather than
invite a claim about delivery. The recipient observes the IDs before acting.
Observation returns exact consumption arguments, including the sender executor
ID. The first observation processes the logical signal; later observations are
suppressed. Repeating one attempt identifies a host replay. Observing a different
attempt for the same urgent ID identifies an additional sender attempt.
Consumption is exactly once after the coordinator handles the signal.

Corrected urgent content creates the next logical sequence and names the
immediate predecessor. Host-added envelope fields never participate in
identity. Identity-less urgent messages are nonauthoritative for new work.

## Rejected alternatives

- Reuse terminal callback records. Terminal completion and interruptive
  delivery have different lifecycle and attempt semantics.
- Hash the received envelope. Host normalization can change it, while a real
  correction may intentionally retain most prose.
- Add a daemon, MCP server, queue transport, or mandatory app-server adapter.
  The repository journal and existing direct host call are sufficient.
- Automatically resend an ambiguous attempt. A timeout may hide successful
  asynchronous delivery, so retry must be explicit and separately identified.
- Add a mutable correction event for an operator who misreports a host result.
  Attempt attribution remains immutable; use the existing explicit retry path
  when the actual host outcome is ambiguous.

## Consequences

- A duplicated host turn can still appear, but it cannot authorize duplicate
  coordinator action when the recipient observes before acting.
- Repository state distinguishes host replay from sender retry without storing
  raw transcripts, secrets, account identifiers, or user data.
- Recipient rebinding invalidates an old target attempt; delivery to the new
  coordinator uses an explicit new attempt.
- v0.4.1 added this journal inside the existing fresh v0.4 state namespace.
  v0.4.2 changes only the public operator surface; the stored journal contract
  is unchanged and no compatibility alias is retained.

## Guardrails

Tests cover sender idempotence, host replay, distinct sender attempts,
correction sequence, recipient rebinding, expiry, bounded payloads, unsafe
content rejection, CLI lifecycle, doctor reporting, and audit-only cleanup. A
held-out cross-task direct delivery proved the normal host path. Host replay is
claimed only if the host actually reproduces one. v0.4.2 regressions also prove
the ready-to-dispatch host prompt, rejection of the removed flags, exact
consume arguments, and released host-worktree path/upstream guidance.
