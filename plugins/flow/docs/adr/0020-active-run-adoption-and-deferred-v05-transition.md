# ADR 0020: Active-run adoption and deferred v0.5 transition

## Status

Accepted for the v0.6 development boundary.

The deferred predecessor-transition portion is superseded by
[ADR 0022](0022-exact-v051-tracked-authority-retirement.md) for accepted
tracked v0.5.1 authority. Run-independent tracked v0.6 adoption remains
deferred.

## Context

Progressive activation removes mandatory tracked setup for a repository that
has no predecessor authority. The current adoption implementation snapshots
the exact runtime, configuration, and policy of a named active v0.6 run. It is
therefore a promotion mechanism, not an independent initial-install engine.

Tracked v0.5 repositories present a different problem. v0.6 correctly blocks
activation when `.codex/orchestration/version.json`, the v0.5 project manifest,
or unclassified predecessor files remain. The existing
`adopt retire-plan|retire-apply` implementation inventories only a tracked
v0.6 adoption. Reusing that command for v0.5 would delete or rewrite bytes
outside its manifest and would falsely treat Git history, AGENTS instructions,
package/cache provenance, and retained Git-common evidence as one authority.

## Decision

- `adopt plan|apply` promotes the exact runtime of a named active v0.6 run to
  optional tracked adoption. It does not activate a run or authorize new tasks.
- `adopt retire-plan|retire-apply` applies only to that tracked v0.6 adoption.
- v0.6 run-scoped use remains setup-free only when no tracked predecessor
  authority exists.
- This checkpoint does not implement tracked-v0.5 retirement, migration, or
  import. A repository carrying that authority remains on v0.5 until a
  separately approved transition contract exists.
- Documentation and skills must fail closed and describe this limitation; they
  must not present the v0.6 adoption-retirement command as a v0.5 transition.

## Rejected alternatives

- Alias v0.6 `retire-plan` to v0.5 files. The v0.6 adoption manifest does not
  own those paths or the managed AGENTS block.
- Ignore tracked v0.5 files during activation. That creates two executable
  instruction/runtime authorities in one repository.
- Copy v0.5 operational state into v0.6. The versions have intentionally
  breaking schemas and different lifecycle authority.
- Add a quick deletion script in this checkpoint. Safe predecessor retirement
  needs its own exact inventory, provenance, stale-plan checks, and explicit
  approval boundary.

## Consequences and follow-up

- New or predecessor-free repositories can use progressive v0.6 activation
  immediately and may promote an active run afterward.
- This source repository cannot self-activate v0.6 while its accepted tracked
  v0.5.1 authority remains; implementation work and source tests do not change
  that installed/runtime authority.
- The next transition checkpoint should design a run-independent adoption
  source contract and a distinct `legacy-retire-plan|legacy-retire-apply`
  contract. It must hash only manifest-owned predecessor paths and the exact
  managed instruction block, preserve tags/cache/Git-common evidence and
  unrelated bytes, refuse active or ambiguous v0.5 work, and apply only after
  explicit review.
