# 0077 — Multi-product layout and Flow retirement

Status: accepted.

## Decision
Codex Orchestration is the repository umbrella. Relay lives in `plugins/relay`;
the formerly root-level Flow product moves intact to `plugins/flow`. Each owns
runtime, tests, skills, manifests and product documentation. Root docs retain
cross-product decisions and issue tracking. Root npm scripts only delegate.

Flow and the experimental final-delivery hook are uninstalled, not erased from
history. Existing project records and pinned snapshots are not migrated or deleted.
Flow is labelled retired in documentation; its installed identifier and historical
manifest remain unchanged. A naming migration has no present user benefit.

## Consequences and guardrails
Relative product imports remain local. Adjust documentation links for relocation,
but do not rewrite historical assertions or release tags. Reproduce old releases
from their original tags/artifacts; the moved tree is reference source, not a new
0.9.13 distribution. Validate Flow source and tests after moving; verify Relay's
package remains independent. No runtime redesign or multi-product build framework.

The declined alternatives were leaving Flow at root (ambiguous ownership) and
renaming its compatibility identifiers (unnecessary migration work).
