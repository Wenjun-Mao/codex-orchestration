# ADR 0012: Public source, private distribution, and release tags

## Status

Accepted.

## Context

Codex Flow v0.5.1 was accepted while its source repository had no remote and
the package was distributed only through a personal Codex plugin marketplace.
The repository is now publicly readable at
`https://github.com/Wenjun-Mao/codex-orchestration`.

Public repository visibility does not by itself decide licensing, package
distribution, release identity, or whether the latest `main` commit is an
accepted package. Those authorities must remain distinct so a source push
cannot silently replace an installed plugin or a repository-pinned runtime.

The public history also contains bounded field-test provenance: local fixture
paths, opaque Codex task identifiers, and named UK Dev pilot evidence. A
bounded history-wide credential-pattern audit found no credential-bearing
value; its only provider-shaped token was an intentional secret-rejection test
fixture.

## Decision

This Git repository remains the sole editing authority for generic Codex Flow
behavior. Its public GitHub `origin` is the canonical shared remote and history
protection point.

Source visibility is not an open-source license grant. npm publication remains
disabled by `package.json`'s `private` field, and package and plugin license
metadata remain `UNLICENSED`. Publishing the package, adding a license, or
declaring a supported public compatibility boundary requires a separate
decision.

The personal marketplace remains the supported private distribution channel.
An exact installed plugin version is consumer package authority under ADR 0010;
neither the GitHub repository nor a Git tag installs, refreshes, or upgrades a
consumer runtime.

Accepted package releases use immutable annotated tags named `v<semver>`. A
release tag identifies the exact accepted source commit whose packaged paths
produced the validated artifact. `v0.5.1` therefore peels to
`d03cabfffb612ad8f33853896b15deee3ad66698`, intentionally excluding later
handoff-only commits. `main` may advance beyond the latest accepted tag, but a
future accepted artifact whose packaged-path tree differs from `v0.5.1`
requires a new exact version and acceptance checkpoint.

ADR 0014 adds a source-validation guardrail for that rule: an annotated tag
for the current exact package version rejects tracked or untracked changes to
packaged paths. The next editable source identity is `0.5.2-dev.0`; it is not
an accepted distribution artifact and does not alter the accepted v0.5.1
consumer runtime.

Existing reviewed field-test and transition provenance remains intentionally
in public history after the bounded audit detected no credential. It grants no
runtime authority and does not authorize pilot contact or consumer adoption.
New evidence should prefer repository-relative paths and stable labels over
personal filesystem roots or raw host identifiers unless an exact value is
necessary for reproducibility.

## Rejected alternatives

- Keep the only remote private. The user deliberately selected a public source
  repository.
- Infer an open-source license from public visibility. Repository visibility
  and license rights are separate decisions.
- Treat GitHub as a public package channel. The accepted plugin-first private
  distribution contract remains sufficient.
- Tag the handoff tip as v0.5.1. The accepted package boundary is the earlier
  exact source tip, not later unpackaged project memory.
- Rewrite public history to remove the reviewed provenance retained after the
  bounded audit detected no credential. That would invalidate accepted commit
  identities without addressing an identified credential incident and could
  not retract existing clones.

## Consequences and guardrails

- Public readers can inspect the source, while supported package distribution
  remains private and exact-versioned.
- Release consumers can distinguish development `main` from an accepted tag.
- Accepted tags are never moved or reused. A correction receives a new version.
- Creating a tag does not trigger packaging, plugin installation, runtime
  migration, or adoption in UK Dev or any other consumer.
- Source validation refuses to reuse an annotated release version for changed
  packaged paths; version metadata equality alone is insufficient.
- Credential and user-data prohibitions remain unchanged. Field evidence must
  stay bounded and should minimize environment-specific identifiers.
