# ADR 0006: Host capability and observation evidence

## Status

Accepted for v0.3.3.

## Context

Codex host controls are session-dependent. In one Desktop session, two explicit
Terra/xhigh task-thread calls failed before creation with a serializer error.
After a reboot, the same requested path succeeded. The created thread initially
used the full delegation envelope as its title, then exposed the exact requested
title only after a bounded title update and reread. Subagent creation exposed an
agent ID and nickname, but no independent packet-title field.

Treating all of these results as either permanent selector incompatibility or
fully observed success loses material evidence. Retrying a serializer failure
inside the same host session also risks duplicate creation.

## Decision

Before dispatch, each task operation records strict host-capability evidence
bound to a named host session. It separately classifies execution-kind, model,
and reasoning support. Unknown or unsupported required selectors stop before an
attempt is created. A dispatch-time serializer, adapter, backend, schema-runtime,
or host-control failure blocks that host session. Retry requires a compatible
preflight from a different host session.

Operation IDs remain the deterministic `task-operation-v1-*` identity. Persisted
operation records use schema v2 and retain an immutable host-preflight history
plus one active preflight pointer. Every nonlegacy attempt references the exact
preflight that authorized it.

Successful reconciliation stores field-level provenance:

- Task-thread title must be host-observed and exactly match the requested title.
  If the host substitutes another title, the coordinator may perform one bounded
  title write, then must reread the exact title and record
  `normalization: bounded-host-write`.
- Subagent title may be unavailable. A host nickname is recorded separately and
  never substituted for packet title.
- Visibility, model, and reasoning record whether evidence was host-observed,
  host-accepted, role-derived, contract-derived, or unavailable. Partial evidence
  remains explicit in status, doctor, and cleanup output.
- A rejected filtered thread-list query is recorded once with a bounded
  unfiltered-list or exact-read fallback. Runtime schema drift is not repeatedly
  probed in the same operation.

The portable package never performs private host calls while holding the
repository journal lock. The coordinator records preflight evidence, begins the
attempt, releases the lock, performs one bounded host action, inspects the host,
then reconciles.

Legacy operation schema v1 is validated and migrated in memory without rewriting
on read. A later safe mutation writes schema v2 and preserves legacy provenance.

## Rejected alternatives

- Reject Terra permanently because one advertised selector list omitted it.
  A real post-reboot task-thread creation accepted Terra/xhigh.
- Retry serializer failures immediately. The result may be ambiguous and the
  failure has already invalidated confidence in that host session.
- Accept the requested title as observed. This concealed a real delegation-
  envelope title substitution.
- Reconcile subagent nickname as packet title. The host fields have different
  meanings.
- Replace prior preflight evidence on retry. That would orphan historical attempt
  provenance.

## Consequences

- Coordinators need a stable, nonsecret host-session marker and must refresh it
  after a restart or host-generation change.
- Selector incompatibility and transient host-session failure have different
  recovery paths and doctor output.
- Most real host observations may honestly remain partial when model or reasoning
  cannot be independently read after creation.
- v0.3.2 callback authority and exactly-once journal integration are unchanged.
