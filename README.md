# Codex Orchestration

Private, repository-portable coordination for Codex work. The project has two
deliberately separate layers:

- `codex-orchestration` is a Codex plugin that teaches coordinator, executor,
  integration, and cleanup decisions through progressively loaded skills.
- `codex-flow` is an npm-compatible CLI that enforces mechanical contracts
  using only Node.js built-ins.

This is not a daemon, secretary task, or MCP server. Each repository pins a
reviewable runtime under `.codex/orchestration/`. Mutable recipient bindings,
task-operation attempts, urgent-signal and callback journals, and leases live under that
repository's Git common directory at `.git/codex-flow/v0.4/`, so linked worktrees
share the same coordination state.

## Requirements

- Git
- Node.js 20.11 or newer
- Codex host tools only for task creation and other explicitly requested host actions

No third-party npm packages are required. Target repositories do not need to
be JavaScript projects. JSON Schemas provide portable structural validation;
the CLI remains authoritative for graph, path, identity, expiry, redaction,
and lifecycle semantics.

## Pre-release compatibility policy

This private tool is intentionally allowed to break. Until the user explicitly
declares a stable compatibility boundary, a better contract replaces the old
one outright: no compatibility readers, migration branches, deprecated aliases,
or dual execution paths. Repositories preserve any evidence they still need,
retire old operational state explicitly, and initialize the current version.

Replacing a pre-v0.4 pinned runtime is a fresh installation on a dedicated
branch: retain the old `.git/codex-flow/` evidence, explicitly remove the old
tracked `.codex/orchestration/` runtime and configuration from that branch,
then plan and apply v0.4. New operational records live only in
`.git/codex-flow/v0.4/`; v0.4 neither reads nor deletes the retained namespace.

## Private distribution

Use the canonical checkout directly or install a private launcher from its
local path:

```bash
npm install --global /path/to/codex-orchestration
codex-flow --help
```

The global command is only a bootstrap/update entrypoint. `init` copies a
version-pinned runtime into the target repository; routine work uses that
pinned copy. Updating the launcher therefore does not silently alter an
initialized repository.

The npm package also contains a valid Codex plugin manifest and its skills.
npm installation does not register the plugin with the Codex app. Marketplace
registration remains a separate, explicit user-level operation.

## Bootstrap a repository

Create or switch to the intended integration branch first, then run from that
exact target worktree:

```bash
node /path/to/codex-orchestration/bin/codex-flow.mjs init --plan --json
node /path/to/codex-orchestration/bin/codex-flow.mjs init \
  --apply-plan <plan_id> --json
node .codex/orchestration/bin/codex-flow.mjs doctor
```

Planning is mandatory and completely read-only. The plan aggregates the exact
write set, before/after hashes and line counts, activation roots, compatibility
conflicts, and a deterministic `plan_id`. Application recomputes the plan and
refuses stale IDs. Configuration, pinned runtime, and instruction integration
activate as one transaction and roll back together on failure.

The plan ID binds the repository branch, revision, and cleanliness. Apply it
from the same branch and unchanged worktree where it was created. Switching to
a pilot branch after planning deliberately invalidates the plan; branch first,
then plan and apply.

Managed instruction mode preserves existing `AGENTS.md` content and owns one
bounded block. A mature repository with an equivalent contract may instead use:

```bash
node /path/to/codex-orchestration/bin/codex-flow.mjs init --plan --json \
  --agents-mode external --external-agents-path AGENTS.md \
  --attest-external-agents
```

Repeat those same mode/path/attestation options with `--apply-plan <plan_id>`.
External mode records the repository-relative instruction path, exact content
hash, contract version, and explicit human attestation without injecting prompt
text. `doctor` and `sync --check` fail on drift until the changed instructions
are reviewed and explicitly re-attested through a new plan.

Use `init --check` for installed-state compliance. Run `init` and `sync` from
the canonical package; the pinned copy intentionally refuses to update itself.

New repositories default delegated tasks to `gpt-5.6-terra` with `xhigh`
reasoning. `config set` changes repository defaults, and each task packet may
override either value. The resolved values must be passed to the actual host
creation call; prompt text alone does not configure a task.

## Core commands

