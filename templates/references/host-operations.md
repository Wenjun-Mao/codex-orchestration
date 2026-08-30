# One-Shot Host Operations

The runtime persists intent and reconciliation; Codex App performs native task,
worktree, message, wait, Handoff, and archive operations. Keep each host call
bounded and separate requested, accepted, and observed evidence.

## Visible task creation and release

1. Authenticate the generated visible-task contract, concrete baseline, saved
   project, requested model/reasoning and selector rationale, placement, and
   unclaimed executor branch.
2. Prepare and start exactly one creation attempt. Use the generated bootstrap
   prompt, which contains a cryptographic launch nonce but no objective.
3. Make one native creation call with the actual project, model, reasoning, and
   starting-state selectors. Prompt text does not configure selectors.
4. If the host returns `clientThreadId`, record it only as provisional. Recover
   a ready task ID through the bounded host surface, then read its initial
   host-visible user turn. The exact nonce, role, turn position, and ready task
   ID must match. Title, recency, and timing are never correlation authority.
5. Reconcile requested, host-accepted, and independently observed project,
   model, reasoning, visibility, and worktree evidence. A non-null observed
   mismatch or missing nonce is ambiguous and blocks release.
6. Bind the host-observed pristine worktree in the same clone/common directory
   at the exact baseline and claim only the contract's branch.
7. Prepare release, send its exact prompt at most once, and reconcile the host
   call. Require the executor to accept the exact release, contract, runtime,
   common directory, and ready task before implementation.

A timeout is ambiguous. Inspect state through the bounded reconciliation window
but never issue a second create or blind release resend for the same contract.
A session/control failure is durable evidence, not permission to substitute a
subagent or local task.

An exact host rejection of the requested selector before any provisional or
ready identity, accepted selector evidence, or observed host object exists is
terminal-no-object evidence. It consumes the one-shot create call. Do not retry
or silently substitute a selector; only a new content-addressed workflow
revision may issue a replacement contract.

## Wait, urgent delivery, and archive

Use native waits for efficient liveness only and carry their cursors. Every
wake returns to the durable callback journal.

For urgent delivery, persist first, make the single permitted direct call, and
reconcile its observed result. Do not send a raw summary outside the identified
envelope.

Archive is also a prepared/reconciled host operation. Automatic archive is
eligible only after accepted terminal disposition, integration or no-change
proof, authoritative PASS combined verification, internal callback
consumption, and managed-worktree reconciliation. The worktree path comes from
the persisted creation record, never caller input. Preserve ambiguous archive
state and leave blocked/attention-needed tasks visible.
