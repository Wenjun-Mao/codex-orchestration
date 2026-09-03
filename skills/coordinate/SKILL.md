---
name: coordinate
description: Activate and coordinate one Codex Flow run across separate visible Codex tasks, with content-addressed workflow revisions, explicit model routing, bounded ownership, and non-interrupting result delivery. Use when the user authorizes delegation or parallel task work.
---

# Coordinate Codex Work

Use the installed plugin's bundled v0.8 CLI. The router has already run the
one-time refresh inspection for this actionable request. If it selected
`resume-source`, use the immutable source snapshot rather than this loaded CLI;
if it selected `refresh-ready`, hand off to `codex-orchestration:refresh`.
Inspect top-level `--help` for the current command inventory and the scoped
`task create resolve-private --help` for that temporary adapter; use the public
command families named below and
include the explicit `run_id` in every stateful operation.

## Activate with disclosure

Questions and planning remain read-only. Before an actionable run writes
operational state or creates a native task, disclose:

- the package/runtime source and exact bundle hash;
- the `.git/codex-flow/v0.8.1-dev.0/` Git-common state root;
- the repository, baseline, host, coordinator lineage and generation;
- the proposed workflow revision and path/resource/branch reservation envelope;
- each task's saved project, visible-task or subagent surface, requested model
  and reasoning effort, selector rationale, placement, and external host call;
- which facts are configured, requested, host-accepted, independently observed,
  or unavailable.

An explicit orchestration request permits progressive run activation, not
unmentioned external actions. Use
`run activate|status|resume|rebind|audit|close|abandon`.
Invoke `run activate` only from the host's current coordinator task, and invoke
`run rebind` from the coordinator named by its resume fence. The runtime reads
that host-exposed identity from `CODEX_THREAD_ID` and rejects a different task
before it records activation or replacement authority.
There is no requirement for tracked `.codex/orchestration/`. Activation must
snapshot the exact runtime under the exact-version Git-common namespace and
fail closed on runtime drift, a bounded foreign active-run collision, a second
v0.8 run, or conflicting retained fences. Never use this loaded package to
mutate an active source run from a prior release.

If admission reports an incompatible Flow namespace or requires a clean start,
do not resume, reinterpret, migrate, or manually delete that state while
coordinating a new run. Explain that the run was not activated. When the user
asks to clean that exact repository, route to `codex-orchestration:unplug` for
its archive-first, approval-gated plan; otherwise stop at the admission
failure.

## Persist one workflow

Use `workflow create|revise|status|contract` to persist one content-addressed
plan and generate contracts; never hand-author a parallel instruction or
contract beside the plan. Name:

- the primary outcome, nullable causal question, cheapest safe direct attempt,
  and instrument role for every task;
- dependencies, read/write ownership, exclusive resources, verification, and
  a concrete baseline; and
- the actual native surface, model, reasoning effort, selector rationale, and
  (for subagents) `fork_turns`.

Use the least capable sufficient selector: Luna-medium for mechanical, local,
or read-only work with clear acceptance criteria; Terra-high for bounded
nontrivial implementation or review; Terra-xhigh for multi-module root-cause
or integration work; and Sol-high for coordination or systemic decisions.
Sol-xhigh or Sol-max needs a stated need. Ultra is forbidden for native
subagents and exceptional for visible tasks.

A supporting-instrument task must immediately unlock the named direct attempt
or pause/replan. After one instrument-only checkpoint, more supporting
instrument work needs explicit authorization in a later immutable revision.
Started or released contracts never change. Only accepted terminal authority
unblocks dependencies: a completed visible-task disposition or an accepted
native-subagent operation.

Use visible Codex tasks for independently running or mutating executor-task work.
Use `subagent prepare|attempt|reconcile|complete|dispose|status` only for
bounded read-only research/review. `attempt` exposes one native spawn request;
ambiguous reconciliation never authorizes another spawn. The v0.8 contract
forbids Ultra and full-history forks so an explicit model/effort override stays
compatible with the current host. A subagent cannot own writes, enter the
visible-task lifecycle, or spawn nested subagents.

Read [Parallel execution](../../templates/references/parallel-execution.md)
when the workflow has multiple lanes and [Stop policy](../../templates/references/stop-policy.md)
when authority, cost, or instrumentation scope is uncertain.

