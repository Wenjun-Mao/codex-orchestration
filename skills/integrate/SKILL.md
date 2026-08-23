---
name: integrate
description: Integrate queued Codex executor results exactly once, review branch ownership and provenance, merge serially, run combined verification, consume callbacks, and release resources. Use after one or more executors return.
---

# Integrate Executor Results

Inspect durable state with:

```bash
node .codex/orchestration/bin/codex-flow.mjs callback status
```

For each callback ID, mark it observed using the current bound recipient
generation, then authenticate its branch, revision, cleanliness, owned
diff, verification, and blocker classification. Reject or integrate serially;
never infer success from UI status or task age. After all accepted branches are
combined, run the plan's integration gates and proportional product reproof.

Call `callback consume` with the current recipient identity only after the callback has been integrated or its
rejection has been durably recorded. Then release owned leases and run
`cleanup audit`. Read [Communication loop](../../templates/references/communication-loop.md)
for retry and exactly-once semantics and [Task lifecycle](../../templates/references/task-lifecycle.md)
for closure responsibilities.
