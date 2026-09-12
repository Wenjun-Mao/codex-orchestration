# Relay

Relay 0.2.0 adds `relay:direct` and one-shot advisory notification. A bounded native
test qualified idle-director wakeup, frozen report review and exact worker archival.
Post-retirement successor preparation passed; this was not a fresh successor delivery.
Notifications are not crash-proof and do not replace explicit result acceptance.
See [notification decision](docs/decisions/0003-director-notification.md).
Start new directed work with `relay:direct`; prepared workers use `relay:deliver`.
For explicitly requested resets, its [cheap unplug guidance](skills/direct/references/cheap-unplug.md)
includes finished-task archival, wanted-work integration and obsolete local
branch/worktree cleanup, without historical Flow journal repair.

Relay owns one retained checkout with one current source permission, sequential
executors, direct verification, frozen reporting, and task-only retirement.
Release candidate `f627eef` was packaged and installed as
`0.1.0+codex.20260912163617` for bounded native testing. Same-host journeys qualify
normal three-call startup, ready-ID early binding, failed-check recovery, genuine
Stop capture, shared-storage receipt, separate acceptance, task-only retirement,
and one restart-free candidate transition. Injected tool results and hook events
remain source fixtures. Relay uses no private IPC.

This candidate completed a bounded same-host README-only product pilot and a fresh
no-change successor with six existing tests, genuine report receipt, acceptance,
and task-only retirement for both tasks. Separate-repository
Flow reports also remained available with exact digest attestation after Relay was
installed. These results are observational evidence, not stress testing or same-repo
dual control. Native provisional-ID output has not been observed, and broader
release remains director-owned.

Run the public CLI with Node 20.11 or later:

```sh
node /absolute/path/to/relay/bin/relay.mjs --help
```

Generated commands contain the absolute Node and Relay entrypoint paths, so they
run without installation or command substitution by the agent. The package's bin
name is `relay`; examples below abbreviate the entrypoint with that name. Tests
use disposable repositories and leave them for inspection.

## Same-host quick start

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
5. Commit the scoped result and run the generated `finish` command. The exact
   recipient uses the generated `read-report`, `acknowledge`, `accept` or `reject`,
   and `retire` actions in order.

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

Reporting setup precedes write enablement. Release freezes sender, recipient,
result revision and final correlation. The packaged `Stop` hook supplies
`session_id`, `turn_id`, and exact `last_assistant_message` bytes after source
release. It ignores other repositories, unbound tasks, continued stops, and
unsealed results. The hook reads no transcript file and never calls native tools.
For newly prepared notification-enabled assignments it issues one advisory-only
Stop continuation after capturing the final; repeated events do not reissue it.
The sender sends the generated hint once, records its result and stops. The director
can return idle after binding and resume on that hint to retrieve the frozen report.
Read-only hook discovery never creates `.git/relay`; only an
explicit `prepare` with a valid request contract initializes that namespace after
the Flow exclusion check.
Conflicting event IDs or bytes are rejected.

The exact recipient runs `read-report`. This read-only command returns the frozen
sender, recipient, assignment, result association, event, exact final bytes and
digest directly from Relay's shared repository state. It also generates an explicit
`acknowledge` command bound to the event, final digest and complete association
digest. Reading does not record receipt. Acknowledgement rechecks those frozen facts
and records `transport: "shared-storage"`; `accept` or `reject` remains a separate
semantic decision. Missing hook capture blocks both reading and acknowledgement.

`prepare-receipt` remains available only as optional native completion notification.
Its `wait_threads` observation validates exact task/host/turn/message facts when the
host supplies them, but never records receipt and is not required to retrieve the
report. Null-message, commentary, wrong-turn, error, or conflicting results remain
pending notification state. Neither notification outcome repeats creation, send,
or archive actions.

The older optional message path remains available through sender-only `submit` for
existing source compatibility. It persists one attempt and never returns a second
send request. Because genuine Stop capture occurs after the sender stops, Relay does
not use this path as the normal report flow and does not reactivate or impersonate
the sender to prepare it. Queue acknowledgement remains distinct from receipt.

`retire` generates one exact `set_thread_archived` request after required capture,
receipt and decision. A coordinator task also remains available until every sequential
child whose frozen recipient is that coordinator has an exact receipt and an
affirmatively reconciled task archive. Receipt alone and an ambiguous archive
observation are insufficient because only that coordinator owns the child-retirement
duty. The gate returns the first unresolved child action and does not block
independent source admission. Relay does not assume reports or archive duties can
reach an archived recipient. The same-host journey qualified preserving each
recipient until its duties completed and then archiving only its exact task.
`record-native-result` treats a background archive response as
ambiguous unless it affirmatively names the task as archived. Use the generated
`list_archived_threads` observation action to establish that fact. An ambiguous
outcome remains pending with no retry.
Notification-enabled senders additionally require a fresh exact native idle
observation before the archive action is prepared. Ambiguous/lost notifications
never cause a blind resend; shared report retrieval remains available when the
director resumes. This does not guarantee wake-up across crashes.
No ordinary lifecycle operation deletes source, switches branches, or requires historical HEAD replay.

Pending capture blocks that sender's archive. Current ownership blocks another
writer. Unaccepted work blocks explicitly dependent assignments. Independent work
may proceed at the approved clean checkpoint while old reports/archive observations
are outstanding. Status reads the current permission and the requested record; it
does not reverify old results against the advancing checkout.

## Recovery

`status` returns the exact current recovery ticket when applicable. Recovery belongs
to the creating authority and never guesses that an agent or background tool stopped.
For a never-enabled reservation, use a resolution file containing
`{"kind":"revoke-never-enabled"}`. Late binding is retained as an orphan-task
obligation; late starts are rejected. A known revoked task can report its failure
and retire after exact receipt.

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
dependencies or Flow imports, and test harnesses are not shipped. The native source
adapter interface uses `record-native-result`, the packaged Stop hook,
`read-report`, `acknowledge`, optional `prepare-receipt` notification, legacy
sender-only `submit`, and task retirement. Low-level injected
operations remain available for deterministic source tests only.

See [source contracts](docs/decisions/0001-source-contract.md), the
[native adapter decision](docs/decisions/0002-native-adapter.md), the
[current host capability record](docs/native-capability-2026-09-12.md), the
[director-owned disposable journey](docs/native-disposable-journey.md), and
[remaining acceptance gates](docs/acceptance.md). Corrected native startup used the
three intended protocol calls and reached READY 22.374 seconds after preparation.
Conservative same-nine-component accounting is 6,106 `o200k_base` proxy tokens,
down from 8,974 but 106 tokens above the provisional 6,000 target. This is a target
miss, not a PASS or exact billing measurement. The bounded README-only product pilot
and retained-project no-change successor passed; adding token-accounting machinery
for the 106-token gap is not the next useful product check.
Actual ready-ID early binding is qualified, while provisional-ID reconciliation is
source-tested only because the host did not produce a provisional ID. Existing
separate-repository Flow reports remained intact and readable after Relay install;
stress and same-repository coexistence are not claimed. Shared-storage receipt is
qualified only as same-host delivery, not native message delivery or broad release
readiness.
