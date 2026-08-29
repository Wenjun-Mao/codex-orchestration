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

Source validation treats a locally visible annotated `v<exact package version>`
tag as a release-authority claim. When that tag exists, validation compares the
complete relevant npm package set against that tag: `package.json`; every path
selected by the nonempty `files` allowlist; root README, COPYING, LICENSE, and
LICENCE names with any case and extension that npm automatically includes; and
declared `main` plus every `bin` entrypoint. It rejects tracked differences and
ordinary or ignored untracked paths in that set. A lightweight tag is not
accepted as release authority.

An exact stable semantic version with no local annotated tag fails closed:
stable source cannot be packaged without release evidence. An untagged
prerelease is an unreleased development identity and remains eligible for
normal source work. This deliberately uses locally available tag evidence; a
remote tag that has not been fetched cannot establish a local packaging claim.

The same guard runs from `npm run validate` and the package `prepack`
lifecycle, so `npm pack` (including the dry-run package check) cannot bypass
release identity by omitting a prior validation command. The guard runs only
in a source checkout, where both package metadata and local release tags are
available; marketplace and installed distribution copies retain their own
metadata validation but neither redefine nor prove a source release.

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

- Any relevant package change after an exact version is tagged requires a new
  version before source validation or direct packaging can pass.
- A future accepted `v0.5.2` must be annotated and point to the package source
  reviewed for that exact version; later changes begin another development
  identity.
- The editable `v0.5.2-dev.0` source gains its own state namespace only when it
  is explicitly installed. It does not migrate, read, delete, or replace the
  repository-pinned v0.5.1 runtime or `.git/codex-flow/v0.5.1/` state.
- The accepted `v0.5.1` tag, personal marketplace artifact, installed cache,
  and UK Dev pinned runtime remain unchanged until an explicitly authorized
  distribution and adoption workflow.
