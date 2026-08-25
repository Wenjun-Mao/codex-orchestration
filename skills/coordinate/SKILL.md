---
name: coordinate
description: Plan and coordinate independent Codex task threads with an authenticated baseline, explicit ownership DAG, shared-resource gates, bounded task packets, and durable callback routing. Use when the user authorizes delegation or parallel task work.
---

# Coordinate Codex Work

Run the pinned repository entrypoint before planning:

```bash
node .codex/orchestration/bin/codex-flow.mjs doctor
node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator
```

Bind product authority and the exact baseline first. Create a plan that names
dependencies, disjoint write paths, exclusive resources, and serial gates;
validate it with `codex-flow plan validate` before launching mutating work.
Bind the coordinator recipient lineage before launching executors. Render each
task packet and pass its requested execution kind, environment, resolved
`model`, and `reasoning_effort` as actual host creation arguments; merely
mentioning them in a prompt does not configure the host.

For `local`, derive the packet's exact Git worktree root, full `HEAD`, and
cleanliness. For `host-worktree`, derive the saved repository root, exact local
starting branch and full branch tip, plus a distinct unclaimed executor branch.
Do not expand or transcribe a short revision. `prepare` authenticates before
journaling and `attempt` repeats the check immediately before dispatch.

Probe the current session's actual creation tools and bind the result to a
stable host-session marker. Journal each creation with `task operation prepare`,
`preflight`, and `attempt`, then inspect and reconcile field-level evidence. If
the requested kind or selector is unavailable, render the packet for a capable
session or human. Do not silently substitute a subagent for a task thread or a
task thread for a subagent. A serializer or host-control failure blocks retry in
that session; record a new session preflight after restart. Use the smallest
concurrency that shortens the critical path and never launch after the packet
deadline.

For a host-created worktree, create the task with only the generated bootstrap
prompt. Observe its actual path, reconcile, run `codex-flow git bind`, then
generate and send `task operation release`. Binding persists its claim receipt
before attaching the declared executor branch to a pristine detached baseline;
an interrupted bind may resume only from that exact receipt, and any other named
branch is a hard stop. Never guess a host path or send the objective before binding. For any
project-backed executor, bind the observed operation to its exact canonical
worktree before implementation begins.
Task creation fails closed at the configured cleanup threshold; reconcile
completed Git ownership before launching another wave.

Task-thread title must be independently reread. If the host used the delegation
envelope, make one bounded title update, reread the exact requested title, and
record that normalization. A subagent nickname is a host label, not title proof.

Read the detailed references only as needed:

- [Parallel execution](../../templates/references/parallel-execution.md) for
  any multi-executor plan.
- [Communication loop](../../templates/references/communication-loop.md) when
  configuring callbacks or monitors.
- [Stop policy](../../templates/references/stop-policy.md) when authority,
  cost, or shared resources are uncertain.
- [Host operations](../../templates/references/host-operations.md) before task
  creation or timeout recovery.

The coordinator owns task creation, monitors, callback integration, archiving,
resource release, and post-merge reproof. Executors do not.

For an urgent direct envelope, run `urgent observe` before acting. Process only
the first logical observation, suppress host replays and additional sender
attempts, then run `urgent consume` after the decision is handled.
