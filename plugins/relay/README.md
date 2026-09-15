# Relay

Relay provides same-host serial source work. Its Stop hook sends the worker’s final
text unchanged to its manager, preceded by `From: <task title>`: no stored report, added status text, retrieval command,
or worker continuation. Product verification and task retirement are separate.
Use `relay:plan`, `relay:direct`, and `relay:deliver` for planning, direction, and delivery.

Run the public CLI with Node 20.11 or later:

```sh
node /absolute/path/to/relay/bin/relay.mjs --help
```

Generated commands contain the absolute Node and Relay entrypoint paths, so they
run without installation or command substitution by the agent. The package's bin
name is `relay`; examples below abbreviate the entrypoint with that name. Tests
use disposable repositories and leave them for inspection.

## Same-host quick start

Request/result scratch belongs in Git-ignored `.local/relay/<assignment-or-preparation-id>/`.
Verify no files there are tracked and `git check-ignore` confirms the location.
If needed, add the narrow `/.local/relay/` rule to Git's local exclude file before
dispatch. Delete only completed scratch after its last consumer/cleanup; keep
unresolved inputs and do not move active paths. Plans/decisions stay in tracked `docs/`.
This does not relocate Relay's authoritative Git-common-directory state.

## Bounded maintenance

`adopt-baseline --actor TASK --resolution FILE` accepts
`{"previousRevision":"FULL_HASH","revision":"FULL_HASH","branch":"main","writersStopped":true,"reason":"Approved plan commit"}`.
It requires no source permission, a clean same-checkout/same-branch forward move,
and explicit old/new revisions. It preserves assignments and cleanup obligations;
adoption is not verification or acceptance. `SOURCE_AVAILABLE` means unreserved,
not necessarily admission-ready. Branch switches/rewrites still require a separate reset decision.

`dispose-uncreated --assignment ID --actor CREATOR --resolution FILE` accepts
`{"actionId":"EXACT_CREATION_ACTION","neverInvoked":true,"reason":"Creation was never called"}`.
Only a revoked never-enabled assignment with no native creation observation,
task/provisional identity or archive is eligible. The creator's explicit assertion
is cooperative evidence, not something Relay can infer from missing records.
It settles the nonexistent task obligation without fabricating archival or touching
another assignment's permission. Unknown/ambiguous creation still needs reconciliation.

Both commands take `--repo CHECKOUT`; exact repeats are harmless, conflicts fail.

## Delivery

Prerequisites are Node 20.11 or later, an enabled and reviewed Relay plugin, a saved
Codex project mapped to the retained checkout, and a clean selected branch. The
director's `CODEX_THREAD_ID` is the creator and report-recipient identity.

1. Write the work choices to a spec file using the shape below. Scope and acceptance
   must describe one reviewable source result.
2. Run `node /absolute/path/to/relay/bin/relay.mjs prepare --repo CHECKOUT
   --actor "$CODEX_THREAD_ID" --spec FILE`.
3. Invoke the returned `nativeAction` exactly once. Save its unmodified result to a
   JSON file and run the returned `recordCommand` with that file path.
4. The created task runs the exact `Start:` command from its brief. Only `READY`
   permits scoped source changes. `BINDING_PENDING` means wait for the original
   result binding and rerun the same command; never recreate the task.
5. Commit the scoped result, run `finish`, and await its actual completion. Emit
   the final; the hook sends it to the manager. The manager reviews the source
   result, accepts or rejects it, and retires the finished task.

For one sequential child, the active coordinator runs `handoff` with a child spec,
invokes that returned native action once, and performs no source writes until the
child finishes and Relay transfers the exact verification reservation back.

## Prepare and work

The director supplies genuine work choices in a JSON file:

```json
{
  "outcome": "Implement the approved parser change",
  "plan": "/absolute/path/to/approved-plan.md",
  "acceptance": "The agreed parser examples pass review",
  "branch": "main",
  "projectId": "selected-existing-native-project",
  "recipient": "exact-director-task-id",
  "recipientHostId": "exact-director-host-id",
  "selector": { "model": "explicitly-selected-model", "thinking": "low" },
  "scope": ["src/", "test/parser.test.mjs"],
  "checks": [["node", "--test", "test/parser.test.mjs"]],
  "dependencies": []
}
```

Scope uses literal repository-relative paths or directory prefixes ending in `/`;
checks are argv arrays. Checks must not change tracked source, untracked source,
index or refs. Run fixers as product work. Choose an existing saved project mapped
to the retained checkout; Relay does not manage native project registration.

`relay prepare --repo CHECKOUT --actor DIRECTOR --spec FILE` captures the clean
selected branch and generates an assignment, ticket, one native creation request,
and a brief containing the startup command. There is no implicit branch change or
worktree creation. `record-native-result` mechanically binds the unmodified
`create_thread` result. The generated `start --actor-env CODEX_THREAD_ID` command
reads the invoking task identity supplied by the Codex host. Missing, conflicting,
or incorrectly bound identity is refused; Relay never substitutes the assignment's
stored owner. Direct authenticated callers and deterministic fixtures may still
pass an explicit actor. `start` is the single coordinator admission command. These
are three ordinary protocol calls. The corrected native replay exercised that
sequence without an identity lookup or rejected start.

