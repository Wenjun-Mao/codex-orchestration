---
name: plan
description: Save an approved project plan for delegated Codex Flow delivery.
---

# Save an Approved Plan

Use the repository's planning location, or `docs/plans/` if none exists.
Write one plan containing outcome, scope/non-goals, consequential decisions,
checkpoints, acceptance evidence, execution authority, and escalation conditions.
Do not duplicate the coordinator's execution DAG.

Mark unsettled work `Draft`. After approval, mark the revision `Approved`.
Assignment preparation saves a fixed copy for delivery; later edits to the
source document do not change that assignment.

The director owns intent and acceptance. The coordinator may refine technical
breakdown within that intent. Material changes to scope, acceptance, risk, or
external authority require a newly approved revision.

Native Plan mode is optional. This skill may write the planning document in
ordinary mode but does not authorize implementation. If the current mode
prohibits writes, persist the approved revision after leaving it and before
dispatch.

For “Implement the plan”, use `codex-orchestration:direct` to prepare the
[assignment brief](../../templates/references/assignment-and-reporting.md)
from the saved plan path, dispatch one coordinator, and return. Do not replace
that handoff with local implementation, repeated waits, or a second role-specific
plan.