## Create and release visible tasks

Before creation, read [Host operations](../../templates/references/host-operations.md).
Use `task create prepare|attempt|resolve-private|reconcile|bind|status` around
exactly one native creation call. Bootstrap includes a cryptographic launch
nonce and no objective. The runtime owns task-create transition timestamps;
do not supply lifecycle clock fields. Preserve timestamps only when they are
authenticated host-event evidence.
Record the host's provisional `clientThreadId` verbatim as bounded opaque
evidence and keep it separate from the ready task ID; never normalize it into
an internal identifier. If the current App supplies only that provisional ID
and no public resolver is available, explicitly disclose and run
`task create resolve-private` when its exact host event evidence is available.
This temporary, read-only adapter requires the App's exact forward/reverse
binding plus the matching initial `create_thread` delegation and emits a complete
`reconcile_request`; persist that request in temporary storage outside the
repository and submit it unchanged to `task create reconcile`. Never infer from
title, recency, worktree, or timing, never invoke the adapter silently, and
never use it to reopen terminal v0.8 state except the exact persisted
`reconciliation-window-expired` ambiguity. That one recovery retains the
original expiry evidence and the same one-shot operation; it never authorizes a
second create. Missing or contradictory private evidence fails closed. The
exact source `create_thread` completion, initial delegation, and
observed-selector host timestamps must be inside the bounded window even if
their private evidence is processed later. The source event may authenticate
and atomically persist a provisional identity and accepted selectors that were
not journaled before an exact window-expiry ambiguity, including the matching
ready identity. Observed selectors belong only to a ready task identity;
provisional and terminal no-ready phases may retain accepted selectors but not
observations. The adapter reads evidence only; it never creates or retries.

Accept the ready identity only when the exact bootstrap digest, launch nonce,
ready ID, selector evidence, and placement agree. Direct ready IDs retain the
ordinary host-observed initial-turn path. Private resolution is discovery and
bootstrap-delivery evidence, not proof of later Git binding.

Reconcile project, requested/accepted/observed model and effort, and the actual
worktree. Run coordinator-owned `task create bind` to persist exact intent,
attach the detached pristine worktree to its reserved branch, and reread its
path, common directory, baseline, branch, and cleanliness before objective
release. The executor-task path must not be the active runtime coordinator root;
recovery preserves intent time and records its actual completion time. Then use
`release prepare|reconcile|accept|status`: send the
prepared prompt at most once and require the executor task to accept from the exact
persisted pristine worktree, on its reserved branch and baseline, using the
exact release, contract, run-bound runtime, and common directory. An ambiguous
send never authorizes blind resend.

If the host rejects the exact selector before creating a native object,
reconcile one terminal no-object outcome: visible tasks use
`selector-rejected-before-task-identity`; subagents use
`selector-rejected-before-agent-identity`. It consumes the contract's one-shot
native call and never authorizes retry or fallback. The coordinator may make
exactly one ordinary content-addressed child revision for that same unstarted
task, changing only its model, reasoning effort, and selector rationale. The
replacement receives a new contract and operation; the original call cannot be
replayed. A visible-task branch may be reused only for that exact predecessor,
same run/task, and live proof that no branch or worktree exists. Ambiguity,
transport failure, any provisional/ready task or subagent identity,
post-creation selector mismatch, or missing evidence stays fail-closed and
cannot authorize replanning.

## Monitor and close

Use native waits only for liveness. After a wait returns, inspect the durable
journal; task final text and wait status are never results. Visible-task routine
completion must stay quiet and journal-only; native subagents finish through
their operation lane. A direct message or Steer is reserved for a persisted
blocker, approval request, or high-risk drift. Use `urgent persist`, then
`urgent attempt`, make the one returned native direct call, and finish with
`urgent reconcile`; the recipient uses `urgent observe` then `urgent consume`,
or `urgent expire` when eligible.

Follow [Communication loop](../../templates/references/communication-loop.md)
and hand terminal work to `codex-orchestration:integrate`. Before normal close,
use `run audit` to persist the content-addressed terminal proof across every
workflow claim, native operation, result, disposition, integration,
verification, archive, cleanup, and reservation fence. `run close` accepts only
a current passing audit. Abandonment releases the active slot but retains the
complete admitted path/resource/branch envelope for later review.
