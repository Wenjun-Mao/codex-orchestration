# v0.9 task lifecycle

Package authority during development is `v0.9.0-dev.0`. Every run snapshots
that exact runtime and uses it until completion.

```text
workflow contract
      |
task launch prepare
      |
task launch attempt
      |
one Codex App creation call with the full first prompt
      |
creation-result reconciliation <--> executor start claim
      |
task launch start: identity + pristine worktree + branch activation
      |
useful work in the same first turn
      |
terminal-receipt-v4 bound to launch
      |
disposition -> integration/no-change -> combined verification
      |
archive observation -> cleanup plan -> run audit -> close
```

The launch is the durable join between workflow authority, native task
identity, selector evidence, worktree evidence, and the terminal receipt. There
is no bootstrap-only turn, coordinator branch-binding wait, separate release
message, or ordinary private-history scan.

Crash recovery repeats only idempotent local reconciliation. It never repeats
the native creation call, fabricates identity, or weakens a mismatch. Routine
completion stays journal-only; urgent interruption is a separate one-shot
lifecycle.
