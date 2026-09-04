# One-Shot Host Operations

The runtime persists intent and reconciliation; Codex App performs native task,
worktree, message, wait, Handoff, and archive operations. Keep each host call
bounded and separate requested, accepted, and observed evidence.

## Visible task creation and release

1. Authenticate the generated visible-task contract, concrete baseline, saved
   project, requested model/reasoning and selector rationale, placement, and
   unclaimed executor branch.
2. Prepare and start exactly one creation attempt. Use the generated bootstrap
   prompt, which contains a cryptographic launch nonce but no objective. The
   runtime owns the prepare, attempt, reconciliation, and binding timestamps;
   do not supply lifecycle clock fields in task-create requests. Preserve host
   event timestamps only as host evidence.
3. Make one native creation call with the actual project, model, reasoning, and
   starting-state selectors. Prompt text does not configure selectors.
4. If the host returns `clientThreadId`, record it only as provisional. Prefer
   an official bounded host resolver. While the current App exposes no such
   resolver, `task create resolve-private` is the explicit temporary adapter:
   it reads the exact local App binding and matching task session without
   changing either, requires the App's forward and reverse ID mappings to
   agree, and authenticates the exact bootstrap inside the initial
   `create_thread` delegation. It returns a complete ready-reconciliation
   request with private-host provenance. Never invoke it silently. It may
   resolve an open provisional record or the exact window-expiry ambiguity; in
   the latter case, source evidence may authenticate a provisional identity
   that was not yet journaled, together with accepted selectors and ready
   identity. The source `create_thread` completion, initial delegation, and
   observed-selector event timestamps must be inside the reconciliation window;
   later private-evidence processing does not alter those host facts. The source
   event may authenticate the provisional identity and accepted selectors
   atomically. The adapter only reads evidence: it never creates or retries.
   Missing, malformed, duplicate, or contradictory private evidence remains
   unresolved ambiguity. Title, recency, and timing are never correlation
   authority. v0.8.2/v0.8.3 also recognizes the App's `mcp_tool_call_end` completion
   shape and streams bounded multi-GiB coordinator histories without retaining
   raw session rows. Its exact-v0.8.1 recovery bridge may emit evidence for an
   older active run, but only that run's immutable snapshot may reconcile it.
5. Reconcile requested, host-accepted, and independently observed project,
   model, reasoning, visibility, and worktree evidence. A non-null observed
   mismatch or missing nonce is ambiguous and blocks release.
6. Run coordinator-owned `task create bind`. Persist its content-addressed
   path/common-directory/branch/baseline intent before attaching the detached
   pristine worktree to the reserved branch; only exact receipt-backed replay
   may recover an already attached branch. Reject the active runtime
   coordinator root as the executor path and timestamp recovered completion at
   the recovery command, never at the earlier prepared intent.
7. Prepare release only after live reauthentication of completed binding, send
   its exact prompt at most once, and reconcile the host
   call. Require the executor to accept the exact release, contract, runtime,
   common directory, and ready task before implementation.

At the deadline, an unresolved operation durably becomes exact
`reconciliation-window-expired` ambiguity. Only that terminal outcome may
recover, only through the explicit private adapter, and only from authenticated
host events recorded strictly before the deadline. Recovery retains the expiry
resolution and adds a digest-bound recovery record to the same operation and
attempt. It never permits a second create or blind release resend for the same
contract. Every other terminal outcome remains closed. A session/control
failure is durable evidence, not permission to substitute a subagent or local
task.

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
state and leave blocked/attention-needed tasks visible. When the public
archived-task index lags, `archive observe-private` emits a digest-bound proof
for the exact archived session and absent active counterpart; reconcile that
result without bypassing managed-worktree reclamation.
