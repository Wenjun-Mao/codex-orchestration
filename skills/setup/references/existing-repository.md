# Existing Repository Adoption

Preserve project files, instructions, dirty work, active tasks, branches,
linked worktrees, ignored files, leases, and user-owned state. Do not stash,
reset, rewrite, commit, archive, or clean unrelated state. Codex Flow never
retroactively assumes authority for earlier tasks.

Authenticate the intended repository/common directory and use a clean,
reviewable adoption worktree when ongoing work would otherwise overlap. Keep
existing instructions outside the reviewed Codex Flow boundary unchanged.

If tracked v0.5 authority exists, stop before adoption. Present
`adopt retire-plan` separately. Apply `adopt retire-apply` only after explicit
approval and preserve v0.5 package/cache identity, tags, exact-version
Git-common state, and audit evidence. Do not interpret retirement as permission
to delete branches, worktrees, callbacks, or user files.

Then run `adopt plan` and review the exact
`.codex/orchestration/v0.6/` write set, runtime bundle, configuration/policy,
and instructions. Apply only the unchanged plan, verify with `adopt status`
and existing repository checks, and integrate through the normal reviewed
path. Pre-adoption tasks finish under their original contract.

Permanent adoption and progressive run activation use the same engine. Do not
launch tasks until a later actionable request activates a named run and
discloses its workflow and host actions.
