---
name: execute
description: Execute one validated, path-bounded Codex task packet and return exactly one strict terminal callback. Use inside an executor thread; do not use to coordinate siblings or broaden ownership.
---

# Execute a Bounded Task

Read and validate the supplied task packet before acting:

```bash
node .codex/orchestration/bin/codex-flow.mjs task start --role executor
node .codex/orchestration/bin/codex-flow.mjs task packet validate <packet.json>
```

Reauthenticate the packet baseline and remain inside its write paths. Preserve
parallel user and sibling changes. Do not acquire undeclared resources, manage
other tasks, weaken verification, or expand scope to keep a run green.
Confirm that the coordinator launched the requested task kind; do not continue
inside a hidden subagent when the packet requires a visible task thread, or the
reverse.

Use direct Steer for a true blocker, approval request, ownership collision, or
high-risk scope/cost drift. On terminal completion, leave a reviewable branch
state and send one bounded schema-v2 receipt with `codex-flow callback deliver`.
Retries retain the same run, sequence, and callback ID. A correction advances
the sequence and explicitly supersedes the earlier unconsumed callback.

Read [Stop policy](../../templates/references/stop-policy.md) when the packet's
authority or boundary is challenged. Receipts must never contain secrets, raw
logs, transcripts, user data, or application/account identifiers.
