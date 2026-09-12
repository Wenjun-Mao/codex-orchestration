# ADR 0074: Relay successor identity

Status: Accepted naming decision; successor implementation remains separately gated.

## Decision

**Codex Orchestration** is the umbrella project. Its plugins are **Flow**
(legacy) and **Relay** (successor). The umbrella name does not need to match
either plugin identifier, and this decision does not require separate repositories.

Name the successor **Relay**. Use one consistent identity:

- Product and App display name: `Relay`.
- Plugin identifier and CLI command: `relay`.
- Skill prefix: `relay:`, for example `relay:plan`.
- Plugin directory/package basename: `relay`; a distribution scope may be added if needed.

The name expresses handoffs between agents without implying concurrent writers
or a solo-only workflow. Relay is not "Flow Lite" and does not promise feature
parity with legacy Flow.

## Consequences

The existing Codex Orchestration plugin and Codex Flow tooling retain their
identifiers. This decision does not rename installations, migrate running tasks,
change the verified local RC artifact, or authorize deployment.

After Relay is stable and usable, revisit a surgical legacy naming cleanup so
Flow's display name, plugin identifier, skill prefix and CLI are consistent.
That is deferred work, not a current rename authorization. Scope the exact
compatibility and transition requirements then, preserving active projects and
their pinned reporting/runtime identities. Do not undertake the rename while
projects still depend on the current installation during Relay development.

Use Relay consistently in new successor plans and implementation. Public name
availability has not been checked; resolve distribution constraints before
publication rather than silently introducing another product name.

## Alternatives

Reject inconsistent names within a plugin: the existing Codex Orchestration versus
Codex Flow distinction caused avoidable confusion. Retain the distinct umbrella
project name. Reject a "Lite" suffix because
the successor targets a deliberate workflow, not eventual legacy feature parity.
