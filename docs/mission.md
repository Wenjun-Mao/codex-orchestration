# Mission and product boundary

- Status: accepted
- Last reviewed: 2026-09-05 for the v0.9 role and reporting boundary
- Scope: durable product purpose and feature boundary

This charter defines why Codex Orchestration exists and how proposed features
are evaluated. ADRs remain authoritative for particular mechanism and contract
decisions.

## Mission

Codex Orchestration lets a director retain goals, strategic conversation,
tradeoffs, and acceptance while a coordinator owns bounded delivery,
delegation, integration, and verification and executors own scoped work and
evidence. It preserves delegation intent, dependencies, ownership, task and Git
identity, non-disruptive result delivery, and exactly-once integration while
leaving native execution, model selection, and host-managed worktrees to Codex.

The mission is model-flexible. Current selector choices are explicit operating
preferences, not permanent dependencies or empirical optima. Future director,
coordinator, or executor models should fit the same contracts when supported.

## Problem this solves

Depending on the available surface, a Codex host may execute tasks, select
models and reasoning effort, provision managed worktrees, exchange messages,
wait, hand off, and archive. Those native primitives do not by themselves
establish one durable repository workflow across independently running tasks.

Without an orchestration boundary:

- a routine executor-task message may Steer and interrupt a working coordinator;
- a result may not be provably connected to the plan and task that authorized
  it;
- parallel tasks may claim overlapping files or shared resources;
- transient task text may be mistaken for integration authority;
- branches, worktrees, results, and cleanup decisions may lose their common
  provenance; and
- the same result may be handled more than once after replay, interruption, or
  coordinator resumption.

Codex Orchestration supplies that missing cross-task governance without
becoming another task runtime.

## North-star workflow

```text
Lead task authenticates one repository outcome
                    |
                    v
     Validated dependency and ownership plan
                    |
          +---------+---------+
          |                   |
          v                   v
Executor task A    Executor task B
          |                   |
          +---------+---------+
                    |
       +------------+------------+
       |                         |
       v                         v
routine completion         urgent blocker
durable, quiet queue       journaled interrupt
       |                         |
       +------------+------------+
                    |
                    v
      Lead reviews each result and integrates accepted work once
                    |
                    v
       Combined verification and safe cleanup
```

## Product promises

### Coordinator continuity

Routine completion must not inject a new turn into a coordinator that is doing
other work. It enters a durable logical queue and remains available across
interruption, compaction, or restart until an authorized terminal disposition.
The coordinator selects it only at a safe boundary; accepted results are
consumed only after authentication and review.

Each repository declares exactly one ordinary-completion authority. Native
waits, task-final events, and notification adapters may provide liveness, but
they do not become competing integration authorities.

A working manual or explicit result-collection path remains in place until a
replacement is installed and trusted, where applicable, and verified for the
exact sender-recipient mapping through a live test. Automated full-final
reporting is experimental and is neither provided nor guaranteed by this Flow
release. Native `wait_threads` is active work, not an idle delivery boundary.

Urgent blockers, approval requests, and high-risk drift use a separate direct
path. The event is persisted before one bounded interrupt attempt. The runtime
does not retry that attempt; host replay or ambiguity cannot authorize duplicate
coordinator action. Ordinary completion never uses the urgent path.

The durable queue describes non-interrupting, resumable availability; it
implies neither FIFO ordering nor a required host transport. [ADR 0005](adr/0005-callback-authority-and-notification-lifecycle.md)
governs the current ordinary-completion authority and any future notification
adapter. The accepted implementation is a repository journal read by the
coordinator, not a Codex thread-message queue.

An App skill reload may let the same long-lived coordinator task invoke a newer
installed plugin, but it never hot-switches an active run. The old run remains
governed by its immutable repository snapshot until its executor tasks are
integrated, deliberately discarded through the bounded refresh handoff, or
otherwise reaches its own terminal lifecycle. A later run starts with a fresh
coordinator lineage at generation 1, so old callbacks cannot cross the cutover.

### Bounded delegation

The director may do bounded direct work or assign one coordinator; there is no
required task count. Every delegated assignment names outcome, scope,
constraints, acceptance, and exactly one reporting recipient/path. Every
executor receives a generated contract with explicit objective, dependency
position, ownership, model request, verification, and result terms. Result or
receipt delivery does not confer acceptance.

### Durable identity and evidence

The authorizing workflow revision, generated task contract, one-shot launch,
executor start claim, bound recipient lineage, Git state, terminal result or
urgent signal, and final disposition must form one traceable chain. The full
contract is the visible executor's first prompt; its deterministic start gate
authenticates identity and attaches the reserved branch before source mutation.
Requested, host-accepted, and independently observed facts remain distinct.
Ambiguous host outcomes fail closed instead of being converted into stronger
claims.

### Heterogeneous model orchestration