```text
codex-flow init --plan [--json] [initialization options]
codex-flow init --apply-plan <plan_id> [initialization options]
codex-flow init --check
codex-flow sync [--check] [--force]
codex-flow config show|set ...
codex-flow doctor [--json]
codex-flow task start --role coordinator|executor
codex-flow task packet validate|render <packet.json>
codex-flow task operation prepare --file <packet.json>
codex-flow task operation preflight --operation-id <id>
                  --file <host-capability-evidence.json>
codex-flow task operation attempt --operation-id <id>
codex-flow task operation bootstrap --operation-id <id> --file <packet.json>
codex-flow task operation reconcile --operation-id <id> --attempt-id <id>
                  --outcome observed|not-created|ambiguous|failed|host-session-blocked ...
codex-flow task operation release --operation-id <id> --file <packet.json>
codex-flow task operation status [--operation-id <id>]
codex-flow plan validate <plan.json>
codex-flow recipient bind|rebind|status|resolve ...
codex-flow callback deliver --file <receipt.json>
codex-flow callback observe --callback-id <id> --lineage-id <id>
                  --thread-id <id> --generation <n>
codex-flow callback consume --callback-id <id> --lineage-id <id>
                  --thread-id <id> --generation <n> --executor-id <id>
codex-flow callback expire|status ...
codex-flow urgent persist --file <urgent-signal.json>
codex-flow urgent attempt prepare --urgent-id <id> --attempt-sequence <n>
                  [--retry-reason <reason>]
codex-flow urgent attempt reconcile --urgent-id <id>
                  --delivery-attempt-id <id>
                  --host-call-result sent|rejected-before-send|ambiguous
codex-flow urgent observe --urgent-id <id> --delivery-attempt-id <id> ...
codex-flow urgent consume --urgent-id <id> ... --sender-executor-id <id>
codex-flow urgent expire|status ...
codex-flow git bind --operation-id <id>
codex-flow git integrate --operation-id <id> --main-branch <branch>
                  [--superseded-by <ref>]
codex-flow git status
codex-flow lease acquire|release|status ...
codex-flow cleanup audit [--json]
codex-flow cleanup plan --operation-id <id>... --main-branch <branch>
                  [--include-remote]
codex-flow cleanup apply --plan-id <id> --operation-id <id>...
                  --main-branch <branch> [--include-remote]
```

## Task creation contract

Every packet explicitly requests either a user-visible `task-thread` or a
hidden `subagent`; the kinds are not interchangeable. Before calling a host
tool, persist a deterministic operation with `task operation prepare`, record
strict capability evidence for the current host session with `preflight`, then
start a bounded attempt. After the host call, inspect the actual object and
reconcile its ID, kind, and field-level evidence provenance.

`local` packets name an existing exact Git worktree in
`environment.project_path`; preparation and attempt authenticate its full
`HEAD` and declared cleanliness. `host-worktree` packets instead name the
saved repository, an exact local `starting_branch`, and an unclaimed
`executor_branch`. Preparation and attempt authenticate the source tip and
branch-name availability without requiring the saved checkout itself to be
clean or on that branch.

Desktop-created worktrees use a two-phase launch. After `attempt`, render the
bootstrap-only prompt and make one host call. The bootstrap contains no task
objective and forbids repository work. Reread the created task's actual worktree
path, reconcile it as host-observed, run `git bind`, then render `release` and
send that full packet to the same task. Binding proves the path is a pristine,
distinct worktree in the same Git repository at the exact starting revision.
If Desktop supplied it detached, binding first persists an immutable claim
receipt, claims the packet-declared executor branch, and rereads every invariant
before recording ownership. An interrupted bind resumes only from that exact
receipt. Never guess the path, accept an unreceipted named branch, or bind the
saved checkout.

A timeout is ambiguous, not failure. List/read the host state before retrying,
then reconcile `observed` or `not-created`. No new launch may start after the
packet's absolute zoned deadline. The CLI journals the operation but does not
invoke private in-session model tools; the coordinator performs the one-shot
host call using the capability available in that session.

Unsupported or unverified required selectors stop before an attempt exists. A
dispatch-time serializer, adapter, backend, schema-runtime, or host-control
failure is `host-session-blocked`; retry requires compatible evidence from a
different host session. Preflight history remains immutable so every attempt is
bound to the exact session evidence that authorized it.

Task-thread title must be independently reread and exactly match the request.
When the host substitutes the delegation envelope, perform one bounded title
write, reread the exact title, and record `bounded-host-write`. A subagent may
have no title field; keep its host nickname separate and report title evidence
as unavailable. Requested, accepted, role-derived, and independently observed
model/reasoning facts are never conflated.

See [Host operations](templates/references/host-operations.md) for the adapter
procedure and bounded host-list fallback.

## Callback and fork contract

Urgent blockers, approval requests, and high-risk drift use `journal-direct`.
The sender first persists a strict urgent signal, prepares one numbered
delivery attempt, and passes the returned `host_prompt` string directly to one
Steer call. It then reports the operator-observed host result as `sent`,
`rejected-before-send`, or `ambiguous`. The public CLI intentionally has no
`--outcome` alias. A second host call requires a new numbered attempt and an
explicit retry reason. Raw identity-less Steer is invalid for new work.

The coordinator calls `urgent observe` with the signal and attempt IDs before
acting. The first observed attempt returns `disposition: process`; every later
envelope for that logical signal returns `disposition: suppress`. Repeated
observation of one attempt is classified as a host replay. A different attempt
ID for the same signal is classified as an additional sender attempt. The
coordinator calls `urgent consume` after handling the signal. Corrected urgent
content advances the logical sequence and explicitly names its predecessor.
Host-added envelope fields never participate in identity.
`urgent observe --json` returns the exact `consume_arguments`, including the
sender's executor ID; urgent consumption therefore uses
`--sender-executor-id`, not the receiver task ID.

