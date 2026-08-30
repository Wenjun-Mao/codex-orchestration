# ADR 0030: Prepare-admission ordering

## Status

Accepted for v0.7.1.

## Context

A native claim or operation record was persisted before its prospective journal
timestamp and transition were validated. A synchronous validation failure could
therefore leave predispatch state even though no native attempt or identity was
authorized. Retrying from that residue risks treating an invalid local record
as a real host outcome.

## Decision

- Construct and validate the prospective claim, timestamp, and journal
  transition before persistence. Serialize that admission under the
  branch -> contract -> journal lock order.
- Persist the full predispatch native record before its local claim, then
  commit the already-validated workflow transition. A crash at either native
  write boundary therefore has a named, no-host-call recovery state.
- If synchronous predispatch persistence fails, compensate only files created
  by that invocation before any native attempt, and only after their parsed
  content matches the exact expected record or claim. Never roll back unknown
  state or a record that may describe a host call.
- Recovery branches on a structured workflow startability state rather than an
  error string. It may remove only an exact record-only, claim-only, or paired
  predispatch orphan proved to have no native attempt and no provisional,
  ready-task, or agent identity. Any attempt evidence, identity, ambiguity, or
  drift remains fail-closed and requires ordinary reconciliation.

## Consequences

Preparation either becomes fully valid durable evidence or leaves no new
predispatch residue. This preserves one-shot native authority without turning
recovery into blind retry.