A coordinator may explicitly assign cheaper or specialized executor models and
reasoning effort. Native Codex performs the actual model selection. The plugin
records the request and available evidence; it does not claim a selector was
observed when the host only accepted it.

Separate, user-visible Codex tasks are the primary surface for independently
running or mutating executor-task work. Native subagents are a distinct read-only
supporting lane within the coordinator task; they do not acquire task branches,
callbacks, integrations, archives, or cleanup state. Neither surface is a
silent fallback for the other.

### Safe repository completion

Executor-task results do not authorize integration merely because a task finishes.
The coordinator authenticates the durable result and exact Git provenance,
integrates serially, runs combined verification, records the disposition once,
and removes state only through a reviewed cleanup contract.

Task final text, UI status, branch names, and caller-supplied raw digests are
not authority. Durable records are reloaded and cross-bound before a result can
be dispositioned, verified, archived, or cleaned.

### Native-first evolution

Codex host primitives are consumed directly when they satisfy the requirement.
When Codex gains a stable native capability, the plugin should thin around or
retire its corresponding mechanism unless a cross-task provenance or safety
contract remains unmet.

## Responsibility boundary

| Codex host authority | Codex Orchestration authority |
| --- | --- |
| Projects and task creation | Authenticated plan and bounded task contracts |
| Native subagents and visible tasks | Dependency graph, ownership, and shared-resource gates |
| Model and reasoning selection | Requested, accepted, and observed selector evidence |
| Managed worktree provisioning | Repository baseline, branch, and Git provenance |
| Task titles, messaging, waiting, and status | Quiet completion versus urgent interruption policy |
| Handoff and archive lifecycle | Durable result selection and exactly-once disposition |
| Native managed-worktree lifecycle and user-authorized Git mutation | Integration proof, cleanup eligibility, and deterministic read-only cleanup planning |

Generic orchestration mechanics belong in this repository. Pilot and product
repositories own their domain behavior and provide held-out evidence; they do
not carry local patches to the generic package contract.

## Non-goals

Codex Orchestration is not:

- a replacement for the native Codex task runtime or host-managed worktree
  lifecycle;
- a replacement for native subagents;
- a daemon, permanent secretary task, MCP server, or general agent framework;
- a second implementation of native project, task, Handoff, or archive APIs;
- tied permanently to Sol, Terra, or any current model family;
- an observability, evidence, or validation system that grows without enabling
  a named primary outcome; or
- generic package logic maintained inside a pilot or product repository.

## Feature-admission test

Before adding or retaining a mechanism, answer:

1. What cross-task user outcome does it protect?
2. Is the capability already supplied reliably by native Codex?
3. If native Codex supplies it, what provenance, continuity, or safety contract
   still requires plugin ownership?
4. Does the proposal protect coordinator continuity and bind every effect to
   authorized task identity?
5. Is it portable across model names and compatible host surfaces?
6. Is it the cheapest safe direct way to advance the primary outcome, or is it
   supporting instrumentation that should stop after one bounded checkpoint?

A feature that merely duplicates a native primitive should be retired or
reduced to a thin adapter. A feature that protects cross-task intent, ownership,
identity, non-disruptive delivery, integration, or cleanup remains within the
mission.

## Version relationship

This charter guides v0.9 and later development. Ordinary activation is a clean
authority boundary: it packages no general predecessor protocol reader,
migration, retirement, tracked adoption, or plugin-managed instruction path.
Earlier releases remain immutable source-tag and Git-history evidence only.

One narrow exception supports a long-lived coordinator after an App skill
reload. The coordinator may use a bounded refresh handoff to finish or discard
unintegrated executor tasks from one authenticated v0.8 source runtime and
activate one new v0.9 run. The source snapshot remains authority for source
lifecycle work; the target receives only semantic replacement briefs and fresh
task, launch, selector, Git, and runtime identities. v0.9 invokes the
authenticated source exporter and never parses or migrates source journals.
There is no current v0.7.8 or v0.8.1 executable bridge.
[ADR 0040](adr/0040-long-lived-coordinator-refresh.md) governs refresh, and
[ADR 0043](adr/0043-native-first-modular-architecture.md) governs the v0.9
compatibility boundary.

When incompatible retained local Flow state prevents a clean start, the
separate `unplug` lifecycle is deliberately narrower than predecessor support:
it inventories one repository, archives its known tasks, and applies only an
explicitly approved exact local cleanup plan. It may remove only authenticated,
tracked-clean same-common-directory linked worktrees and unprotected local
`codex/*` branches already ancestral to the authenticated base. Dirty,
ordinary-untracked, unmerged, attached, protected, remote, or drifted resources block;
Git-ignored generated artifacts alone do not.
Flow state is deleted last. The lifecycle does not inspect old workflow
semantics, touch remote refs, tags, or source history, or uninstall the App
plugin as a side effect. App uninstallation is a distinct optional action after
the repository has no Flow-state residue. Versioned schemas, runtime behavior,
and compatibility decisions remain explicit implementation checkpoints.
