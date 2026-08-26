---
name: integrate
description: Integrate journaled Codex executor results exactly once, review branch ownership and provenance, merge serially, run combined verification, consume callbacks, and release resources. Use after one or more executors return.
---

# Integrate Executor Results

Inspect durable state with:

```bash
node .codex/orchestration/bin/codex-flow.mjs callback status
```

Also inspect `urgent status`. A pending urgent signal is coordinator work, not
an executor completion: observe it before acting, suppress any duplicate
disposition, and consume it only after the requested decision is handled.

For each callback ID, keep it persisted while authenticating its branch,
revision, cleanliness, owned diff, verification, blocker classification, and
any independent review. Recheck callback status, then mark only the exact
receipt selected for disposition as observed using the current bound recipient
generation. Reject or integrate serially; never infer success from UI status or
task age. An observed receipt is an immutable checkpoint; later correction
requires a fresh task operation and run rather than sequence supersession. After
all accepted branches are combined, run the plan's integration gates and
proportional product reproof, then record each exact branch disposition with
`codex-flow git integrate`.

Call `callback consume` with the current recipient identity only after the callback has been integrated or its
rejection has been durably recorded. Then release owned leases and run
`cleanup audit`. Eligible Git state may be removed only through a reviewed
`cleanup plan` / `cleanup apply` pair. Read [Communication loop](../../templates/references/communication-loop.md)
for retry and exactly-once semantics and [Task lifecycle](../../templates/references/task-lifecycle.md)
for closure responsibilities.

A partial cleanup apply exits nonzero but reports its plan ID, completed
actions, stopping action, and bounded reason. Never retry that plan. Audit the
resulting state and create a fresh plan for only what remains.
