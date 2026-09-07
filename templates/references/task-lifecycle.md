# Task lifecycle

Use the exact installed package authority snapshotted for the run.

```text
workflow contract
  -> launch prepare -> attempt -> one native creation with the full first prompt
  -> host result reconciliation / executor start claim
  -> task launch start -> useful work in the same turn
  -> terminal-receipt-v4 -> disposition
  -> integration or no-change -> verification -> finalization/closeout
  -> current run audit -> normal close
```

The launch joins contract, task identity, selector, and worktree evidence.
Recover only idempotent local transitions; never repeat an ambiguous host call.
Assignment reporting outlives run closure until final acceptance and closeout.
