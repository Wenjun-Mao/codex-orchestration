# ADR 0003: Plan installation and make instruction ownership explicit

## Status

Accepted.

## Context

The first UK Dev pilot of v0.2 found no filesystem ownership collision, but a
semantic repository-policy collision remained. Appending the package's managed
`AGENTS.md` block pushed an accepted concise root file beyond its repository
line-budget guard. The old process stayed healthy and the pilot rolled back,
but v0.2 discovered the conflict only after writing.

Path disjointness is therefore insufficient. Installation must expose its exact
repository-visible result before activation, and mature repositories must be
able to retain an equivalent instruction contract without duplicated prompt
text. The package cannot reliably prove arbitrary natural-language equivalence.

## Decision

1. Initialization requires a read-only deterministic plan before application.
   The plan records the exact content-changing operations, hashes, line counts,
   activation roots, conflicts, repository identity, and package version.
2. Application requires the plan ID and recomputes the complete plan under the
   repository management lock. Any changed input invalidates the ID.
3. Configuration, pinned runtime, and instruction integration activate as one
   transaction. A failure restores the prior runtime and instruction bytes.
4. `managed` instruction mode remains the default. Codex-flow owns only its
   marked block in root `AGENTS.md`.
5. `external` mode requires an explicit human attestation. Configuration binds
   the repository-relative instruction path, exact SHA-256 digest, and external
   contract version. No package block is injected.
6. Doctor and sync checks fail closed when externally owned instructions drift.
   A changed file requires a new reviewed plan and explicit re-attestation.
7. A normal unplanned `init` is rejected. `init --check` remains a read-only
   installed-state compliance check.

## Rejected alternatives

- **Shorten the block only:** this would pass one line limit while preserving
  redundant prompt content and missing the general compatibility defect.
- **Automatically infer prose equivalence:** natural-language similarity is not
  a trustworthy authority decision.
- **Weaken the repository validator:** repository policy remains authoritative.
- **Write first and invoke a hook afterward:** post-write rollback is weaker than
  a reviewable, plan-bound activation contract.

## Consequences

- Bootstrap is two-step and requires carrying the same mode options into apply.
- Mature repositories can avoid prompt bloat while retaining explicit,
  hash-bound accountability.
- Repository-specific policy tools can inspect JSON plan output before approval
  without coupling codex-flow to a language, package manager, or hook framework.
- External instruction edits deliberately create a doctor failure until a human
  re-attests the revised contract.

## Guardrails

- Tests prove planning leaves repository and Git index metadata unchanged.
- Tests reject stale plans before any planned path changes.
- Tests cover external drift and explicit re-attestation.
- A fault-injected activation test proves runtime and AGENTS rollback together.
