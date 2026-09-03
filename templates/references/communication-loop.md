# Communication Loop

Codex Flow separates completion from interruption.

## Routine completion

Persist one strict terminal-receipt-v3 result with `callback deliver`. This is
a quiet Git-common journal write: it must not call direct messaging, Steer, or
create a coordinator turn. An explicit native wait returns liveness to the
waiting coordinator; wait state and task final text are only liveness. The durable journal is the
sole result authority across restart, compaction, or coordinator resumption.

The coordinator uses `callback status` for discovery, authenticates the exact
result, then observes only the result selected for a disposition. There is no
public bare callback-consume operation. Internal exactly-once consumption
occurs only when the authoritative disposition is finalized after integration
or no-change and PASS combined verification. A correction requires a new task
operation/release/result chain; do not overwrite or supersede an observed
result.

## Urgent interruption

A blocker, approval request, or high-risk drift uses `urgent persist`, then
`urgent attempt`. Make only the runtime-generated native direct call and record
it with `urgent reconcile` as `sent`, `rejected-before-send`, or `ambiguous`.
An ambiguous host call never authorizes replay. The recipient uses `urgent
observe` before acting and `urgent consume` afterward, or `urgent expire` when
eligible. Duplicate host delivery is suppressed. Ordinary completion is never
upgraded to urgent merely to get attention.

After coordinator handoff or replacement, rebind the run to the new lineage
generation before processing results. The rebind must be invoked by the
host-exposed current task named by its resume fence; a different coordinator or
executor cannot record the replacement. Stale recipient identity cannot dispose
or integrate work.
