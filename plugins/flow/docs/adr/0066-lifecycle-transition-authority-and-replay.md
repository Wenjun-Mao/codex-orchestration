# ADR 0066: Make lifecycle transitions consume one durable authority

Status: Accepted for the v0.9.11 lifecycle-reliability implementation

Date: 2026-09-09

Refines: ADR 0054, ADR 0059, ADR 0063, ADR 0064

## Context

Coordinator-owned work, workflow claims, assignment acceptance, closeout, and
successor admission have intentionally different lifetimes. Four v0.9.10 paths
nevertheless either omit a legitimate producer or decide the same transition
twice: completed coordinator work cannot unblock a dependent task, interrupted
coordinator writes do not always reconcile, replay compares a new clock value,
and assignment acceptance chooses its report before acquiring the assignment
lock.

## Transition map

| Transition | Authoritative producer fact | Consumer and lock/write boundary | Supported replay | Next owner |
| --- | --- | --- | --- | --- |
| Local start | Deterministic coordinator-work identity plus the first persisted start record | Persist the start under the per-record boundary, then advance the operation claim under the journal lock; a fresh start also requires the exact clean baseline | Reauthenticate the immutable task/repository identity, retain the first timestamp and current progress, and reconcile a missing claim transition | The bound coordinator |
| Local completion | The completed coordinator-work record with its original result, passing checks, and completion time | Run checks before either terminal write, persist completion under the per-record lock, then advance the same claim under the journal lock | Exact coordinator and check evidence may reconcile the claim without executing checks again; conflicting evidence fails | Dependency consumers and run audit |
| Dependency admission | The terminal record produced by the dependency's execution surface | Contract generation resolves that record while holding the journal lock and records its digest in the generated contract | Repeated generation consumes the same persisted authority; wrong task, runtime, state, or failed verification fails | The dependent coordinator, visible task, or subagent |
| Assignment acceptance | The first accepted report identity written into assignment authority | State and report comparison occur inside the assignment lock; host archive operations remain outside it | The same report converges while retaining the first acceptance time; another report or terminal state conflicts | Owning-host closeout |
| Assignment cancellation | The first director-authenticated cancellation written into assignment authority after terminal/reporting preflight | `open` to `cancelled` is chosen under the assignment lock before route, locator, or iteration cleanup; no external action runs in the lock | The same director/reason resumes remaining cleanup from persisted cancellation; acceptance, retirement, or another cancellation conflicts | Reporting and iteration cleanup |
| Acceptance retirement | Accepted assignment authority plus a completed owning-host closeout | The assignment lock permits only `accepted` to `retired`; an already-retired record is unchanged | Remaining route/locator retirement and the final assignment write may resume without replacing acceptance | Successor admission |
| Resource reclamation | The accepted per-member archive attempt and its authenticated preservation owner | Re-read the iteration under its lock before exact Git mutation; host archive calls stay outside the lock | Reconcile the same archive attempt and reclaim only its named worktree/branch once | Assignment closeout |
| Run repository proof | Completed coordinator work and integration-scoped passing verification records are candidate terminal Git facts | Audit selects the unique lawful maximal fact in the Git graph instead of preferring one execution surface | Equivalent records for that fact converge; a stale match, divergent maxima, or mismatch fails closed; with no terminal candidate, the unchanged activation baseline remains authoritative | Run closeout and reporting |
| Successor admission | Settled predecessor classification authenticated from existing terminal assignment, iteration, route, run-audit, and preservation evidence | Refresh and run admission revalidate the classification under their existing admission locks | Re-run the same classifier; unresolved or unrelated historical obligations remain blockers | The successor assignment/run |

## Decision

Extend the existing dependency contract to recognize a completed
`coordinator-work` record as the terminal authority for a coordinator task.
Validate the same run, runtime, repository, plan revision, task contract,
passing verification, and completed workflow claim used by the producer. Do not
relabel local work as a subagent or disposition.

For coordinator start and completion, separate immutable identity from recorded
time and progress. Create timestamps only for a new record. A retry reads and
authenticates the existing record first, preserves its observations, and uses
the existing journal transition to reconcile a partial write. Completion replay
must not execute checks again.

Select assignment acceptance inside `updateAssignmentAuthority`'s lock.
Same-report retries preserve the original acceptance and different-report or
incompatible terminal transitions fail. Retirement likewise changes only an
accepted assignment and is idempotent once retired. No host operation moves
inside the assignment lock.

Cancellation performs terminal-run, iteration, and report preflight before it
chooses `open` to `cancelled` inside the same assignment lock. Route, locator,
and iteration cleanup follow that persisted fact and are replayable. This keeps
acceptance and cancellation mutually exclusive before either path performs its
external or dependent mutations.

Run audit treats completed local work and integration-scoped passing
verifications as candidate proofs of repository state. When candidates exist,
the current clean authoritative checkout must exactly match their unique lawful
maximal Git fact. Records that prove the same fact are equivalent; a rollback
matching only an older fact, divergent maxima, or an unverified checkout fails
closed. With no terminal candidate, the unchanged activation baseline remains
authoritative for genuine worker-only no-change runs.

## Rejected alternatives

- Removing local dependencies or fabricating worker-shaped authority would hide
  the missing producer-to-consumer connection.
- Treating all coordinator records as equivalent would allow unfinished or
  failed work to unblock dependents.
- Comparing complete persisted records on retry makes timestamp observations
  part of identity and prevents lawful resume.
- A database transaction, generic recovery registry, or long-held lock across
  App operations would broaden the change without removing the demonstrated
  duplication.

## Consequences and guardrails

Executable regressions cover mutation and no-change local dependencies across
the distinct local, visible-task, and subagent consumers; partial start and
completion persistence; later-time replay; conflicting authority; and
deterministically interleaved acceptance. Connected journey tests retain real
Git topology and exercise closeout followed by successor admission. Existing
run, assignment, reporting, iteration, and resource records remain separate,
and retained historical obligations are neither erased nor reclassified.
