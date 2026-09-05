---
name: execute
description: Start and execute one generated Codex Flow visible-task contract from its first prompt, then persist one strict terminal result. Use only inside that executor task.
---

# Execute a First-Turn Assignment

The initial user prompt contains the full contract, launch ID, nonce, and exact
`task launch start` command. Run that command before inspecting or mutating
source. It authenticates `CODEX_THREAD_ID`, the run-bound runtime, contract,
nonce, Git common directory, pristine baseline, non-coordinator worktree, and
reserved branch. If it cannot complete, stop with its exact blocker. There is
no release message to wait for.

After start succeeds, begin the assignment in the same first turn. Stay within
the contract's objective, dependencies, paths, resources, baseline, and
verification scope. Preserve user and sibling work. Attempt the cheapest safe
direct action. A supporting instrument returns one checkpoint that enables its
named follow-up; more supporting instrumentation requires a later authorized
workflow revision.

Own only the assigned implementation and evidence. Do not appoint a
coordinator, direct sibling work, change acceptance, or broaden scope. Use the
assignment's reporting recipient/path and return actual results and evidence,
not a separately authored second summary.

Use the immutable run-bound runtime for every stateful command. An App restart
or coordinator refresh does not hot-switch this executor.

For an urgent blocker, approval request, ownership collision, or high-risk
drift, persist and prepare one identified urgent interrupt, make only that
native call, and reconcile it. Routine terminal completion never messages or
Steers the coordinator.

At terminal state, derive Git outcome mechanically as `unchanged`,
`clean-commit`, or `dirty-blocked`; null upstream is valid. Persist exactly one
terminal-receipt-v4 with `callback deliver`, binding `launch_id`. Copy selector
evidence exactly and leave unavailable observation null. Final prose is
liveness only, not result authority, and receipt delivery is not acceptance.
