# ADR 0001: Portable layered Codex orchestration

- Status: accepted
- Date: 2026-08-23
- Scope: private cross-repository Codex workflow infrastructure

## Context

Long-running repository work benefits from a coordinator that can partition
independent slices, delegated executors that own bounded paths, durable ordinary
completion callbacks, and serial integration. Putting every procedure in
`AGENTS.md` wastes context and creates role ambiguity. A central daemon, shared
database, or MCP server introduces lifecycle and cross-project coupling.

Codex sessions also expose different tool surfaces. Thread creation, direct
messaging, or tool search can be present in one session and absent in another.
Prompt text cannot create a missing host capability.

## Decision

Use three layers:

1. A plugin provides progressively loaded decision guidance.
2. A zero-third-party-dependency Node CLI validates and persists mechanical
   workflow contracts.
3. Each repository owns a thin, pinned binding under `.codex/orchestration/`.

Mutable state belongs under the target repository's Git common directory at
`.git/codex-flow/`. Worktrees therefore share callbacks and exclusive-resource
leases without sharing state across repositories.

The CLI is npm-compatible for versioning and private distribution, but target
repositories execute a pinned local snapshot. It does not require a package
registry, `node_modules`, or a JavaScript application.

Parallel work is serial by default. A validated plan must establish baseline,
dependencies, disjoint write ownership, exclusive shared resources, and serial
integration gates before executors begin. Ordinary terminal completion is
persisted and queued; urgent blockers and approvals use Steer. Executors never
manage siblings, monitors, integration, or archive state.

`codex-flow` cannot introspect the model's private tool registry. `doctor`
therefore reports thread creation as requiring a runtime probe rather than
claiming availability. When creation is unavailable, the coordinator emits a
validated task packet for a capable session or human instead of substituting a
subagent silently.

Project configuration defaults delegated task creation to `gpt-5.6-terra`
with `xhigh` reasoning. A coordinator may select another model or supported
reasoning effort per task packet; the resolved values must be visible in the
rendered launch request and supplied to the host creation tool rather than
inherited silently from the host.

## Consequences

- Existing language-specific `AGENTS.md` guidance remains intact.
- Detailed playbooks load only for the active role.
- Callback integration is exactly once by deterministic callback ID, while
  transport may be retried at least once.
- Queue and lease state are operational state, never an evidence archive.
- Cleanup is audit-only in v0.1; deletion requires a later explicit contract.
- No claim is made for FIFO, archived destinations, role retention through
  compaction/fork, or every Codex host until controlled field tests prove them.

## Rejected alternatives

- Full playbooks in every root prompt.
- A global mutable CLI as the routine execution path.
- A permanent secretary task, daemon, or MCP server.
- Steer-first delivery for ordinary completion.
- Silent subagent substitution when task-thread creation is unavailable.
