# Review addendum: coordinator committed-write scope

Status: new diagnostic evidence for external review, not an approved expansion
of the retained-obligation implementation plan.

Read alongside `docs/plans/2026-09-11-retained-obligation-settlement.md` and
`docs/research/2026-09-11-retained-obligation-review-context.md`. Those documents
were first published at `56894228597bb04445828f144aa471fc7803fb13`.
This addendum does not supersede their evidence or merge the two incidents.

## New observation

An ordinary Plotloom assignment under v0.9.12 explicitly required a verification
ledger. Its admitted run envelope and coordinator task write set omitted the
ledger directory. A subsequent workflow revision correctly rejected that path:

`Workflow write path is outside the admitted run fence envelope: docs/verification`

The project director then reported read-only evidence that the file had already
been committed during this run, rather than inherited from its baseline:

- Baseline: `0649afdb39b3a88397a43a5a75714bebb302f55b`.
- Adding commit: `bb523ae98db93ed1e9c60dcc37730af8c4c37323`.
- Added path: `docs/verification/2026-09-10-provider-readiness-offline-candidate.md`.
- Clean candidate: `564862b78508354a019a46f24158224f76dca731`.
- Both admitted envelope and task write set: `docs/adr`, `docs/roadmap`,
  `frontend`, `src/plotloom`, `tests`.

Despite that reported scope violation, the pinned v0.9.12 closure audit returned
`terminal_ready: true`, `blockers: []`, with expected/current HEAD equal to the
candidate. Audit ID:
`run-closure-audit-v1-232298ab66ef41888db5bb8711ff4c3dfa42b94a02373a9f0016b0cb5615aa47`.
Reported counts: one coordinator-work record, one workflow claim, one task,
zero integrations and zero ordinary verification records. Coordinator-local
verification is a separate mechanism; zero ordinary verifications alone is not
evidence that no checks ran.

The run has not been closed or abandoned and the assignment has not been
accepted/cancelled as recovery. The clean commit chain and checkout remain
preserved. These pilot facts are a bounded report from its director, not a
public raw-journal reproduction. The plugin director has not independently
reproduced the incident. The listed commits belong to the pilot repository,
not this plugin repository. Do not assume access to their source contents.

## Preliminary code inspection, not a complete diagnosis

In `lib/coordinator-work.mjs`, completion records baseline/final revisions and
supplied verification checks. In `lib/run-audit.mjs`, the coordinator claim
branch checks completion of the claim/operation, while repository validation
checks expected Git identity and cleanliness. Initial inspection did not reveal
an actual changed-path comparison at those points. Called helpers and other
boundaries have not been exhaustively traced; reviewers must verify the full
path before concluding the check is absent everywhere.

The two candidate defects are distinct:

1. **Existing review:** an abandoned run's genuinely resolved obligations cannot
   complete ordinary settlement and coordinator retirement.
2. **New finding:** coordinator work may be certified terminal-ready despite
   committed changes outside declared write authority.

User intent authorized the ledger, but that does not make its admitted runtime
authority include the path. Diagnose the planning omission, execution behavior,
and validation coverage separately. Do not retroactively widen the envelope or
use settlement to convert an invalid execution into a valid one.

## Additional review questions

Keep your original review mandate; add a bounded examination of this finding:

- Does the public coordinator completion/audit path enforce committed write
  scope? Where should the smallest durable check live, and which consumers
  should reuse its evidence rather than duplicate an audit engine?
- What constitutes the correct comparison basis: coordinator operation baseline,
  task contract, admitted run, intermediate commits, or another existing record?
  Account for valid integrated child changes without falsely attributing them
  to the coordinator's own write set. Identify whether transient committed
  violations reverted by the final tip matter to the promised contract.
- What minimal real-Git/public-CLI test would reproduce this case? Include a
  legitimate in-scope control and identify necessary rename/deletion or other
  path-boundary cases without prescribing an exhaustive new framework.
- Can the proposed retained-obligation settlement remain safe in the presence
  of this finding? Distinguish truthful retirement of failed work from accepting
  that work as compliant, and explain how suspect existing PASS/audit evidence
  should be treated without invalidating unrelated historical records blindly.
- Does this require a prerequisite fix, a separately bounded companion change,
  or further evidence before altering the plan? Recommend exact amendments,
  not an automatic broad redesign.

Please separate source-confirmed facts, reported pilot facts, hypotheses, and
recommended contracts. Return the smallest decisive reproduction and any impact
on your original plan recommendation. No implementation or live recovery is
authorized by this addendum. Plotloom's older v0.9.8 wrong-root incident remains
out of scope; this is a different v0.9.12 assignment.
