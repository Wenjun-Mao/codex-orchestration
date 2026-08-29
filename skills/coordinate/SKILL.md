---
name: coordinate
description: Activate and coordinate one Codex Flow run across separate visible Codex tasks, with content-addressed workflow revisions, explicit model routing, bounded ownership, and non-interrupting result delivery. Use when the user authorizes delegation or parallel task work.
---

# Coordinate Codex Work

Use the installed plugin's bundled v0.6 CLI. Inspect its current `--help` for
exact flags; use the public command families named below and include the
explicit `run_id` in every stateful operation.

## Activate with disclosure

Questions and planning remain read-only. Before an actionable run writes
operational state or creates a native task, disclose:

- the package/runtime source and exact bundle hash;
- the `.git/codex-flow/v0.6.0/` Git-common state root;
- the repository, baseline, host, coordinator lineage and generation;
- the proposed workflow revision, path/resource/branch fences, and leases;
- each task's saved project, visible-task or subagent surface, requested model
  and reasoning effort, placement, and external host call; and
- which facts are configured, requested, host-accepted, independently observed,
  or unavailable.

An explicit orchestration request permits progressive run activation, not
unmentioned external actions. Use
`run activate|status|resume|rebind|audit|close|abandon`.
There is no requirement for tracked `.codex/orchestration/`. Activation must
snapshot the exact runtime under the exact-version Git-common namespace and
fail closed on v0.5 tracked authority, runtime drift, a second active run, or
conflicting retained fences.

## Persist one workflow

Use `workflow create|revise|status|contract` to persist one content-addressed
plan and generate contracts; never hand-author a parallel instruction or
contract beside the plan. Name:

- the primary outcome, nullable causal question, cheapest safe direct attempt,
  and instrument role for every task;
- dependencies, read/write ownership, exclusive resources, verification, and
  a concrete baseline; and
- the actual native surface, model, reasoning effort, and (for subagents)
  `fork_turns`.

A supporting-instrument task must immediately unlock the named direct attempt
or pause/replan. After one instrument-only checkpoint, more supporting
instrument work needs explicit authorization in a later immutable revision.
Started or released contracts never change. Only completed accepted durable
dispositions unblock dependencies.

Use visible Codex tasks for independently running or mutating executor work.
Use `subagent prepare|created|complete|dispose|status` only for bounded read-only
research/review. A subagent cannot use Ultra, own writes, or enter the visible
task lifecycle.

Read [Parallel execution](../../templates/references/parallel-execution.md)
when the workflow has multiple lanes and [Stop policy](../../templates/references/stop-policy.md)
when authority, cost, or instrumentation scope is uncertain.

## Create and release visible tasks

Before creation, read [Host operations](../../templates/references/host-operations.md).
Use `task create prepare|attempt|reconcile|status` around exactly one native
creation call. Bootstrap includes a cryptographic launch nonce and no objective.
Record provisional `clientThreadId` and ready task ID separately; accept the
ready identity only when its initial host-visible turn contains the exact nonce.
Title or timing similarity never correlates identity. Ambiguity fails closed.

Reconcile project, requested/accepted/observed model and effort, and the actual
worktree. Bind a pristine host-created worktree at the exact baseline before
objective release. Then use `release prepare|reconcile|accept|status`: send the
prepared prompt at most once and require the executor to accept the exact
release, contract, runtime, and common directory before work begins. An
ambiguous send never authorizes blind resend.

## Monitor and close

Use native waits only for liveness. After a wake, inspect the durable journal;
task final text and wait status are never results. Routine completion must stay
quiet and journal-only. A direct message or Steer is reserved for a persisted
blocker, approval request, or high-risk drift with one identified attempt.

Follow [Communication loop](../../templates/references/communication-loop.md)
and hand terminal work to `codex-orchestration:integrate`. Before normal close,
use `run audit` to persist the content-addressed terminal proof across every
workflow claim, native operation, result, disposition, integration,
verification, archive, fence, and lease. `run close` accepts only a current
passing audit. Abandonment releases the active slot but retains every
unresolved fence and lease for later review.
