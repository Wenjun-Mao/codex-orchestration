# ADR 0024: Terminal callback admission authority

## Status

Accepted for the v0.6.1 development boundary.

## Context

Terminal receipt validation checks schema, internal consistency, content
safety, and canonical receipt identity. It cannot independently know which
model selectors, release, task, or baseline the coordinator actually accepted.
The callback journal nevertheless persisted a receipt before checking that
external authority.

The full comparison existed only during later disposition preparation. A
receipt could therefore claim host-observed Terra/xhigh while the immutable
visible-task creation record said model and effort were unavailable. Delivery
succeeded, observation made the receipt durable coordinator-visible state, and
disposition then rejected it. Because callback identity is immutable, this
created an observed result that could neither be disposed nor safely replaced.

## Decision

- A new terminal callback is admitted only after the existing canonical
  release/creation authority check succeeds. It authenticates the accepted
  release and echo, ready task, full canonical identity, Git baseline, and exact
  configured/requested/accepted/observed model evidence.
- Host observation remains exact provenance. When creation evidence contains
  no complete observed model/effort pair, the receipt must use `observed: null`;
  requested or accepted values are never inferred as observation.
- Admission runs under the callback identity lock immediately before the first
  journal write. Failure writes no callback record.
- Exact replay of an existing immutable receipt is checked before external
  authority is reloaded, preserving idempotence. A different receipt with the
  same callback identity remains an immutable collision.
- Disposition preparation and finalization retain the same authority check as
  defense in depth. Pre-existing invalid callbacks are not silently rewritten,
  superseded, or made disposable by this checkpoint.

## Rejected alternatives

- Validate only receipt syntax. Syntax deliberately cannot establish host or
  run provenance.
- Infer observed selectors from configured, requested, or accepted evidence.
  That would turn unavailable observation into a false independent claim.
- Defer all comparison to disposition. That admits terminal state which the
  next mandatory lifecycle transition cannot consume.
- Add a correction/supersession state machine now. Preventing invalid admission
  is the smallest safe direct fix; historical repair needs a separately
  reviewed immutable authority contract.
- Weaken disposition validation for rejected results. A rejection decision
  does not legitimize a receipt that belongs to no accepted task execution.

## Consequences and guardrails

Invalid terminal model evidence now fails at `callback deliver`, before durable
journal state exists. Focused regressions reproduce the reported null-versus-
Terra/xhigh mismatch, prove an empty journal after rejection, preserve exact
delivery replay, and reject ready-task, baseline, selector, and recipient drift
at the same admission boundary.

An already persisted invalid v0.6.0 callback remains blocked and auditable. A
future repair path, if required, must preserve the original receipt and add an
explicit immutable correction authority rather than editing journal history.