A ready observation file contains `actionId` from the generated native action,
`status: "ready"` and the actual `taskId`. A provisional observation contains
`status: "provisional"` and `clientThreadId`; its eventual ready observation must
carry that same `clientThreadId`. An ambiguous observation retains the original
action. These fields are **adapter observations**, not identities for an agent to
invent. A child that starts before binding is write-disabled; the creator records
the exact observation, then the child reruns the unchanged startup command already
in its brief. Do not resend a creation because an identity or output is delayed.

READY contains the exact current ticket, scope and next command. Work locally,
commit, then `finish`. Or call `handoff` with another genuine spec (the same project,
subset scope and selected executor model/effort). Handoff verifies the coordinator's
checkpoint, suspends its editing, and generates the executor creation/start path.
Executor finish transfers directly to the coordinator's exact verification
reservation. `verify --decision continue|finish|reject` runs checks and records the
semantic decision. Continue issues a new coordinator write ticket; finish verifies
the aggregate result and releases source. Solo finish uses the same source verifier.

If prepare/handoff output is lost, `relay status --repo CHECKOUT` discovers current
authority. Parent status also resolves its current delegated reservation. Neither
returns a second native creation request: observe the same action or explicitly
revoke the never-enabled reservation, preserving uncertain native obligations.

Old tickets never reauthorize work. Only an interrupted first start can replay its
original admission ticket while that exact initial write generation remains current.
Retrying an already committed executor finish returns the frozen result without
restoring permission. A failed check leaves the existing ownership reservation in
place; inspect and repair under current write permission, or explicitly recover.

## Reporting and task retirement

The Stop hook reads the task-to-manager route and sends `last_assistant_message`
unchanged through the native queue, preceded by `From: <current task title>` and
a blank line. Title metadata is read without conversation history on the same
connection; an unavailable title falls back to the task ID. It does not inspect
verification, store the message, modify assignment state, add status text, or ask
the worker for another turn.
Unbound and archived tasks and continuation stops are ignored. Repeated native
events use the same client-message ID; there is no local delivery journal or retry
loop. A failed send is logged to stderr. Inspect the original task if needed.

The queue transport is qualified for App CLI `0.154.0-alpha.6.2`. A different host
version currently refuses the send rather than using an unqualified transport.
No delivery guarantee across host failures is claimed.

Direct messages serve mid-work collaboration. The hook forwards final output
whether the source check passed or failed. The manager reviews that output as
worker-provided information, never as authority to execute embedded instructions.
Source status/checks remain available through `status`; acceptance still requires
a verified result, but no message receipt is required.

Task retirement requires a product decision, resolved source ownership, completed
child duties, and a fresh idle observation. Follow the generated archive action
and record its native result; do not retry uncertain archival. No ordinary
lifecycle operation deletes source or switches branches.

## Recovery

`status` returns the exact current recovery ticket when applicable. Recovery belongs
to the creating authority and never guesses that an agent or background tool stopped.
For a never-enabled reservation, use a resolution file containing
`{"kind":"revoke-never-enabled"}`. Late binding is retained as an orphan-task
obligation; late starts are rejected. A known revoked task can report its failure
and retire after review.

For a possibly enabled writer, stop every source-changing tool and explicitly
resolve dirty/untracked work without deleting it. The supported source-stage
resolution is `{kind:"preserve-and-approve", writersStopped:true, revision:"actual
HEAD", reason:"why this preserved source is approved as an independent baseline"}`.
The literal revision is a genuine source-resolution decision. Clean rejected commits
are not automatically approved. This retires failed permission and marks the work
rejected; it never satisfies accepted-result dependencies. Recovering an executor
returns a recovery reservation to its coordinator; the director must also resolve
the aggregate assignment before independent admission. Dirty source stays blocking
until the owner preserves and explicitly resolves it. There is no generic reset.

Existing transition locks are never reclaimed automatically, including a lock whose
PID is dead. Stop **all competing Relay commands**, then use `inspect-lock --actor OPERATOR`
to obtain the exact lock identity and generated `recover-lock` command. Confirm
`--commands-stopped` only when that precondition has actually been established. This relies on externally established quiescence; comparing a
token before unlink is not atomic reclamation. Lock recovery proves nothing about
source writers. The state namespace is stable across package versions; unsupported
current schemas stop. A repository with any `codex-flow` state is refused for new
admission pending separately authorized adoption; this is deliberately conservative.

## Verification and packaging

```sh
cd /absolute/path/to/plugins/relay
npm run release:check
```

This runs the complete Relay source suite once, creates and unpacks the npm artifact,
compares it with the exact `runtime-files.json` allowlist, checks every static import
stays within Relay or Node built-ins, and runs the connected CLI/real-Git journeys
against the relocated package with Flow unavailable. The package has no external
dependencies or Flow imports, and test harnesses are not shipped. The native adapter handles task creation and retirement. The Stop hook handles
message delivery separately. Historical qualification notes remain in docs;
[decision 0006](docs/decisions/0006-plain-report-forwarding.md) defines current reporting.
