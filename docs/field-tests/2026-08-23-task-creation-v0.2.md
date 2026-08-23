# Task-creation host field test

- Date: 2026-08-23
- Host: local Codex Desktop
- Scope: one controlled projectless user-visible task thread
- Requested configuration: `gpt-5.6-terra`, `xhigh`
- Operation: `task-operation-v1-642a3ac3e5ecda84746c29a9872ad2755880d38c70d5699a05261ab07cea7524`
- Result: PASS for task creation and reconciliation only

The operation was persisted and marked dispatching before the host call. The
host returned one thread ID. The adapter set the exact requested title, found
the object in the user-visible thread list, read the exact thread, observed its
single `HOST_ADAPTER_PROBE_OK` response, and reconciled ID/title/kind/visibility
before archiving it. The probe was projectless and instructed to perform no
filesystem, app, browser, account, or network work.

One host compatibility issue was observed: the callable metadata advertised a
`query` argument for thread listing, but this host rejected that argument at
runtime. Creation was not retried. Inspection continued through an unfiltered
bounded list and exact-ID read.

This does not validate project-scoped worktree creation, compaction/resume/fork
instruction retention, callback transport, archive timeout recovery, or task
deletion. Those remain separate host acceptance gates.
