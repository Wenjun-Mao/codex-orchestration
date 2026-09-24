# Relay 0.4.1 bounded maintenance verification

## Scope and result

External review against `8112003` exposed continued-final exclusion, stranded lock
initialization, optional-title timeout, and acknowledgement/cleanup conflation.
The reviewer probes reproduced these conditions locally before edits. New desired-
behavior tests failed against the old implementation and pass with the corrections.
No registry schema, worker instructions, lifecycle controller, or persistent report
storage was added. Structured UI warnings are deferred, not claimed as fixed.

## Local checks

- Source suite: 15/15 passing, including write and fsync failure injection, exact
  replay and changed-body identity in continued turns, stalled/late title lookup,
  closure before title response, and no retry of an unacknowledged queue send.
- Relocated package: the same 15 tests pass; the explicit 16-file manifest matches.
- Plugin validation and whitespace checks pass.

## Native transport observation

Used the source adapter and this task's real native identity as sender and receiver.
No fake Stop was submitted, route registered, worker created, or other project touched.
Two labelled Unicode report bodies each received exact queue acknowledgements.
An intentional replay of the first already-acknowledged request also received an
exact acknowledgement, but its queue ID differed from the initial queue ID.
This is not evidence of native duplicate suppression. No ambiguous send was retried.

These observations establish native queue compatibility, not recipient-visible
receipt or a genuine continued-Stop journey. Same/different-turn correction behavior
is covered by fixtures; a real continued-Stop event and structured warning rendering
remain unqualified. Existing successful user usage is not contradicted by these gaps.
