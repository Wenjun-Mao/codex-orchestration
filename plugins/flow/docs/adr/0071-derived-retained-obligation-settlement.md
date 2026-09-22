# ADR 0071: Derive settlement without rewriting abandoned history

## Context

An accepted delivery can retain an immutable `abandoned` run and a matching
`resource_disposition: retained` observation even after every executor and Git
obligation is resolved. Treating that first conservative observation as the
permanent admission answer blocks coordinator closeout and useful overlapping
successors. Rewriting the outcome or adding a duplicate settlement receipt would
create conflicting history and break frozen-reader compatibility.

## Decision

Use one derived settlement interpretation over existing exact authorities.
During `assignment accept`, an abandoned execution is settled only when its
accepted assignment/report match, all persisted native operations are terminal,
all executor members are archived, and the versioned cleanup plan reports every
launch and unbound branch fence clean. Acceptance remains the explicit terminal
dispatch decision for reservations that were admitted but never started.

After coordinator reclamation, consumers reconstruct the same meaning from the
unchanged abandoned run/retirement plus the retired assignment, archived route
and locator, closed iteration, and captured coordinator preservation evidence.
Same-namespace activation, direct cross-version admission, and historical
classification all use that interpretation while holding the repository-wide
admission lock. An authenticated refresh may exclude only its exact already
source-retired namespace while it atomically consumes that handoff. A single-use
in-process capability binds the already-validated refresh to the exact target
run, runtime, workflow, fence set and, when present, persisted assignment
execution binding before the admission gate accepts the exclusion. The abandoned
terminal object and retained retirement bytes are never changed.

Execution settlement excludes coordinator resources that ordinary owning-host
closeout subsequently retires. Locks remain ordered repository admission lock,
then versioned run-lifecycle lock; settlement does not hold either across host
waits and Git facts are revalidated at each consuming boundary.

## Consequences

- Accepted but unresolved abandoned work remains blocked with the exact missing
  authority.
- Frozen v0.9.12 records are readable without replacing their runtime bundle.
- Safe retirement does not certify execution compliance or widen old fences.
- A new settlement receipt is still prohibited unless a future case proves an
  otherwise unrepresentable durable fact.
