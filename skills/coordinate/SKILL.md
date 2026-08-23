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
Render each task packet and pass its resolved `model` and `reasoning_effort` as
the actual task-thread creation arguments; merely mentioning them in a prompt
does not configure the host.

Probe the current session's actual task-thread creation tools. If unavailable,
render the validated packets and hand them to a capable session or human. Do
not silently substitute subagents. Use the smallest concurrency that shortens
the critical path.

Read the detailed references only as needed:

- [Parallel execution](../../templates/references/parallel-execution.md) for
  any multi-executor plan.
- [Communication loop](../../templates/references/communication-loop.md) when
  configuring callbacks or monitors.
- [Stop policy](../../templates/references/stop-policy.md) when authority,
  cost, or shared resources are uncertain.

The coordinator owns task creation, monitors, callback integration, archiving,
resource release, and post-merge reproof. Executors do not.
