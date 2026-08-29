# ADR 0016: Content-addressed workflow and native boundary

## Status

Accepted for v0.6.

## Context

In v0.5.1 the parallel plan is validated but not persisted, task packets are
authored separately, provisional and ready host identities require bounded
recovery, release delivery is not acknowledged by the executor, and a task
final can be confused with authoritative completion. Terminal receipts also
require an upstream even though a valid local executor branch may never be
pushed. These gaps weaken the causal chain from user intent to repository
effect.

Native Codex tasks and subagents are different execution surfaces. Visible
tasks can own durable Git work and continue independently. Native subagents
share the coordinator context and are valuable for cheaper research or review,
but should not acquire a second branch/callback/integration lifecycle.

## Decision

v0.6 persists one content-addressed workflow and generates all task contracts
from it.

- A stable logical plan ID groups immutable canonical revisions. A revision may
  change only unstarted tasks and edges; a started or released contract never
  changes.
- Every generated task contract binds the run, runtime/configuration digests,
  plan and revision digests, task-contract digest, coordinator lineage, and the
  concrete baseline known after accepted dependencies.
- Each task states a primary outcome, nullable causal question, cheapest safe
  direct attempt, and instrument role `none`, `supporting`, or
  `primary-deliverable`. Supporting instrumentation must immediately enable a
  dependent direct attempt or pause/replan. More supporting instrumentation
  requires explicit authorization in a later immutable revision.
- Visible task creation is one-shot and records provisional and ready IDs
  separately. Bootstrap carries a cryptographic attempt nonce; the ready task
  must expose that exact nonce in its initial host-visible turn before release.
- Release is a durable handshake. A prepared prompt is sent at most once and
  reconciled as sent, rejected-before-send, or ambiguous. Executor acceptance
  of the exact release, packet, runtime, and common directory is the authority
  to begin work; ambiguity never authorizes blind resend.
- Every terminal task receives a durable coordinator disposition. Only accepted
  dependency dispositions advance the graph; native waits and task finals are
  liveness evidence only.
- The CLI derives Git outcome as `unchanged`, `clean-commit`, or
  `dirty-blocked`. Upstream is nullable. Only `clean-commit` can integrate and
  `dirty-blocked` remains visible and fenced.
- Routine completion uses the durable repository journal and performs no
  direct message or Steer. Urgent delivery persists first and permits one
  identified direct attempt.
- Native subagents are a separate read-only supporting lane. Each has explicit
  model, reasoning, and `fork_turns`; Ultra and write ownership are forbidden.
  The coordinator records created identity, result digest/classification,
  unchanged Git proof, and accepted or rejected disposition. Subagents do not
  create worktrees, branches, callbacks, integrations, archives, or cleanup.

The Codex host remains authoritative for task/subagent execution, model
selection, worktree provisioning, messaging, waits, Handoff, and archive.
Codex Orchestration owns only the durable cross-task governance and provenance
that connect those native effects.

## Rejected alternatives

- Keep independently authored plans and packets. Hashing each separately does
  not prove that one authorized the other.
- Treat task finals or wait results as receipts. They are transient liveness
  signals and cannot establish Git or coordinator disposition.
- Give subagents the visible-task Git lifecycle. It duplicates native context
  and creates unnecessary cleanup and callback state.
- Add a callback daemon, counter journal, or separate evidence state machine.
  Existing result, decision, callback, and Git records are sufficient once
  identity and disposition are bound correctly.

## Consequences and guardrails

- v0.6 schemas are breaking and have no v0.5 compatibility reader.
- Requested, host-accepted, configured, and independently observed model
  evidence remain distinct; an observed mismatch blocks.
- Visible tasks support only same-project native worktrees or explicit local
  worktrees in the same clone/common directory.
- Archive and Git cleanup remain separate reconciled host and repository
  actions. Clean successful tasks may be archived automatically only after
  result disposition, integration or no-change proof, combined verification,
  callback consumption, and managed-worktree reconciliation.
