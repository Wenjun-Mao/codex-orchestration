# Relay

Relay owns one retained checkout with one current source permission, sequential
executors, direct verification, frozen reporting, and task-only retirement.
This 0.1.0 candidate implements the **source contract only**. It has no installed
hook, private native IPC, or qualified native transport. Injected events are test
inputs, not proof that a real task was created, delivered a final, or archived.

Run the public CLI with Node 20.11 or later:

```sh
node /absolute/path/to/relay/bin/relay.mjs --help
```

Generated commands contain the absolute Node and Relay entrypoint paths, so they
run without installation or command substitution by the agent. The package's bin
name is `relay`; examples below abbreviate the entrypoint with that name. Tests
use disposable repositories and leave them for inspection.

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
worktree creation. `record-native` binds the actual creation result; `start` is the
single coordinator admission command. These are three ordinary protocol calls;
that count is an interface property, not a measured native startup budget.

A ready observation file contains `actionId` from the generated native action,
`status: "ready"` and the actual `taskId`. A provisional observation contains
`status: "provisional"` and `clientThreadId`; its eventual ready observation must
carry that same `clientThreadId`. An ambiguous observation retains the original
action. These fields are **adapter observations**, not identities for an agent to
invent. A child that starts before binding is write-disabled; the creator records
the exact observation and supplies the returned resume command. Do not resend a
creation because an identity or output is delayed.

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
result revision and final correlation. A qualified future native adapter must
supply actual final event bytes to `capture`; the source-stage event shape is
`{sender, correlation, eventId, text}`. The CLI rejects conflicting bytes/events.
`capture` produces the exact report envelope. `submit` durably records an attempt
before returning one request. Retrying returns an observation action, never a
second send request. `observe-report` takes `{submissionId, status}` where status
is `queued` or `ambiguous`. Queue acceptance never implies receipt.

The recipient supplies the actually received envelope to `receive`, optionally
with `--decision accepted|rejected`. Receipt alone is supported; `accept` and
`reject` are independent semantic decisions. Executor verification may already
have recorded its product decision; receipt must agree with that immutable decision.
`retire` generates one exact task archive request after required capture, receipt
and decision. A coordinator task also remains available until every sequential
child whose frozen recipient is that coordinator has an exact receipt. The gate
returns the first unresolved child action and does not block independent source
admission. Relay does not assume reports can reach an archived recipient; qualifying
that native behavior remains outside this source candidate. Record
`{kind:"archive", actionId, taskId, status:"archived"}` only
from affirmative observation. An ambiguous outcome remains pending with no retry.
No operation deletes source, switches branches, or requires historical HEAD replay.

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
npm test
npm run pack:check
```

The package has no external dependencies and no Flow imports. `runtime-files.json`
is the exact packed file allowlist. Pack verification creates/unpacks an archive
outside this repository, checks every static runtime import stays within Relay or
Node built-ins, and runs the connected CLI/real-Git journeys against the relocated
package with Flow unavailable. Test harnesses are not shipped. The native source
adapter interface is public `record-native`, `capture`, `submit`, `observe-report`
and `receive`; fixtures invoke those same operations. There is no synthetic hook.

See [source contracts](docs/decisions/0001-source-contract.md) and
[remaining acceptance gates](docs/acceptance.md). Startup tokens/elapsed time,
actual native identity correlation, authentic final capture, recipient delivery,
archive observation, separate-repository Flow coexistence, installation and the
controlled pilot remain unmeasured/unqualified. Source completion is not release
readiness. This package must not control its own initial development.
