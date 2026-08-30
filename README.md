# Codex Orchestration

Codex Orchestration lets one lead Codex task coordinate multiple separate,
user-visible Codex tasks as one safe repository workflow. A stronger model can
coordinate cheaper or specialized models without making any current model name
part of the product contract.

It preserves intent, dependency and path ownership, model-routing evidence,
task and Git identity, non-interrupting completion, exactly-once disposition,
combined verification, and safe closure across independently running tasks.
Codex App remains the native execution harness; this plugin is a portable
cross-task governance layer above it.

See [Mission and product boundary](docs/mission.md) for the durable charter.

## Current authority

This public repository is the editing authority and remains `UNLICENSED`;
public visibility does not grant an open-source license. The accepted source
release and personal-marketplace package are v0.6.5. A repository may retain
v0.5.1 consumer authority until its own explicit transition is approved and
applied.

The v0.6.5 release retains the v0.6.4 contract, including the Codex App
compatibility fixes from v0.6.1, plugin-only instruction authority, deliberate
model routing, and bounded selector-rejection replanning. It keeps no-change
verification coordinator-owned while checking the persisted executor
worktree, then keeps terminal run audits anchored to coordinator Git authority
after that executor worktree is archived. Archive preparation now distinguishes
ignored generated output from tracked or ordinary untracked source risk.

Editing this checkout never changes an installed plugin or active repository
runtime. An activated v0.6 run snapshots its exact bundle into the repository's
Git common directory, so its authority survives task restart, compaction,
plugin upgrade, and plugin removal. v0.6 does not read, migrate, or delete
retained v0.5 operational state.

### Instruction authority

The installed plugin skills are the sole live instruction authority for v0.6
operation. Ordinary activation and optional tracked adoption neither read nor
write `AGENTS.md`, and they do not create, require, validate, or load a tracked
`INSTRUCTIONS.md`. An adoption preserves only the exact runtime bundle,
configuration, and structured policy for the active run; it is not a second
prompt source.

This does not rewrite history: an accepted v0.5.1 repository can still be
verified read-only and explicitly retired through its isolated legacy contract.
Only that legacy retirement may remove the exact old managed `AGENTS.md` block
it authenticates. It never edits externally attested instructions.

## Layered architecture

```text
GPT models
   |
   v
Codex App native harness
   |  projects, visible tasks, subagents, model selection, worktrees,
   |  messaging, waits, Handoff, archive
   v
Codex Orchestration meta-harness
      workflow DAG, ownership, run/task/Git identity, quiet results,
      urgent interruption policy, dispositions, verification,
      integration, reservation fences, and cleanup proof
```

The plugin consumes native primitives; it does not recreate the task runtime,
worktree manager, project system, model selector, task queue, or archive API.

| Surface | Intended use | Codex Orchestration lifecycle |
| --- | --- | --- |
| Visible Codex task | Independently running, heterogeneous-model work; required for mutating executor lanes | Creation, nonce correlation, Git binding, release, result, disposition, integration/no-change, verification, archive and cleanup proof |
| Native subagent | Bounded read-only research or review attached to the coordinator task | Explicit model/reasoning with bounded `fork_turns`, result classification, unchanged-Git proof and accept/reject disposition only |

Subagents are never a silent fallback for visible tasks. They cannot own writes,
worktrees, branches, callbacks, integration, archive, or cleanup.

## v0.6 operating model

### Progressive run activation

Questions, explanations, audits, and plans are read-only. A repository no
longer needs `.codex/orchestration/` before it can use the v0.6 source. The
currently installed v0.5.1 package still uses its accepted setup gate, and
tracked v0.5 authority must be explicitly retired before v0.6 can activate in
that repository.

When the user authorizes actionable orchestration, the plugin may activate one
run after disclosing:

- the exact package/runtime source and bundle hash;
- the `.git/codex-flow/v0.6.5/` operational state root;
- repository/common-directory, baseline, host, and coordinator binding;
- the immutable workflow revision and its path/resource/branch reservation
  envelope;
- every native task surface, saved project, model/reasoning request, placement,
  and proposed host call; and
- the difference between configured, requested, host-accepted, independently
  observed, and unavailable evidence.

Run activation writes no tracked setup. Every stateful operation names its
exact run ID; no command infers the newest run. One coordinator run may be
active per clone/Git common directory. A normal close requires a current,
content-addressed terminal run audit over all reconciled state. Explicit
abandonment releases the active slot but retains the complete admitted path,
resource, and branch reservation envelope.

### Content-addressed workflow

One stable logical plan groups immutable workflow revisions. Task contracts are
generated from a revision rather than authored independently. Each contract
binds the run, runtime/configuration, repository/common directory, coordinator,
plan/revision, concrete dependency terminal authorities, and baseline.

