# ADR 0053: Consolidated release candidates

- Status: accepted standing release policy
- Date: 2026-09-06
- Refines: ADR 0012 immutable release tags

## Context

Publishing every approved implementation checkpoint creates installation,
reload, and full-suite repetition without improving the final distribution.
Skipping meaningful candidate gates, however, would weaken live safety
evidence. Published identities also cannot be rewritten when later work is
combined.

## Decision

Combine approved unreleased work into one useful final release when a later
candidate supersedes the intermediate package and nobody needs that
distribution. Keep the work reviewable in commits, but skip unnecessary
intermediate stable publishing, installation, and repeated full testing.

Retain necessary release candidates, affected safety checks, and live reload
gates. Do not widen scope merely to batch work or delay a needed fix waiting for
unrelated changes. Reuse evidence only where the code, host, and authority it
proved are unchanged; repeat affected and previously failed gates.

Published versions, tags, and artifacts remain immutable and are never moved,
overwritten, or reused. Active runs retain their exact installed runtime
snapshot and never hot-switch.

## Rejected alternatives

- Publish every implementation checkpoint. This creates ceremony without a
  distinct consumer need.
- Skip release candidates and affected live checks. Consolidation is not a
  waiver of safety gates.
- Rewrite an already-published version. This destroys release identity and
  runtime provenance.

## Consequences and guardrails

Maintainers identify the intended consumer release before packaging, explain
which evidence is reused, and run the combined full suite once the final
candidate is ready. A necessary urgent fix may ship alone. CONTRIBUTING.md
links this policy from the operational release entrypoint.
