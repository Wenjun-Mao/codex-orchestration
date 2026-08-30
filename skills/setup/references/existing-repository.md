# Existing Repository Adoption

Preserve project files, instructions, dirty work, active tasks, branches,
linked worktrees, ignored files, leases, and user-owned state. Do not stash,
reset, rewrite, commit, archive, or clean unrelated state. Codex Flow never
retroactively assumes authority for earlier tasks.

Authenticate the intended repository/common directory and use a clean,
reviewable adoption worktree when ongoing work would otherwise overlap. Keep
existing instructions outside the reviewed Codex Flow boundary unchanged.

If accepted tracked v0.5.1 authority exists, activation and adoption remain
blocked until it is explicitly retired. Use `adopt legacy-retire-plan` without
a run ID and review its exact manifest/configuration/managed-instruction
operations, predecessor settlement result, retained resources, and raw
`.git/codex-flow/v0.5.1/` digest. Use `legacy-retire-apply` only with that exact
unchanged plan after separate approval. It makes no commit, performs no Git or
task cleanup, and does not activate v0.7. Other predecessor versions fail
closed.

`adopt retire-plan|retire-apply` remains specific to tracked v0.7 adoption; do
not substitute it for predecessor retirement.

With a named active v0.7 run, run `adopt plan` and review the exact
`.codex/orchestration/v0.7/` write set, runtime bundle, configuration, and
structured policy. Reject any ordinary adoption plan that reads or writes
`AGENTS.md` or creates a tracked instruction file. Apply only the unchanged
plan, verify with `adopt status` and existing repository checks, and integrate
through the normal reviewed path. Pre-adoption tasks finish under their
original contract.

Permanent adoption and progressive run activation use the same engine.
Adoption itself does not authorize tasks beyond the active run's disclosed
workflow and host actions.
