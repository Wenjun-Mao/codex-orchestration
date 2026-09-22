# Codex Flow v0.5 coverage

v0.5 replaces copy-paste onboarding with an installed private plugin and one
progressively disclosed setup skill. The installed plugin is the accepted
package authority; repositories still pin an auditable runtime and keep all
mutable coordination state in their Git common directory.

## Covered

- Natural-language setup, bootstrap, installation, and adoption requests route
  to `codex-orchestration:setup`; explicit invocation remains available.
- Skill discovery alone is not mutation authority. Questions and unrelated
  project work do not authorize setup.
- Package, plugin, and runtime metadata must all equal the selected release
  before planning.
- The setup root resolver authenticates the installed cache path without a
  package checkout, global npm installation, or user-supplied placeholder.
- New and existing setup modes bind plan and apply to their exact dedicated
  branch, a clean worktree, and an explicit stable project ID that cannot be
  inherited from a disposable adoption worktree name.
- Managed AGENTS integration preserves existing content. External mode remains
  an explicit, hash-attested exception for an equivalent reviewed contract.
- A different installed version requires explicit retirement. Setup, sync,
  doctor, and operational commands cannot create or use the current release's
  state through an older runtime.
- Copy-paste prompt templates are absent from source validation and package
  contents.
- The complete v0.4 orchestration lifecycle remains available in v0.5's
  exact-release state namespace; no old operational journal is migrated.
- Project-backed visible executors default to the coordinator's same saved
  Codex App project. Projectless creation is an explicit recorded exception
  for repositoryless work or an unsaved disposable fixture.
- A coordinator archives a terminal visible task by default only after its
  result, callback disposition, and owned Git/worktree cleanup are preserved;
  blocked or attention-needed tasks stay visible.

## Not claimed

- No daemon, MCP server, hook, background process, compatibility reader, or
  automatic repository-runtime upgrade.
- No ownership or migration of tasks, branches, or worktrees that predate an
  existing-repository adoption.
- No mutation of a populated ambiguous non-Git directory.
- Installing a newer plugin does not silently rewrite an older repository.

## Verification boundary

Source acceptance requires the complete dependency-free Node test suite,
source validator, skill and plugin validators, package dry run, and diff checks.
Release acceptance additionally requires fresh-task personal-marketplace
trials for a blank repository, a dirty Python repository with existing
instructions, and an unrelated-request negative control. Field results are
recorded in
[the v0.5 plugin-first setup acceptance](field-tests/2026-08-27-plugin-first-setup-v0.5.md).
