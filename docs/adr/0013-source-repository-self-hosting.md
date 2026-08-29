# ADR 0013: Source repository self-hosting

## Status

Accepted.

## Context

The Codex Orchestration source repository was initially kept outside Codex
Flow's own repository-consumer model to avoid circular or duplicate authority.
After v0.5.1 package acceptance and the establishment of exact release tags,
the user chose this repository as a first-party consumer of the plugin.

Self-hosting must not turn the editable source tree into its own installed
package authority. It also must not bypass the same adoption, pinning, branch,
instruction, and verification contracts applied to unrelated repositories.

## Decision

Adopt this existing repository through the installed
`codex-orchestration@personal` setup skill at exact version v0.5.1. Use stable
project ID `codex-orchestration`, the managed root `AGENTS.md` integration, and
the required clean `codex/codex-flow-v0.5-adoption` worktree workflow.

The accepted installed plugin remains setup authority. The generated
`.codex/orchestration/` tree is a pinned consumer runtime and is never an
editing source for generic package behavior. Generic changes continue in the
repository's top-level source paths, pass a new exact-version acceptance
checkpoint, and reach the pinned runtime only through explicit retirement and
fresh installation under the pre-stable policy.

Self-hosted orchestration applies only to tasks launched after the adoption
commit is integrated on authoritative `main`. It does not adopt, journal,
archive, migrate, or clean earlier tasks or Git state.

## Rejected alternatives

- Remain only an external package authority. First-party use can exercise
  repository-portability and reveal generic workflow gaps earlier.
- Bootstrap from the editable top-level CLI. That would let unaccepted source
  define its own consumer runtime and create circular authority.
- Hand-create `AGENTS.md` or copy runtime files. The installed setup skill owns
  planning, hashing, activation, and rollback.
- Attest an external instruction contract. This repository has no existing
  root `AGENTS.md`; managed integration is the applicable default.
- Apply adoption directly in the source checkout. Existing-repository setup
  requires a clean linked worktree and dedicated branch.

## Consequences and guardrails

- This repository becomes both package owner and explicit first-party consumer,
  while source and installed-runtime authority remain separate.
- Run the pinned `doctor` before delegated work in this repository.
- Treat `.codex/orchestration/` and its managed `AGENTS.md` block as generated
  adoption state; update them only through the canonical plugin workflow.
- A source checkout or newer Git tag never upgrades the pinned runtime
  implicitly.
- Adoption integration and cleanup must preserve the exact planned files,
  prove the setup branch merged, and leave no setup worktree or branch residue.
