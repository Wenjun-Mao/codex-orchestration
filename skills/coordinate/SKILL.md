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

For local and worktree tasks, derive the packet's absolute Git worktree root,
exact full `HEAD`, and cleanliness directly from that repository. Do not expand
or transcribe a short revision by hand. `task operation prepare` authenticates
this baseline before journaling and `attempt` authenticates it again immediately
before dispatch.

Probe the current session's actual creation tools. Journal each creation with
`task operation prepare` and `attempt`, then inspect and reconcile the created
object. If the requested kind is unavailable, render the packet for a capable
session or human. Do not silently substitute a subagent for a task thread or a
task thread for a subagent. Use the smallest concurrency that shortens the
critical path and never launch after the packet deadline.

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
