---
name: coordinate
description: Deliver one director assignment through a bounded Codex Flow run, coordinating visible tasks, integration, verification, and one complete non-interrupting result with explicit model routing.
---

# Coordinate Codex Work

Use the loaded v0.9 package only after the router performs one refresh
inspection. A `resume-source` route stays on the immutable source runtime; a
`refresh-ready` route belongs to `codex-orchestration:refresh`.

Own bounded delivery, delegation, integration, and verification for the
director's assignment. Do not take over the director's goals, strategic
tradeoffs, or acceptance authority. Return one complete result containing the
actual outcome and evidence to the assignment's named recipient/path; do not
author a second narrative summary. Result or receipt delivery is not
acceptance. Use the reusable [assignment and result briefs](../../templates/references/assignment-and-reporting.md).

## Activate and plan

Before the first mutation, disclose the package and bundle identity, exact
Git-common state root, repository baseline, coordinator lineage, workflow DAG,
reservation envelope, native surface, requested selector, rationale, placement,
and external host call. Keep configured, requested, accepted, observed, and
unavailable evidence distinct.

Use `run activate|status|resume|rebind|audit|close|abandon`. Every stateful
command names `run_id`. Activation snapshots the exact runtime under the v0.9
namespace and fails closed on incompatible state or conflicting fences.

Use `workflow create|revise|status|contract` for one content-addressed plan.
Every task names its outcome, nullable causal question, cheapest safe direct
attempt, instrument role, dependencies, paths, resources, surface, selector,
rationale, and bounded `fork_turns` where applicable. Only a completed visible
task disposition or accepted native-subagent operation unblocks dependencies.

Choose surface first, then consult the replaceable selector policy:

- coordinator task for sequential or shared evolving state;
- native subagent for bounded read-only supporting work;
- visible task for independent mutating work with durable Git ownership.

The user-selected default is Luna-xhigh for substantive, well-scoped executor
work; it is a preference, not an empirical optimum. A trivial task may use a
lower-effort override with a stated rationale. Use Terra-high for bounded
implementation/review, Terra-xhigh for difficult root-cause work, and Sol-high
for coordination. Astra-high is optional for a consequential director
judgment, not mandatory staffing. Ultra is forbidden for native subagents and
exceptional for visible tasks. Pass selectors, rationales, and bounded fork
history explicitly; never inherit, probe availability, silently escalate, or
fall back. An override replaces the selector rationale.

## Launch a visible task once

Read [Host operations](../../templates/references/host-operations.md). The
native-first lifecycle is:

1. `task launch prepare` authenticates the generated contract and emits the
   canonical full contract, launch nonce, and exact `task launch start` command
   as the first-turn prompt.
2. `task launch attempt` consumes the one-shot creation attempt.
3. Make one native creation call using that exact prompt and explicit project,
   model, reasoning, title, placement, starting revision, and worktree surface.
4. Record the returned ready ID, provisional ID, or bounded opaque result with
   `task launch reconcile`. Unknown shapes never authorize a retry.
5. The executor runs `task launch start` before source mutation. That command
   reads its host task identity, authenticates the nonce/runtime/contract and
   pristine linked worktree, records branch-binding intent, attaches the
   reserved branch, and revalidates it. It then performs useful work in the
   same first turn.

The exact executor start claim can establish the ready task independently of
the creation return. Any known host ID must agree. Title and project may narrow
UI discovery but never establish identity. There is no coordinator branch-bind
wait, second release prompt, ordinary release message, or normal-path history
scan.

A stalled provisional task that never starts may use the registered read-only
provisional-to-ready mapping capsule for archival recovery. It cannot activate
work, create a retry, or replace an exact start claim.

An exact selector rejection before any task/agent identity records
terminal-no-object. One selector-only child revision may replace it with a new
contract and operation. Ambiguity, transport failure, any identity, or
post-creation mismatch remains non-retryable.

## Monitor and close

`wait_threads` is active coordination work, not an idle delivery boundary. Use
native waits for liveness only. Routine visible-task completion is a quiet
journal callback; direct messaging or Steer is reserved for a persisted urgent
blocker, approval request, or high-risk drift. Use `urgent persist`, `urgent
attempt`, make the returned direct call once, then `urgent reconcile`.

Keep the working explicit collection path until a replacement is installed and
trusted, where applicable, and its exact sender-recipient mapping is verified.
The current hook is experimental, uninstalled, and canary-only; it is not
stable automatic full-final delivery.

Hand results to `codex-orchestration:integrate`. Close only after a fresh
passing `run audit` re-derives every claim, launch, result, disposition,
integration/no-change proof, verification, archive, cleanup finding, and fence.
