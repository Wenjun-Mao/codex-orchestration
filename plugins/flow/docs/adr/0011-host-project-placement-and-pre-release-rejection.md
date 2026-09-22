# ADR 0011: Host project placement and pre-release rejection

## Status

Accepted.

## Context

The first v0.5 UK Dev pilot passed installation and created exactly one
bootstrap-only task with the saved UK Dev project ID. The host accepted that
target and returned a UK Dev worktree, but subsequent list and read surfaces
returned `projectId: null` or omitted project placement. Archived listings do
the same for other known project-backed tasks. This is missing observation, not
proof that the host placed the task elsewhere.

Codex Flow recorded same-project placement only as coordinator guidance. Its
task operation retained repository, title, model, visibility, and worktree
evidence, but not the requested Codex App project. It therefore could neither
distinguish accepted-but-unobservable placement from an observed mismatch nor
state the limitation durably.

The coordinator safely archived the inert task and removed its pristine
unbound worktree. The operation still remained `observed`, so doctor and
cleanup continued to report an unresolved unbound worktree at an absent path.
The journal also lacked a terminal state for an object rejected before Git
binding and objective release.

## Decision

Every task operation binds one explicit host-placement intent before dispatch:

- `same-project` names the coordinator's exact saved Codex App project ID;
- `cross-project` names an exact target and a bounded reason;
- `projectless` records a bounded exception reason and no project ID; and
- `inherited` is reserved for a hidden subagent whose host context is inherited.

Host capability evidence states whether the adapter can express that placement.
A required project target that is unsupported or unverified stops before the
host call.

Successful reconciliation records project placement independently from the
repository execution path. `host-observed` is complete evidence. An exact
`host-accepted` target is allowed when the creation call accepted the request
but list/read omit placement; it remains explicitly partial and must never be
reported as independently observed. A non-null observed or accepted mismatch
is rejected. Projectless and inherited operations reject any non-null project
placement.

An observed operation may be closed as `rejected-before-release` only while it
has no Git ownership. The coordinator must first archive the host object. For a
host-created worktree, the CLI also verifies that the exact observed path is
absent. The journal then preserves a strict reason, archive assertion, verified
path disposition, and timestamp. When binding was interrupted after its branch
claim but before ownership, rejection may settle that claim only after proving
the path absent and the local branch unowned, unchecked out, free of fetched
remote-tracking evidence, and still at the exact baseline if present. It
conditionally deletes that exact ref and embeds the immutable claim plus the
verified absent-ref state in the terminal resolution. The receipt deliberately
does not attribute deletion across crash recovery; drift remains blocked. Exact
replay is idempotent; conflicting replay, retry, Git binding, and objective
release are rejected. Doctor and cleanup keep the terminal evidence but stop
classifying it as an unresolved unbound task or incomplete claim.

The affected packet, operation, capability, and observation schemas advance
without compatibility readers or state migration. A pre-v0.5.1 operation must
be retired or preserved under its original runtime.

## Rejected alternatives

- Treat `projectId: null` as proof of wrong placement. Current host listings
  omit the field for known project-backed tasks.
- Treat a successful targeted create call as host-observed placement. It proves
  request acceptance, not independent post-create observation.
- Keep placement only in prose. The pilot showed that guidance cannot support
  reconciliation or audit.
- Delete or rewrite the old observed operation after cleanup. That would erase
  the failed pilot and make cleanup unauditable.
- Ignore or delete an interrupted branch claim. A terminal settlement instead
  retains the original claim and proves the local ref absent after any safe,
  exact-baseline cleanup.
- Add a daemon or host adapter service. One extra intent/evidence field and one
  terminal journal transition are sufficient.

## Consequences

- Same-project placement becomes a fail-closed operation contract rather than
  coordinator memory.
- Current Desktop tasks may legitimately retain partial placement evidence
  until list/read expose the selected saved project.
- A real non-null placement mismatch stops before Git ownership or objective
  release.
- Failed bootstrap objects can be archived and settled without weakening the
  warning for genuinely unresolved observed worktrees.

## Acceptance evidence

A fresh UK Dev v0.5.1 held-out replay exercised exact-release state isolation,
same-project task creation, Git bind and release, journal completion, serial
integration and reproof, deterministic branch/worktree cleanup, and task
archival. The older v0.5 state remained byte-identical throughout. Current host
list/read surfaces still omit project, model, and reasoning fields, so those
facts remain host-accepted rather than independently observed.
