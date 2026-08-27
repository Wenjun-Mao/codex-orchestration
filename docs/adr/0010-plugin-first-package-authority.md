# ADR 0010: Plugin-First Package Authority

Status: Accepted

## Context

Codex Flow originally required operators to paste one of two long onboarding
prompts after substituting a canonical checkout path, Git commit, and package
version. That transported policy manually, consumed context, and could select
stale authority even though the package already had a Codex plugin manifest and
progressively loaded lifecycle skills.

## Decision

Beginning with v0.5, installing a specific private `codex-orchestration`
plugin version is explicit acceptance of that package. The plugin's `setup`
skill is the only interactive onboarding entrypoint. It resolves the canonical
CLI from its installed plugin directory and routes to internal new-repository
or existing-repository references.

The canonical CLI validates exact package, plugin, and runtime version metadata
before planning. Installation plans continue to bind every managed target file
by hash. Repositories pin the runtime and instruction integration locally;
installing a newer plugin does not update them. Another pinned package version
requires explicit retirement and fresh installation. Operational records use
the fresh `.git/codex-flow/v0.5/` namespace.

Implicit skill discovery is permitted, but mutation requires an unmistakable
user request to set up, bootstrap, install, or adopt Codex Flow. Questions and
ambiguous non-Git directories remain read-only.

## Rejected Alternatives

- Keep copy-paste prompts: rejected because they duplicate plugin instructions
  and make authority substitution an operator task.
- Require a canonical Git checkout for every adoption: rejected because the
  explicitly installed plugin is already the selected distribution artifact.
- Add a release service, daemon, MCP server, or hook: rejected because local
  skill guidance and the dependency-free CLI cover the workflow.
- Migrate prior runtime or journal state: rejected under the private
  pre-release breaking-change policy.

## Consequences

Users install the private plugin once, then use a short natural-language request
or `$codex-orchestration:setup`. The package no longer ships operator-facing
prompt templates. Personal marketplace installation becomes the primary Codex
distribution path; direct CLI execution remains a headless fallback.

