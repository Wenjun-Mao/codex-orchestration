# ADR 0067: Rebind cancelled coordinator worktrees through settled predecessor authority

Status: Accepted for the v0.9.11 lifecycle-reliability correction

Date: 2026-09-09

Refines: ADR 0054, ADR 0055, ADR 0064, ADR 0066

## Context

Assignment cancellation deliberately preserves its coordinator task, worktree,
and branch. A later assignment can lawfully reuse that exact coordinator
checkout after the failed run and reporting route are retired. Iteration
reclamation nevertheless treated every historical same-path membership as a
simultaneous owner, so an accepted successor could be admitted but could not
reclaim its coordinator worktree.

The run binding's `repository_digest` is not a stable repository identifier:
it hashes the full repository snapshot, including the Git revision. A retained
coordinator may lawfully advance its branch before the successor activates, so
requiring that digest to remain equal rejects the exact recovery this decision
is intended to authorize.

Ignoring all cancelled iterations would remove the symptom by allowing an
unrelated task or branch to inherit deletion authority over preserved
resources. Recording a new transfer schema is unnecessary because the existing
assignment, iteration, sender/recipient, repository, branch, and locator
retirement records already contain the required ownership facts.

## Decision

Use one iteration-worktree ownership classifier at both membership admission
and reclamation. The authenticated source checkout is protected infrastructure
outside this exclusive set: sequential coordinator routes may use it, but
reclamation may never delete it. A same-path historical member is a settled
predecessor only when it is a non-retained coordinator for the exact same host,
task, reporting parent, worktree, branch, canonical Git common directory,
sender, and recipient. The revision-bearing repository digest remains exact
run evidence but is not cross-assignment repository identity. The predecessor's
iteration and assignment must both be cancelled in temporal order, and its
exact report route must have authentic terminal locator-retirement evidence.

During successor admission, no sender locator may remain active. During
successor reclamation, the only permitted active sender locator is the exact
current successor route, validated against its canonical active route and
digest. Any other same-path membership or locator remains a hard conflict.
Repeated cancelled predecessors are lawful only when every member independently
satisfies the same classifier.

Serialize every ownership-set mutation with one repository-scoped worktree
ownership lock, acquired before the per-iteration lock. This includes
coordinator iteration creation, executor registration or rebinding,
host-authenticated coordinator binding correction, and worktree reclamation.
Executor reclamation retains its exact-membership rule and never consumes the
cancelled-coordinator exception.

## Consequences and guardrails

Admission and reclamation cannot disagree about a cancelled predecessor, and a
concurrent membership writer cannot appear between validation and mutation.
Historical cancelled records remain intact and continue to protect resources
from mismatched identities, branches, repositories, or reporting state.

Real-Git lifecycle regressions cover the original cancelled-to-successor
journey with a lawful retained-branch advance between assignments, repeated
cancellation chains, wrong task and branch bindings, a
different worktree, active and reporting-unsettled predecessors, a competing
post-admission executor, and concurrent registration. A public CLI journey also
starts from the exact frozen v0.9.11-rc.1 candidate, consumes refresh into
v0.9.11-rc.2, and completes successor admission plus reclamation. Existing
executor and coordinator closeout tests continue to exercise the same
reclamation boundary.
