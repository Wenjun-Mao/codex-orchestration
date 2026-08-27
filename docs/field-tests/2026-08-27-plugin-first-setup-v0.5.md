# Codex Flow v0.5 plugin-first setup acceptance

## Authority and scope

The accepted behavioral candidate is source revision
`fce00937d86809ee4b8b1bdda86eff1c9ad51b74` on
`codex/plugin-first-v0.5.0`. It declares package, plugin, and runtime version
`0.5.0` and was installed privately as `codex-orchestration@personal` at
`/Users/wjmao/.codex/plugins/cache/personal/codex-orchestration/0.5.0`.
The source repository has no remote; acceptance is local and private.

The final candidate passed all 94 dependency-free Node tests, the source
validator, setup-skill validator, plugin validator, package dry run, and diff
checks. The dry-run package contained 85 files. No daemon, MCP server, hook,
background service, compatibility reader, or automatic v0.4 replacement was
introduced.

## Held-out setup results

Final new-repository task `01a04425-79c1-7980-8054-5ab20bab13ed` used one
natural-language setup request in a disposable unsaved repository. This was an
explicit projectless exception; the task itself ran as `gpt-5.6-terra` with
`xhigh` reasoning. It preserved the supplied README, established baseline
`af04de0`, installed and integrated v0.5 at `23fa983`, selected stable project
ID `codex-flow-v05-heldout-new-repo-v2`, and left clean `main` with no setup
branch or extra worktree. Canonical `init --check` and pinned `doctor` passed.

Final existing-repository task `01a04421-98d6-7b23-a762-6d5d4540c176` used one
natural-language adoption request against a disposable dirty Python repository.
It ran as Terra/xhigh, created clean adoption/integration worktrees from the
authoritative baseline, and integrated v0.5 on `main` at `08d2c1c`. The final
project ID is `existing-python-v2`, not a worktree-derived suffix. The only
remaining worktree is the original `work-in-progress` checkout. Its three
pre-adoption hashes remained exact:

- `AGENTS.md`: `aeb41a011ff6ee5825efd222b72449eaf3dc61bb7127ce5c0e7d3d48e4c8c027`
- `pyproject.toml`: `fbf8cbaabe51267cee92be36391e518066bf8d79dc1dc8a848d0b5b6855bcd81`
- `ongoing-notes.txt`: `8b6740d8892cb5d0e8391450093373445b02ed2e2cb617f8b4f55c7b7e1fd387`

No pre-adoption task or Git state was migrated into Codex Flow. A clean detached
proof of `main` passed canonical `init --check`, pinned `doctor`, and Python
compilation. Ruff was unavailable and the fixture intentionally had no tests.

Negative-control task `01a04417-d34a-7301-8aff-8ce4a4d104fb` received only an
unrelated README-summary request. It read the README, did not activate setup,
and left the clean repository without `AGENTS.md` or `.codex/orchestration`.

Explicit-invocation task `01a0442b-38a0-7550-8437-78d5d1e8ba71` used
`$codex-orchestration:setup` in a fresh task. It resolved the canonical plugin
through `skills/setup/scripts/resolve-plugin-root.mjs`, ran `init --check` and
`doctor`, found no drift or warnings, and left `new-repo-v2` byte-clean at
`23fa983`.

All completed review and held-out tasks were archived after their results and
repository cleanup were preserved.

## Defects found by the field loop

The first dirty-repository trial exposed a derived project ID containing the
temporary adoption-worktree suffix. v0.5 now requires an explicit stable
`--project-id` in both setup plan and apply; omission fails during read-only
planning, and regression coverage asserts the installed identity.

The first explicit verification trial initially shortened the resolver path to
an absent `<plugin-root>/scripts` location before recovering. The setup skill
now gives the exact skill-directory command and explicitly names the packaged
`skills/setup/scripts/` path. A fresh task then passed without the mistake.

The setup trials also exposed retained merged bootstrap/adoption branches.
Both setup references now require post-integration removal of only proven-clean,
proven-merged setup worktrees and branches, followed by inventory reinspection.

## Acceptance

Codex Flow v0.5 is accepted for private plugin-first setup in new repositories
and adoption by existing repositories. Existing v0.4.x installations and active
tasks are not upgraded or migrated automatically.
