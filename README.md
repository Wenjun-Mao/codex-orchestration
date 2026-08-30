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
public visibility does not grant an open-source license. v0.7 is the sole
current package, runtime, schema, skill, and operational-state authority.
Earlier releases remain source-history and immutable-tag evidence only; their
readers, mutators, migration paths, retirement commands, tracked adoption, and
test fixtures are not packaged in v0.7.

v0.7 carries forward the proven cross-task behavior from v0.6.5 under new
`codex-flow-v07-*` identities and the exact `.git/codex-flow/v0.7.0/`
namespace. It adds a bounded foreign-active-run sentinel so a live predecessor
run blocks admission instead of being silently ignored or migrated.

Editing this checkout never changes an installed plugin or active repository
runtime. An activated v0.7 run snapshots its exact bundle into the repository's
Git common directory, so its authority survives task restart, compaction,
plugin upgrade, and plugin removal. Apart from the bounded lifecycle sentinel,
v0.7 does not read, import, migrate, retire, or delete predecessor operational
state.

### Instruction authority

The installed plugin skills are the sole live instruction authority for v0.7
operation. Activation never reads or writes `AGENTS.md`, and v0.7 creates,
requires, validates, or loads neither tracked orchestration instructions nor a
tracked adoption. Repository-local instructions remain the repository's own
authority, not plugin-managed state.

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

## v0.7 operating model

### Progressive run activation

Questions, explanations, audits, and plans are read-only. A repository needs
no `.codex/orchestration/` setup before it can use v0.7. Actionable activation
fails closed if the bounded sibling-namespace sentinel finds another active
Codex Flow run; that run must be completed or abandoned under its own runtime
before v0.7 starts.

When the user authorizes actionable orchestration, the plugin may activate one
run after disclosing:

- the exact package/runtime source and bundle hash;
- the `.git/codex-flow/v0.7.0/` operational state root;
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
bounded `fork_turns` explicitly. For native subagents, the v0.7 plugin forbids
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
actions. v0.7 can derive a deterministic read-only cleanup plan and verify that
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

## Public CLI families

Use `codex-flow --help` for exact flags. The v0.7 public
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
```

There is no public bare callback-consume command. Consumption is an internal
exactly-once consequence of finalizing an authoritative disposition.
`run audit` derives and persists the complete terminal closure proof;
`run close` accepts only that exact audit while its source records remain
unchanged. `cleanup plan` is read-only; this development boundary exposes no
cleanup-apply command.

## Package execution

The installed plugin is normal package authority. Run-scoped activation
snapshots the exact bundled runtime into Git-common state; users should not
supply a source checkout or manually copy runtime files. A headless package
invocation requires Node.js 20.11 or newer and Git. No third-party npm packages
are used, and no tracked setup or adoption command exists.

## Pre-release compatibility and retained history

v0.7 is intentionally breaking. It has no predecessor compatibility reader,
dual execution path, operational-state migration, retirement command, or
tracked adoption. Predecessor state remains outside v0.7 authority; immutable
source tags and Git history remain the audit route. Earlier ADRs remain useful
decision evidence where a later ADR supersedes their mechanism.

The current boundary is summarized in
[v0.7 orchestration coverage](docs/coverage-v0.7.md).
[ADR 0015](docs/adr/0015-progressive-run-activation-authority.md) defines
progressive activation and [ADR 0016](docs/adr/0016-content-addressed-workflow-and-native-boundary.md)
defines workflow identity and the native-task boundary. [ADR 0029](docs/adr/0029-v070-clean-authority-cutover.md)
defines the clean predecessor-free package cutover.

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

Source validation checks current schemas, skills, package metadata, examples,
and runtime files. Release, installation, pilot contact, and deletion of
retained local operational state remain separate approval checkpoints.
