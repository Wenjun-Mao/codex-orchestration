# Codex Orchestration

Private, repository-portable coordination for Codex work. The project has two
deliberately separate layers:

- `codex-orchestration` is a Codex plugin that teaches coordinator, executor,
  integration, and cleanup decisions through progressively loaded skills.
- `codex-flow` is an npm-compatible CLI that enforces mechanical contracts
  using only Node.js built-ins.

This is not a daemon, secretary task, or MCP server. Each repository pins a
reviewable runtime under `.codex/orchestration/`. Mutable recipient bindings,
task-operation attempts, callback journals, and leases live under that
repository's Git common directory at `.git/codex-flow/`, so linked worktrees
share the same coordination state.

## Requirements

- Git
- Node.js 20.11 or newer
- Codex host tools only for task creation and other explicitly requested host actions

No third-party npm packages are required. Target repositories do not need to
be JavaScript projects. JSON Schemas provide portable structural validation;
the CLI remains authoritative for graph, path, identity, expiry, redaction,
and lifecycle semantics.

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
codex-flow task operation reconcile --operation-id <id> --attempt-id <id>
                  --outcome observed|not-created|ambiguous|failed|host-session-blocked ...
codex-flow task operation status [--operation-id <id>]
codex-flow plan validate <plan.json>
codex-flow recipient bind|rebind|status|resolve ...
codex-flow callback deliver --file <receipt.json>
codex-flow callback observe --callback-id <id> --lineage-id <id>
                  --thread-id <id> --generation <n> --source journal-monitor
codex-flow callback consume --callback-id <id> --lineage-id <id>
                  --thread-id <id> --generation <n> --executor-id <id>
codex-flow callback reconcile|expire|status ...
codex-flow lease acquire|release|status ...
codex-flow cleanup audit [--json]
```

## Task creation contract

Every packet explicitly requests either a user-visible `task-thread` or a
hidden `subagent`; the kinds are not interchangeable. Before calling a host
tool, persist a deterministic operation with `task operation prepare`, record
strict capability evidence for the current host session with `preflight`, then
start a bounded attempt. After the host call, inspect the actual object and
reconcile its ID, kind, and field-level evidence provenance.

For `local` and `worktree` packets, `environment.project_path` is the absolute
Git worktree root and `baseline.revision` is its exact full `HEAD`. Preparation
authenticates the packet against that repository before creating an operation
record. Starting an attempt authenticates it again, including expected clean
or explicitly dirty state, immediately before the host call. A legacy operation
without this evidence remains readable but cannot launch until its original
packet is prepared again.

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

Urgent blockers, approval requests, and high-risk drift use direct Steer.
Ordinary terminal completion uses `callback deliver`, which persists a strict
receipt in the repository journal. The default and only installed project
authority is `journal-monitor`: it creates no Codex thread-queue entry. The
coordinator or its quiet monitor reads `callback status`, then observes with
`--source journal-monitor` and consumes only after integration.

Integration is exactly once by deterministic callback ID and a durable
observed/consumed journal. Corrected receipts use increasing sequence numbers
and explicit supersession; arrival order is never authority. Task packets and
project configuration must name the same ordinary-completion authority, so a
monitor cannot silently integrate work that was also queued.

The library contains an optional capability-probed retractable-queue contract
for adapter field tests. It requires stable add/list/delete identities, sends
only a callback pointer, and performs host calls outside the journal lock. No
such experimental host adapter is enabled by default or required for package
operation, and v0.3.2 does not claim Desktop queue retraction from a real host
field test.

Upgrading a v0.3.1 repository requires an explicit read-only plan and accepted
authority migration:

```bash
codex-flow init --plan --callback-authority journal-monitor --json
codex-flow init --apply-plan <plan_id> \
  --callback-authority journal-monitor --json
```

Legacy callback journals remain readable. Because old `codex queue` accepted
no retractable submission identity, `doctor` reports any legacy notification
that may still surface. A stale legacy queue turn resolves the trusted receipt
from the journal and is deduplicated by callback ID; it must not be integrated
again.

Before launching executors, bind the coordinator lineage with `recipient bind`.
The first successful bind returns a private fence token; idempotent bind replay
without the token and status redact it. Supply and retain `--fence-token` when
initial-bind output could be interrupted. After a fork or authoritative thread
replacement, use that token with `recipient rebind`; stale packets resolve to the current
generation, while observe/consume requires the current recipient identity. For
retry-safe rebinding, choose and retain `--next-fence-token`; replaying the same
old/new token pair and generation is idempotent.

Receipts reject unknown fields, oversized content, secret-like material,
application/account identifiers, raw logs/transcripts, and user identity data.

## Cleanup boundary

`cleanup audit` is intentionally read-only. It reports callback lifecycle,
ambiguous task operations, recipient lineages, leases, legacy v0.1 state,
managed-runtime drift, and disk use. It does not archive threads, remove
worktrees, delete repositories, or erase evidence. Those actions require a
separate owner-authorized retention decision.

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
Ordinary-completion authority and queue-notification lifecycle are defined by
[ADR 0005](docs/adr/0005-callback-authority-and-notification-lifecycle.md).
[Host capability and observation evidence](docs/adr/0006-host-capability-and-observation-evidence.md)
defines the v0.3.3 host-session and title-normalization contract.
The current covered/partial/host-dependent boundary is listed in
[v0.3.3 orchestration coverage](docs/coverage-v0.3.3.md).
