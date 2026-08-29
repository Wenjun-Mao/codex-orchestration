# Communication Loop

Codex Flow separates completion from interruption.

## Routine completion

Persist one strict terminal-receipt-v3 result with `callback deliver`. This is
a quiet Git-common journal write: it must not call direct messaging, Steer, or
create a coordinator turn. Native waits may wake an active coordinator, but
wait state and task final text are only liveness. The durable journal is the
sole result authority across restart, compaction, or coordinator resumption.

The coordinator uses `callback status` for discovery, authenticates the exact
result, then observes only the result selected for a disposition. There is no
public bare callback-consume operation. Internal exactly-once consumption
occurs only when the authoritative disposition is finalized after integration
or no-change and PASS combined verification. A correction requires a new task
operation/release/result chain; do not overwrite or supersede an observed
result.

## Urgent interruption

A blocker, approval request, or high-risk drift is persisted before one
identified direct-delivery attempt. Use only the runtime-generated envelope,
then reconcile `sent`, `rejected-before-send`, or `ambiguous`. An ambiguous
host call never authorizes replay. The recipient observes the persisted IDs
before acting and suppresses duplicate host delivery. Ordinary completion is
never upgraded to urgent merely to get attention.

After coordinator handoff or replacement, rebind the run to the new lineage
generation before processing results. Stale recipient identity cannot dispose
or integrate work.
