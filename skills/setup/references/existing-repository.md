# Existing Repository Adoption

Preserve project files, instructions, dirty work, active tasks, branches,
linked worktrees, ignored files, leases, and user-owned state. Do not stash,
reset, rewrite, commit, archive, or clean unrelated state. Codex Flow never
retroactively assumes authority for earlier tasks.

Authenticate the intended repository/common directory and use a clean,
reviewable adoption worktree when ongoing work would otherwise overlap. Keep
existing instructions outside the reviewed Codex Flow boundary unchanged.

If tracked v0.5 authority exists, stop before activation or adoption. The
current v0.6 development boundary has no tracked-v0.5 retirement operation;
`adopt retire-plan|retire-apply` retires only a tracked v0.6 adoption. Preserve
v0.5 package/cache identity, tags, exact-version Git-common state, and audit
evidence until a separately approved transition contract exists.

With a named active v0.6 run, run `adopt plan` and review the exact
`.codex/orchestration/v0.6/` write set, runtime bundle, configuration/policy,
and instructions. Apply only the unchanged plan, verify with `adopt status`
and existing repository checks, and integrate through the normal reviewed
path. Pre-adoption tasks finish under their original contract.

Permanent adoption and progressive run activation use the same engine.
Adoption itself does not authorize tasks beyond the active run's disclosed
workflow and host actions.
