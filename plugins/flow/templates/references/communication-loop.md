# Communication loop

## Routine completion

Executors persist terminal receipts in the quiet journal. Hooks capture the
complete final at task idle for its registered upstream route. Native waits
are liveness signals; `wait_threads` is active work, not a reporting boundary.

Queue acceptance proves only transport submission. Actual delivery, review,
and acceptance remain distinct. Use the
[reporting contract](assignment-and-reporting.md) for route lifetime and
unavailable or ambiguous delivery.

## Urgent interruption

Interrupt only when delaying a blocker, approval need, ownership collision,
or high-risk drift would materially endanger the work. Use `urgent persist`,
`urgent attempt`, the returned native call once, and `urgent reconcile`.
Never retry an ambiguous delivery.