Each task states:

- the primary outcome;
- a nullable causal question;
- the cheapest safe direct attempt; and
- an instrument role: `none`, `supporting`, or `primary-deliverable`.

A supporting-instrument task must immediately enable its named dependent direct
attempt or pause/replan. After one instrument-only checkpoint, more supporting
instrumentation needs explicit authorization in a later immutable revision.
Only unstarted tasks and edges may change; started or released contracts do not.

### Model routing

The coordinator explicitly selects the executor model and reasoning effort in
the native creation call. Prompt text alone does not configure them. Sol
coordinating Terra is a useful default shape, not a permanent dependency.

Every workflow task also has a bounded `selector_rationale`. It is included in
the immutable revision and task contract, and disclosed alongside the exact
model, reasoning effort, execution surface, and (for a subagent) `fork_turns`.
Use the least capable sufficient lane:

- Luna-medium for mechanical, local, or read-only work with clear acceptance
  criteria.
- Terra-high for a bounded nontrivial implementation or review.
- Terra-xhigh for multi-module root-cause or integration work.
- Sol-high for coordination and systemic decisions; Sol-xhigh or Sol-max needs
  a stated reason.
- Ultra is forbidden for native subagents and exceptional for visible tasks.

The plugin records configuration, request, host acceptance, and independent
observation separately. Accepted-but-unobservable selectors remain partial
evidence; a contradictory observed selector blocks. Native subagents also name
bounded `fork_turns` explicitly. For native subagents, the v0.6 plugin forbids
Ultra and full-history forks: current full-history forks inherit the parent
model/effort and cannot accept the explicit heterogeneous selectors this
contract records. Visible tasks retain the host's supported reasoning range.

### One-shot task identity and release

A visible task contract authorizes exactly one native creation attempt. The
bootstrap prompt contains a cryptographic launch nonce and no objective.
The host's provisional `clientThreadId` is bounded opaque evidence and is
stored verbatim; it is never normalized into an internal identifier.
Provisional and ready task IDs are different identities. The ready task is
accepted only when its initial host-visible user turn contains the exact nonce;
title and timing similarity are never enough.

After project/model/effort/worktree reconciliation, the coordinator binds the
observed pristine worktree at the authenticated baseline. It then prepares one
release, sends its exact prompt at most once, and requires the executor to
accept from that exact persisted worktree and reserved branch using the exact
release, contract, run-bound runtime, and common directory before work.
Ambiguous creation or release fails closed rather than authorizing retry or
substitution.

### Selector rejection and bounded replan

An exact selector rejection before any native identity is a terminal
no-object result, not a retry. A visible task records
`selector-rejected-before-task-identity`; a native subagent records
`selector-rejected-before-agent-identity`. Each consumes its one-shot native
call and creates a `terminal-no-object` workflow claim.

The coordinator may make exactly one ordinary content-addressed child revision
for that same unstarted task. It changes only the model, reasoning effort, and
selector rationale, and receives a new contract and operation; the original
call cannot be replayed. A visible-task branch may be reused only when the
exact predecessor belongs to the same run and task, no task identity exists,
and live Git proof shows that neither its branch nor worktree exists. Any
ambiguity, transport failure, provisional or ready task identity, subagent
identity, post-creation selector mismatch, or missing evidence remains
fail-closed and cannot authorize replanning.

### Quiet results and urgent interrupts

Visible-task routine completion writes one terminal-receipt-v3 result to the
durable Git-common journal. It never direct-messages or Steers the coordinator.
Before persistence, callback admission matches the receipt to the accepted
release, ready task, baseline, and exact selector evidence. A host-unobserved
model remains null; requested or accepted values are never relabeled as
observed evidence.
Native waits and task finals are liveness signals only; they do not authorize
integration. Native subagents complete through their separate operation lane.

A true blocker, approval request, or high-risk drift uses a separate urgent
path. The signal is persisted before one identified direct interrupt attempt.
Ambiguous delivery cannot be replayed blindly, and recipient observation
suppresses duplicate host delivery.

### Visible-task result proof chain

```text
journaled terminal result
          |
          v
coordinator disposition prepared
          |
          v
serial integration or authoritative no-change
          |
          v
content-addressed combined verification at exact repository state
          |
          v
disposition finalized and result consumed exactly once
          |
          v
reconciled task archive, reviewed cleanup plan and branch/worktree proof
```

Task final text, branch names, UI status, and caller-supplied raw digests are
never proof. Git outcome is derived as `unchanged`, `clean-commit`, or
`dirty-blocked`; upstream is nullable. Dirty or attention-needed tasks remain
visible and keep the run from closing. Archive and Git cleanup are separate
actions. v0.6 can derive a deterministic read-only cleanup plan and verify that
refs/worktrees are resolved; it does not apply deletions.

