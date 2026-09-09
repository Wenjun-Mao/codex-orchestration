# ADR 0060: Bounded installed distribution identity

- Status: accepted for v0.9.10
- Date: 2026-09-08

## Context

The plugin updater stamps its manifest only. The installed v0.9.9 cache
therefore reported `0.9.9+codex.20260909011550`, while package metadata and the
runtime namespace correctly remained `0.9.9`. CLI admission, refresh-skill
authentication, and refresh target validation compared those distinct forms as
though both were source-release identities, blocking read-only refresh
inspection before normal admission.

## Decision

One pure identity module now distinguishes the two trust boundaries:

- Editable source and tagged releases require exact package and plugin versions.
- An installed package requires the exact semantic package version and accepts
  only an exact plugin version or `+codex.YYYYMMDDhhmmss` on that same version.
  The raw plugin value remains in refresh target evidence; the suffix is never
  stripped or used as a runtime namespace.

CLI admission, refresh authentication, and refresh target validation use the
installed rule. Source validation uses the strict rule. Package name, privacy,
managed payload hashes, loaded-skill path/digest validation, and exact tagged
source validation are unchanged.

## Consequences and guardrails

Wrong bases, arbitrary metadata, malformed cachebusters, and an unrelated
refresh skill fail closed. A stamped fixture must execute real `refresh inspect`
with its installed refresh skill; a raw `--version` result is insufficient.
The updater's observed 14-digit suffix is the only permitted distribution
transformation. Stable releases still require their own immutable tag and final
artifact verification.