Ordinary terminal completion uses `callback deliver`, which persists a strict
receipt in the repository journal. The default and only installed project
authority is `journal-monitor`: it creates no Codex thread-queue entry. The
coordinator or its quiet monitor reads `callback status`, then observes with
the current recipient identity and consumes only after integration.

When the current host exposes `wait_threads`, the active coordinator should use
it to wait efficiently on the current wave and carry returned cursors into later
waits. It is notification only: after every completion wake, inspect
`callback status` and follow the same observe, integration, reproof, and consume
path. Task final text, needs-attention state, timeout, or wait interruption is
not a receipt. If the coordinator turn ends, durable resumption still comes
from the journal or an explicit automation.

Integration is exactly once by deterministic callback ID and a durable
observed/consumed journal. Corrected receipts use increasing sequence numbers
and explicit supersession; arrival order is never authority. Task packets and
project configuration must name the same ordinary-completion authority, so a
monitor cannot silently integrate work that was also queued.

v0.4 intentionally removes the experimental queue adapter and every legacy
callback reader. An ordinary completion has one authority and one durable path.
This is a breaking checkpoint: v0.3 configuration, task-operation records, and
callback journals are not migrated. The package fails closed rather than carry
compatibility code.

Before launching executors, bind the coordinator lineage with `recipient bind`.
The first successful bind returns a private fence token; idempotent bind replay
without the token and status redact it. Supply and retain `--fence-token` when
initial-bind output could be interrupted. After a fork or authoritative thread
replacement, use that token with `recipient rebind`; stale packets resolve to the current
generation, while observe/consume requires the current recipient identity. For
retry-safe rebinding, choose and retain `--next-fence-token`; replaying the same
old/new token pair and generation is idempotent.

Urgent signals and terminal receipts reject unknown fields, oversized content, secret-like material,
application/account identifiers, raw logs/transcripts, and user identity data.

## Cleanup boundary

Bind every local or host-created worktree executor to its observed task operation with
`git bind` before the branch changes. After serial integration and reproof, run
`git integrate` from a clean integrating branch. The record classifies the
exact executor tip as an ancestor, patch-equivalent, explicitly superseded, or
unmerged. Ownership also pins the intended task upstream and a hash of its push
destination when the controller repository has an upstream.

`cleanup audit` is read-only. It joins those records with task operations,
leases, linked worktrees, local refs, and exact remote refs. Dirty, active,
protected, drifted, ambiguous, or uniquely unmerged state is never eligible.
Branch names alone are never deletion authority.

Deletion requires an explicit deterministic `cleanup plan`, followed by an
`apply` with the same plan ID and arguments. Apply rechecks the clean/pushed
main revision, pinned remote identity, every exact tip, active leases, and a
worktree scan that includes ignored and normally hidden untracked files. It
then removes only the planned clean linked worktree, local ref, and remote ref,
in that preservation-first order. An interruption invalidates the old plan;
audit again and make a fresh plan for what remains. Executors never run cleanup.
Remote cleanup requires exactly one fetch URL and one identical push URL;
split or fan-out remotes fail closed.
This is a process-role rule rather than a security claim: a local CLI cannot
authenticate which Codex role invoked it.
Configured warning and block thresholds count integrated Git records that still
need local reconciliation, including unsafe ones, so another task wave cannot
grow an unattended worktree/branch backlog. Task preparation and `doctor` stay
network-free; explicit audit and cleanup commands inspect exact remote tips.

## Development

```bash
npm test
npm run validate
npm run pack:check
```

See [ADR 0001](docs/adr/0001-portable-layered-orchestration.md) for the layered
architecture and [ADR 0002](docs/adr/0002-run-identity-and-host-reconciliation.md)
for identity, queue, deadline, and host-reconciliation decisions. Installation
planning and external instruction ownership are defined by
[ADR 0003](docs/adr/0003-install-planning-and-instruction-ownership.md).
Local task baseline authentication is defined by
[ADR 0004](docs/adr/0004-authenticate-local-task-baselines.md).
[ADR 0005](docs/adr/0005-callback-authority-and-notification-lifecycle.md)
records the superseded v0.3 queue-lifecycle decision.
[Host capability and observation evidence](docs/adr/0006-host-capability-and-observation-evidence.md)
defines the v0.3.3 host-session and title-normalization contract.
[Git lifecycle and breaking-state policy](docs/adr/0007-git-lifecycle-and-breaking-state.md)
defines the v0.4 ownership and cleanup contract.
[Host-provisioned worktree launch](docs/adr/0008-host-provisioned-worktree-launch.md)
defines the two-phase Desktop worktree contract.
[Journaled urgent direct delivery](docs/adr/0009-journaled-urgent-direct-delivery.md)
defines urgent-signal and delivery-attempt identity. The current covered
boundary is listed in [v0.4.3 orchestration coverage](docs/coverage-v0.4.3.md).
