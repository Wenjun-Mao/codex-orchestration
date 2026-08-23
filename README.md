# Codex Orchestration

Private, repository-portable coordination for Codex work. The project has two
deliberately separate layers:

- `codex-orchestration` is a Codex plugin that teaches coordinator, executor,
  integration, and cleanup decisions through progressively loaded skills.
- `codex-flow` is an npm-compatible CLI that enforces mechanical contracts
  using only Node.js built-ins.

The package is not a daemon or MCP server. Each repository pins a reviewable
runtime under `.codex/orchestration/`; mutable callbacks and leases live under
that repository's Git common directory at `.git/codex-flow/`.

## Requirements

- Git
- Node.js 20.11 or newer
- Codex CLI only when persistent thread-queue delivery is requested

No third-party npm packages are required. Target repositories do not need to
be JavaScript projects.

The bundled JSON Schemas provide portable structural validation. The CLI is
the final authority for cross-field and graph semantics such as callback/task
identity equality, path overlap, dependency closure, and secret-like receipt
rejection.

## Private distribution

The canonical checkout can be used directly, or installed as a launcher from
its local path:

```bash
npm install --global /path/to/codex-orchestration
codex-flow --help
```

The global command is only a bootstrap/update entrypoint. `init` copies a
reviewable version-pinned runtime into the target repository, and routine work
uses that pinned copy. Removing or updating the global launcher therefore does
not silently change an initialized repository.

The npm package also contains a valid Codex plugin manifest and its skills.
npm installation does not register that plugin with the Codex app. Plugin
marketplace registration is a separate, explicit user-level operation; v0.1
does not create or modify a personal marketplace as a bootstrap side effect.

## Bootstrap a repository

Run from the target repository:

```bash
node /path/to/codex-orchestration/bin/codex-flow.mjs init
node .codex/orchestration/bin/codex-flow.mjs doctor
```

`init` preserves existing `AGENTS.md` content and owns only one bounded managed
block. It installs the pinned CLI runtime, role entrypoints, and references.
Use `init --check` for a read-only compliance check.

Run `init` and `sync` with the canonical package path shown above. The pinned
repository copy intentionally refuses to update itself; all other routine
commands run from `.codex/orchestration/`.

New repositories default delegated task packets to `gpt-5.6-terra` with
`xhigh` reasoning. Initial defaults can be supplied to `init`; later changes
use `config set`. An individual task packet may override either field. Use
`host-default` to request no explicit override. The rendered packet always
shows the resolved selection, and a capable coordinator passes those resolved
values as the host thread-creation model and reasoning arguments.

## Core commands

```text
codex-flow init [--check] [--force]
codex-flow sync [--check] [--force]
codex-flow config show [--json]
codex-flow config set [--model <model>] [--reasoning-effort <effort>]
                      [--max-concurrency <n>] [--json]
codex-flow doctor [--json]
codex-flow task start --role coordinator|executor
codex-flow task packet validate <packet.json>
codex-flow task packet render <packet.json>
codex-flow plan validate <plan.json> [--json]
codex-flow callback deliver --file <receipt.json>
codex-flow callback consume --callback-id <id> --source-thread-id <id> --executor-id <id>
codex-flow callback status [--json]
codex-flow lease acquire --resource <id> --owner <id> [--ttl-seconds <n>]
codex-flow lease release --resource <id> --owner <id> --token <token>
codex-flow lease status [--resource <id>] [--json]
codex-flow cleanup audit [--json]
```

Urgent blockers, approval requests, and high-risk drift use the host's direct
Steer surface. `callback deliver` is only for ordinary terminal completion. It
persists a bounded receipt before trying `codex queue`; temporary transport
failure retains the receipt and exits with status 75.

Queue transport is intentionally at least once because the host queue does not
offer a durable idempotency key. Every message carries a deterministic callback
ID, and coordinator-side consumption enforces exactly-once integration.

## Development

```bash
npm test
npm run validate
npm run pack:check
```

See [ADR 0001](docs/adr/0001-portable-layered-orchestration.md) for the durable
architecture and current acceptance boundary.
