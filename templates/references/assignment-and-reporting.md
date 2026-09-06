# Assignment and result briefs

Use these small briefs at role boundaries. Reference the relevant Flow skill
for mechanics rather than repeating its lifecycle.

## Assignment brief

- **Approved plan:** source path plus the exact content digest or immutable
  snapshot supplied to the coordinator.
- **Outcome:** one observable result.
- **Scope:** owned paths, resources, and work boundary.
- **Constraints:** prohibited actions and preserved authority.
- **Acceptance:** checks and evidence the recipient will review.
- **Reporting:** exactly one recipient and one path.

The plan is saved and bound before dispatch. A linked worktree must not depend
on an uncommitted file in the director checkout. The coordinator may add
technical detail without changing approved intent; a material change returns to
the director/user for approval.

## Result brief

- **Outcome and status:** `complete` or `blocked` against the approved plan and
  assignment.
- **Actual results:** changes or findings actually produced.
- **Evidence:** verification actually run, its outcome, and artifact links.
- **Concerns:** unresolved gaps or risks, or `none`.
- **Next decision:** the decision needed from the recipient, or `none`.
- **Reporting:** the assignment's exact recipient and path.

Write one complete final report. Do not create a separate narrative summary or
ask the task to duplicate the report into another file first. Result or receipt
delivery is not acceptance.

## Reporting transition

For v0.9.3 same-local-host assignments, register and pin the exact upstream
route before useful work: coordinator-to-director from the active run and
approved-plan digest, and executor-to-coordinator as part of `task launch
start`. The Stop hook captures only the complete final and makes one native
queue attempt. Queue acceptance is not delivery, review, or Flow acceptance.
Never remove the explicit manual path until the hook is installed, trusted, and
live-verified for the exact sender-recipient mapping. Cross-host routes remain manual. Routine
results must not Steer an active recipient; preserve quiet callbacks and the
separate rare urgent path.

## Optional advisor

An advisor receives one bounded question and returns independent analysis with
evidence and uncertainties. It issues no commands, owns no acceptance, cannot
appoint or direct a coordinator, and has no coordinator-to-coordinator role.
The advisory contract does not depend on browser automation, MCP, tunnels,
installations, or a personal consultation skill.
