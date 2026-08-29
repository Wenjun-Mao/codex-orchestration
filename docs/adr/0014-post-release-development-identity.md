# ADR 0014: Post-release development identity

## Status

Accepted.

## Context

Annotated tag `v0.5.1` identifies the accepted 90-file package tree at
`d03cabfffb612ad8f33853896b15deee3ad66698`. Subsequent source changes added
packaged documentation and changed other packaged paths while `package.json`,
the plugin manifest, and the runtime constant all still named `0.5.1`.
`npm pack --dry-run` could therefore produce a different package under the
already accepted version. The source validator checked only those three
metadata values, so it did not enforce the release-tag authority recorded in
ADR 0012.

Updating the v0.5.1 marketplace source, installed cache, or repository-pinned
runtime would hide the mismatch rather than correct its cause. Those copies
remain the accepted consumer artifact and must stay at v0.5.1.

## Decision

The editable source begins the next unreleased development line at
`0.5.2-dev.0`. Package metadata, plugin metadata, the runtime constant, and
generated managed-instruction marker all use that exact development identity.
Its namespace is therefore `.git/codex-flow/v0.5.2-dev.0/` when it is
explicitly installed; existing v0.5.1 consumers retain their separate
namespace and runtime.

Source validation treats an annotated `v<exact package version>` tag as a
release-authority claim. When that tag exists, validation compares every path
selected by `package.json`'s `files` allowlist (and `package.json` itself)
against the tag, and rejects both tracked differences and untracked paths,
including ignored files under a selected package root. A lightweight tag is
not accepted as release authority. A version with no matching annotated tag is
an unreleased development version and remains eligible for normal source work.

The guard is deliberately in source validation rather than marketplace or
installed distribution copies: only the source repository has both the exact
package-path allowlist and the release tag needed to decide whether a version
may be reused. Distribution copies continue to validate their own exact
metadata but cannot redefine a release.

## Rejected alternatives

- Leave source at `0.5.1` and rely on metadata equality. It permits a distinct
  package under an already accepted identity.
- Update the v0.5.1 marketplace/cache/runtime copies. It overwrites accepted
  consumer behavior without a new release checkpoint.
- Move or recreate `v0.5.1`. It destroys the immutable release evidence rather
  than preserving the accepted artifact.

## Consequences and guardrails

- Any packaged change after an exact version is tagged requires a new version
  before source validation can pass.
- A future accepted `v0.5.2` must be annotated and point to the package source
  reviewed for that exact version; later changes begin another development
  identity.
- The accepted `v0.5.1` tag, personal marketplace artifact, installed cache,
  and UK Dev pinned runtime remain unchanged until an explicitly authorized
  distribution and adoption workflow.
