---
name: plan
description: Save and bind an approved project plan before delegated Codex Flow delivery.
---

# Save and Bind a Plan

Use the repository's planning location, or `docs/plans/` if none exists.
Write one plan containing outcome, scope/non-goals, consequential decisions,
checkpoints, acceptance evidence, execution authority, and escalation conditions.
Do not duplicate the coordinator's execution DAG.

Mark unsettled work `Draft`. After approval, mark the revision `Approved` and
bind its exact content digest or immutable snapshot. A mutable path is not
approval evidence. Use existing content-addressed persistence; do not create
another approval system.

The director owns intent and acceptance. The coordinator may refine technical
breakdown within that intent. Material changes to scope, acceptance, risk, or
external authority require a newly approved revision.

Native Plan mode is optional. This skill may write the planning document in
ordinary mode but does not authorize implementation. If the current mode
prohibits writes, persist the approved revision after leaving it and before
dispatch.

For “Implement the plan”, supply the [assignment brief](../../templates/references/assignment-and-reporting.md)
with approved bytes or an immutable snapshot readable in the coordinator's
worktree, plus source path and digest. Then use `codex-orchestration:direct`
for one coordinator dispatch and return. Do not replace that handoff with local
implementation, repeated waits, or a second role-specific plan.
