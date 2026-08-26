# ADR 0005: Callback authority and notification lifecycle

## Status

Accepted for v0.3.2; amended for the v0.4.3 active-wait contract.

## Context

v0.3.1 persisted a terminal receipt and then submitted the full callback
envelope through `codex queue`. A coordinator monitor could independently read
and consume the journal before that queued submission started. Consumption and
supersession changed only repository state; the accepted host queue entry had
no stored submission identity and could not be removed. It therefore surfaced
later as a stale user turn even though callback-ID deduplication correctly
prevented a second integration.

The Desktop app-server protocol currently exposes identified queue add/list/
delete methods, but those methods are experimental and not a stable,
universally callable package foundation.

## Decision

Every repository declares exactly one authority for ordinary completion.
v0.3.2 installs `journal-monitor` with no host notification transport. An
executor persists the strict receipt; the coordinator's quiet monitor reads
the journal, observes with an explicit source, and consumes only after
integration.

A capability-probed host wait primitive such as `wait_threads` may wake an
active coordinator when a task completes or needs attention. It is neither a
notification transport nor an integration authority: the coordinator must
return to the repository journal after every wake. Host cursors optimize one
active waiting session but do not replace callback identity or durable state
across interruption, compaction, restart, or a completed coordinator turn.

Integration and notification are independent state machines:

- integration: `persisted -> observed -> consumed`, with `superseded` and
  `expired` as terminal alternatives;
- notification: disabled for journal-monitor, or separately tracked by an
  optional retractable adapter.

The optional adapter is library-level and capability-probed. It requires stable
add/list/delete identities, sends only callback ID and recipient metadata, and
records operation IDs and ambiguous outcomes. Host calls happen after releasing
the journal filesystem lock. Monitor recovery, supersession, and expiry retract
a potentially live notification before changing integration state. A
started, unavailable, or ambiguous retraction fails closed.

Legacy v0.3.1 records are validated and normalized in memory. Reads do not
rewrite them. A subsequent safe mutation writes schema v3. Accepted legacy
queue entries have no retractable identity, remain marked potentially live,
and are reported by `doctor`. A real stale queue turn may mark that
notification started and still cannot integrate an already terminal callback.

Project configuration migration is explicit and plan-bound. New task packets
must match the project ordinary-completion authority. The receipt schema and
deterministic callback ID remain v2.

## Rejected alternatives

- Keep queue plus monitor and rely only on callback-ID deduplication. This
  preserves correctness but continues disruptive stale turns.
- Make experimental app-server queue CRUD mandatory. Host availability and
  compatibility are not established broadly enough.
- Delete or rewrite legacy journal evidence during installation. It would hide
  potentially live host notifications and weaken auditability.
- Queue the full receipt. A pointer is sufficient and avoids stale-turn token
  and data exposure.
- Treat a host wait result or task final text as the receipt. Those are transient
  host observations without the journal's deterministic identity, fencing, or
  exactly-once integration state.

## Consequences

- Ordinary completion is pull-based and requires the coordinator monitor to
  remain active or be resumed.
- An active coordinator can wait efficiently without busy polling when the host
  exposes a bounded wait primitive; durable resumption still starts from the
  journal.
- Fresh v0.3.2 repositories create no ordinary-completion queue backlog.
- Existing accepted v0.3.1 submissions cannot be recalled generically; doctor
  reports that residual risk.
- Retractable queue behavior remains a tested adapter contract, not a claimed
  Desktop capability, until a held-out host field test passes.
