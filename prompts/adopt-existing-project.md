# Adopt Codex Flow In An Existing Repository

Before pasting this prompt, replace every `{{...}}` placeholder with the exact
accepted package authority for the intended Codex Flow checkpoint.

---

Adopt Codex Flow for this existing repository without disrupting ongoing work.

Canonical package authority:

- Path: `{{CODEX_FLOW_PACKAGE_PATH}}`
- Commit: `{{CODEX_FLOW_PACKAGE_COMMIT}}`
- Version: `{{CODEX_FLOW_VERSION}}`

First authenticate that package checkout as clean and exactly at the named
commit and version. Do not use a different revision.

Adoption boundaries:

- Preserve all existing project files, instructions, dirty work, active tasks,
  branches, and worktrees.
- Do not migrate or assume ownership of tasks launched before this adoption.
- Do not stash, reset, rewrite, or commit unrelated user changes.
- Codex Flow becomes authoritative only for tasks launched after the adoption
  branch is integrated.
- Legacy branches and worktrees require a separate audit and must never be
  deleted merely because of their names.

Create a dedicated Codex Flow adoption branch from the clean authoritative
default branch. If the current checkout is dirty, leave it untouched and create
a clean linked worktree from the committed default branch. Stop if no clean
authoritative baseline can be established safely. Create the branch before
planning because the plan ID is branch- and revision-bound.

Inspect the repository's existing `AGENTS.md` and process validators. An
`AGENTS.md` containing project-specific development conventions is not an
equivalent Codex Flow contract, so normally use managed AGENTS mode; it must
preserve all existing content and add only the bounded managed block. Use
external AGENTS mode only when an explicitly reviewed equivalent orchestration
contract already exists and a human has authorized its attestation. Never infer
equivalence merely because an instruction file exists.

Before product changes:

1. Run canonical `init --plan --json`. Planning must be read-only.
2. Inspect the exact write set, `AGENTS.md` before/after result, and conflicts.
3. If conflict-free, apply that exact unchanged plan ID. Otherwise stop without
   writing and report the smallest compatibility decision.
4. Run canonical `init --check` and the pinned `.codex/orchestration` doctor.
5. Run the repository's existing process validators and proportionate tests.
6. Confirm the final diff contains only the planned Codex Flow runtime,
   configuration, instruction integration, and any explicit adoption record.
7. Commit and integrate through the repository's normal reviewed path. Never
   integrate an adoption that weakens or fails an existing repository contract.

After adoption is integrated, run:

```bash
node .codex/orchestration/bin/codex-flow.mjs task start --role coordinator
```

All newly delegated tasks use the pinned coordinator/executor workflow and
default to `gpt-5.6-terra` with `xhigh` reasoning, supplied as actual host-tool
arguments. Current pre-adoption tasks finish under their original contract and
must not be retroactively journaled, integrated, archived, or cleaned by Codex
Flow. New waves require validated ownership and dependency maps, journaled
ordinary completion, serial integration and reproof, and coordinator-owned
cleanup.
