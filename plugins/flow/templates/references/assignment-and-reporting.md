# Assignment and result briefs

## Assignment brief

Before task creation, the director runs `assignment prepare --file request.json
--json` through the authenticated package. The request contains
`approved_plan_path`, `recipient`, `iteration_label`,
`purpose`, `outcome`, `scope`, `acceptance_criteria`, `constraints`, and `reasons`.
The recipient is the director's exact `host_id`, `lineage_id`, `thread_id`, and
`generation`; the command derives its binding digest.

Use the returned title and complete text as the initial assignment. Preparation
captures the plan from that path, computes its digest, and persists its snapshot
and reporting destination before the sender exists. The brief links to the saved
copy; the coordinator later binds its identity to that preparation. No commit,
manual checksum, bootstrap, or second assignment message is needed.

Include reasons only when they affect execution, verification, or escalation.
Follow-ups carry the delta, not the prior conversation or a staffing essay.

For example, replace “The user and I discussed the cost of this service and
decided it was worthwhile…” with “Enable private vulnerability reporting for
this repository only.” Retain a consequential reason such as “Keep old URLs
working because installed clients still use them.”

## Result brief

Return one complete final: outcome/status, actual results, verification and
artifact links, concerns, and the next decision if needed. Do not author a
second summary or copy the report into a separate file for delivery.

## Reporting and retirement

After activating its run, the coordinator runs `report route coordinator
--run-id ID --file request.json` before substantive work. The request contains
only `run_id`, `sender_thread_id`, and the initial prompt's `preparation_id`.
Registration derives the remaining mechanics and records same-host
assignment/iteration membership.
The director recipient binding is shared across its assignments. Registration
preserves that exact lineage binding; a fresh coordinator run never substitutes
its sender fence for the recipient fence. Generation one is required only for a
missing registry; an exact existing current generation remains valid.
Use the pinned completion hook to capture complete finals at genuine task idle.
Waits and commentary are not reporting boundaries. Keep the explicit manual
path until the hook is installed, trusted, and live-verified for the exact
sender-recipient mapping; cross-host delivery remains manual.

Routine reports queue without Steer. Queue acceptance is submission evidence,
not actual delivery, verification, or director acceptance. Preserve ambiguous
submissions without replay.

Coordinator reporting belongs to the assignment, including restart requests
and cleanup finals, not just an active execution run. Run-independent commands
use the authenticated package and exact assignment:

- Coordinator: `assignment closeout --assignment-id ID --file request.json`,
  with `{ "assignment_id": "ID", "phase": "coordinator" }`, identifies the
  next eligible child before run closure without retiring coordinator reporting.
- Director: after reviewing the actual final and evidence, `assignment accept
  --assignment-id ID --file request.json`, with `{ "assignment_id": "ID",
  "report_id": "REPORT_ID" }`, records acceptance and identifies remaining
  coordinator closeout.
- Recovery: `assignment status --assignment-id ID` exposes pending work. Resume
  the owning phase with the same identity and, for acceptance, the same report.

Follow the [owning-host archive sequence](host-operations.md) when either command
requests active observation, one exact App action, a host result, or archived
observation. Add only the requested `task_observation` or `host_result` to the
same request. The command determines child-first membership and never asks the
caller to reconstruct a task list.

Accepted members whose exact worktree remains may be reclaimed by these same
commands after fresh archived/no-active evidence. The command revalidates the
persisted iteration authority and uses non-force Git removal; never substitute
a manual worktree deletion or repeat an accepted archive call.

Route retirement follows resolved reporting and required closeout. A pending
iteration stays pending; later assignments cannot inherit its authority.

## Optional advisor

An advisor answers a bounded question. It cannot issue assignments, appoint a
coordinator, or accept work.
