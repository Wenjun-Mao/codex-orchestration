# ADR 0068: Publish assignment readiness and retain execution retirement

Status: Accepted for the v0.9.11 assignment-boundary consolidation

Date: 2026-09-09

Refines: ADR 0054, ADR 0059, ADR 0064, ADR 0066, ADR 0067

## Context

Coordinator registration durably writes an `open` assignment before its
iteration, report route, and repository locator exist. Exact retry can repair
some interruptions, but status assumes the iteration already exists and
cancellation assumes every dependent record exists. An interruption after the
route write but before locator installation can therefore strand a nominally
open assignment with no lawful failed exit.

The assignment also retains every authenticated execution binding across a
refresh while cancellation rereads each execution's namespace. Refresh may
lawfully remove a terminal source namespace before that longer-lived consumer
runs. Separately, assignment acceptance can authorize coordinator archival
without proving that its bound Flow execution stopped. These are lifetime and
publication defects in one boundary: consumers have exact identities, but no
shared durable fact saying that registration is usable or that an execution
became terminal before its source evidence retired.

## Decision

The existing assignment authority owns two additional facts.

First, new assignments begin in `registering` state with monotonic progress for
their deterministic iteration, recipient binding, route, and locator. Each
producer records progress only after its own durable operation succeeds. The
assignment becomes `open` only after every required artifact exists. Retry
reconciles the same deterministic identities and retains the original
assignment and artifact times. Read-only status reports the intermediate state;
a missing artifact that was already recorded ready is corruption, not partial
registration.

Second, the assignment retains one authenticated execution-retirement record
for each execution binding that becomes terminal. The record includes the exact
binding identity, terminal status and digest, the full unresolved-fence fact,
its evidence source, resource disposition, authorized owner, and next action.
Ordinary cancellation and acceptance may reconcile a still-readable runtime
into this record. Refresh must persist the source execution's authenticated
retirement and refresh-cleanup disposition before deleting its namespace.
Replays preserve the first observation time and reject different evidence.

Consumers keep distinct eligibility rules:

- Registration may reconcile only its own deterministic artifacts while the
  bound run remains active.
- Status is available during registration and identifies the next supported
  continuation without publishing readiness.
- Cancellation requires every execution to be terminal, every existing report
  to be settled, and every live executor to be archived. For never-published
  pending artifacts, absence is an expected state; an artifact recorded ready
  but missing remains blocked. Cancellation records retained resource
  obligations rather than treating terminal execution as cleanup.
- Acceptance may record the director's decision while execution is active, but
  coordinator archival and locator retirement remain pending until all bound
  executions have retirement evidence eligible for cleanup. A closed execution
  is eligible; a refresh-retired predecessor is eligible; an abandoned
  execution with retained fences is not.
- Successor admission continues to use its existing repository, assignment,
  iteration, locator, and run-fence checks. The new records explain retained or
  transferred obligations; they do not bypass a conflicting active or retained
  fence.

Run activation also derives path and shared-resource reservations from the
canonical workflow revision when callers omit those repeated fields. Branch
reservations remain explicit, and supplied path/resource reservations are still
jointly validated against the workflow. This removes transcription without
weakening independent admission checks.

## What this replaces

- Publishing `open` and relying on later files to imply readiness is replaced
  by one assignment-owned publication point.
- Status and cancellation reconstructing whether registration finished is
  replaced by monotonic per-artifact progress and exact absence rules.
- Cancellation rereading every historical namespace is replaced by bounded
  retirement evidence in the already-owning assignment record.
- Coordinator cleanup inferring execution completion from report acceptance or
  App idleness is replaced by explicit execution-retirement eligibility.
- Repeating workflow path/resource reservations in activation requests is
  replaced by derivation from the authenticated workflow revision.

## Rejected alternatives

- Preflight alone cannot recover a crash after the first durable write.
- Keeping all source namespaces until assignment termination avoids summary
  design but prolongs package/runtime state and conflicts with the established
  authenticated refresh retirement boundary.
- A universal `done` flag would conflate execution stop, cancellation,
  reporting retirement, resource cleanup, and successor admission.
- A new transaction journal, evidence registry, or compatibility rescue command
  would duplicate existing ownership and expand the migration surface.

## Consequences and guardrails

Assignment schema validation accepts legacy records without readiness or
retirement fields as already-published authority; new writers always emit the
explicit contract. Missing legacy ready artifacts still fail closed. External
host operations remain outside assignment locks, and progress updates are
monotonic exact replays.

Connected tests must cover interruption after each registration persistence
boundary, both resume and lawful abort, source removal before same-assignment
cancellation, acceptance before execution termination, real locator retirement,
changed Git commits, and useful successor work. Side-effect counts and original
timestamps guard replay. Pure tests retain corruption and concurrency cases.
