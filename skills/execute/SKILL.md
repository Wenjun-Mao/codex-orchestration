---
name: execute
description: Execute one accepted, generated Codex Flow visible-task contract and persist one strict terminal result. Use inside a released executor task; do not coordinate siblings, broaden ownership, or use this workflow inside a native subagent.
---

# Execute a Generated Task Contract

Use the exact v0.6 runtime named by the release and include its `run_id` in
every stateful command.

If the first turn contains only a launch nonce bootstrap, do no repository
work. Wait until the coordinator sends the generated contract, then use
`release accept` to authenticate the exact ready task ID, release ID, contract
ID, runtime/configuration, Git common directory, coordinator
binding, and bound worktree. Do not act on an unreleased or ambiguous prompt.
If the executing bundle differs from the run-bound snapshot, use the single
exact recovery command printed by `release accept`; it preserves the same
request while switching to the authenticated content-addressed CLI.

Remain inside the contract's objective, dependency state, read/write paths,
resources, baseline, and verification scope. Preserve sibling and user changes.
Follow the task's progress contract:

- attempt the named cheapest safe direct action;
- if instrumentation is `supporting`, return the one bounded instrument
  checkpoint that enables its named direct follow-up, then stop; and
- do not add another supporting-instrument cycle without a later workflow
  revision that explicitly authorizes it.

For a blocker, approval request, ownership collision, or high-risk drift,
use `urgent persist`, then `urgent attempt`, make only the returned native
direct call, and record its outcome with `urgent reconcile`. Never send raw or
identity-less urgent content and never replay an ambiguous attempt.

At terminal state, derive Git outcome mechanically as `unchanged`,
`clean-commit`, or `dirty-blocked`; an upstream may be null. Persist exactly
one terminal-receipt-v3 result with `callback deliver`. Ordinary completion
must not call direct messaging or Steer. Do not treat the task's final text as
the receipt or hand-author hashes that the runtime derives. Copy model evidence
from the release and creation records exactly: when the host did not expose a
complete observed model/effort pair, keep `observed` null rather than inferring
it from configured, requested, or accepted selectors.

Read [Stop policy](../../templates/references/stop-policy.md) when authority or
scope changes. Results must exclude secrets, raw logs/transcripts, user data,
and account or application identifiers.