Native subagents use their separate `complete` then `dispose` proof chain with
unchanged-Git evidence. They never enter this callback, integration, archive,
or cleanup lifecycle.

## Use from Codex App

Ask or at-mention the installed Codex Orchestration plugin naturally:

```text
How would Codex Flow split this work across visible tasks?
Use Codex Flow to run these two independent implementation lanes.
Use one Terra task for implementation and one read-only subagent for review.
```

The first request is read-only. An actionable request routes through
`codex-orchestration:coordinate` and can activate a run without permanent
repository setup. External task creation remains visible in the disclosed
plan.

After a clean repository has an active v0.6 run, permanent tracked adoption is
a separate explicit promotion choice for team policy, portable clones, or
headless operation:

```text
Promote this active Codex Flow v0.6 runtime to permanent tracked adoption.
Plan retirement of this repository's tracked v0.6 adoption, but do not apply it.
```

The setup skill uses read-only `adopt plan` followed by an exact reviewed
`adopt apply`, both bound to the named active run. Tracked adoption stores that
run's same runtime/configuration/structured-policy semantics under
`.codex/orchestration/v0.6/`; it is not a second engine or instruction source.
It does not create a tracked `INSTRUCTIONS.md` or touch `AGENTS.md`.
`adopt retire-plan` and `retire-apply` retire only a tracked v0.6 adoption.
Accepted tracked v0.5.1 uses
the separate run-independent `adopt legacy-retire-plan|legacy-retire-apply`
contract. Planning is read-only; applying still requires review of the exact
unchanged plan and leaves the v0.5.1 tag, cache, tasks, Git-common evidence,
branches, and worktrees untouched. It makes no commit and does not activate
v0.6.

## Public CLI families

The v0.6 CLI is pre-release; use `codex-flow --help` for exact flags. Its public
lifecycle is organized around these command families:

```text
run activate|status|resume|rebind|audit|close|abandon
workflow create|revise|status|contract
task create prepare|attempt|reconcile|status
subagent prepare|attempt|reconcile|complete|dispose|status
release prepare|reconcile|accept|status
callback deliver|observe|status
urgent persist|attempt|reconcile|observe|consume|expire|status
disposition prepare|finalize|cancel|status
verification run|status
integration prepare|verification-request|reconcile|status
archive prepare|reconcile|status
cleanup plan
adopt plan|apply|status|retire-plan|retire-apply|legacy-retire-plan|legacy-retire-apply
```

There is no public bare callback-consume command. Consumption is an internal
exactly-once consequence of finalizing an authoritative disposition.
`run audit` derives and persists the complete terminal closure proof;
`run close` accepts only that exact audit while its source records remain
unchanged. `cleanup plan` is read-only; this development boundary exposes no
cleanup-apply command.

## Permanent adoption and headless use

The installed plugin is normal package authority. Its setup skill resolves and
runs the bundled CLI and snapshots exact managed files; users should not supply
a source checkout or manually copy runtime files.

For a headless package invocation, Node.js 20.11 or newer and Git are required.
No third-party npm packages are used. Run `adopt plan` first, review the exact
tracked write set and runtime hashes, then apply only that unchanged plan.

## Pre-release compatibility and retained history

v0.6 is intentionally breaking. It has no v0.5 compatibility reader, dual
execution path, or state migration. Retained v0.5 records remain independently
auditable in their exact namespace. Historical v0.5 schemas, examples, and
field tests are not v0.6 operating authority. Earlier ADRs remain useful
decision evidence where a later ADR supersedes their mechanism.

The accepted v0.5.1 boundary remains documented in
[v0.5.1 orchestration coverage](docs/coverage-v0.5.1.md). The v0.6 development
boundary is summarized in [v0.6 orchestration coverage](docs/coverage-v0.6.md).
[ADR 0015](docs/adr/0015-progressive-run-activation-authority.md) defines
progressive activation and [ADR 0016](docs/adr/0016-content-addressed-workflow-and-native-boundary.md)
defines workflow identity and the native-task boundary.

## Source and distribution

This public GitHub repository is source authority, not a public package channel.
Immutable annotated `v<semver>` tags identify exact commits accepted for
private packages. A tag does not install, publish, refresh the personal
marketplace, or upgrade a pinned consumer runtime. See
[ADR 0012](docs/adr/0012-public-source-private-distribution-and-release-tags.md)
and [ADR 0014](docs/adr/0014-post-release-development-identity.md).

## Development

```bash
npm test
npm run validate
npm run pack:check
```

Source validation checks schemas, skills, package metadata, examples, and
managed runtime files. Release, installation, pilot contact, and cleanup of
retained audit state are separate approval checkpoints.
