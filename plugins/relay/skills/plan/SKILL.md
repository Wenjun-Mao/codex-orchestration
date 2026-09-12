---
name: plan
description: Draft, revise, and save a project plan for Relay delivery without starting implementation.
---

# Save an Approved Plan

Use the repository's planning location, or `docs/plans/` if none exists.
Write one plan containing outcome, scope/non-goals, consequential decisions,
checkpoints, acceptance evidence, execution authority, and escalation conditions.
Do not duplicate the coordinator's detailed execution breakdown.

Mark unsettled work `Draft`. After approval, mark the revision `Approved`.
Relay stores the plan reference and the supplied assignment scope and acceptance;
it does not snapshot the plan's contents. Editing the plan does not update an
already prepared assignment. Keep its approved meaning clear while work is active.

The director owns intent and acceptance. The coordinator may refine technical
breakdown within that intent. Material changes to scope, acceptance, risk, or
external authority require a newly approved revision and director review of the
affected assignment before continuing.

Native Plan mode is optional. This skill may write the planning document in
ordinary mode but does not authorize implementation. If the current mode
prohibits writes, persist the approved revision after leaving it and before
dispatch.

For “Implement the plan”, use `relay:direct` with the saved plan path to prepare
the assignment and dispatch within the user's authority. Do not replace that
handoff with local implementation, repeated waits, or a second role-specific plan.
