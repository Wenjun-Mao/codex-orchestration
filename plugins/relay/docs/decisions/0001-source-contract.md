# 0001 — One source permission, immutable supporting facts

Accepted for the bounded source candidate; native qualification remains separate.

The failure to prevent is an ownership gap between an executor release and its
coordinator's verification reservation, or a delayed report reinterpreting an old
result against a new checkout. Replaying historical lifecycle engines also made
retained-checkout successors depend on obsolete HEADs and resource deletion.

Use `<git-common-dir>/relay/control.json` as the sole ownership commit point. Its
monotonic generation and exact assignment/actor/mode/checkpoint authorize work.
Assignment revisions are immutable files, fsynced before atomically replacing and
fsyncing the control pointer. Control contains record references, not duplicate
outcome projections. Unreferenced precommit facts grant nothing. Admission reads
current control and relevant dependencies; no historical source replay occurs.
No package-version namespace or migration engine is introduced.

A short exclusive-create lock serializes local transitions. It is never reclaimed
automatically. Explicit lock removal requires all competing commands stopped and
an exact token; this external quiescence condition is essential, since check then
unlink is not a compare-and-swap. Recovering a lock cannot establish source-writer
quiescence. Source permission is cooperative, not filesystem enforcement.

Reporting setup is part of the assignment before enablement. Source release seals
producer/result/sender/recipient/correlation together with the control transition.
Final capture may be later. Native attempts are persisted before exposing a send or
archive request; an uncertain attempt gets observation, never an automatic retry.
Transport acknowledgement, exact receipt, acceptance and archival remain separate.
Never-enabled revocation is distinct from stopped-writer source disposition.
Rejected preserved source needs explicit baseline approval; it is never acceptance.

Direct verification checks every intervening commit (including reverted violations),
ancestry, clean branch and exact revision. Recorded argv checks produce evidence;
model-authored PASS data is not an input. Source/index/ref endpoint drift invalidates
the check. This does not detect transient writes that restore their endpoints.
Ignored build artifacts are outside the tracked/untracked source snapshot; this
limitation does not authorize background source writers.

Rejected alternatives: separate release/verification writes (ownership gap), copying
Flow locks or lifecycle imports (unsafe stale recovery and dependency coupling),
versioned state directories (parallel authority), and a native private-IPC adapter
without host evidence. Guards are connected real-Git/CLI journeys, crash/replay and
lock exclusion tests, exact reporting tests, and relocated package checks.

Native adapter inputs are trusted cooperative observations in this source stage.
They are not authentication or proof of actual native delivery. The future native
gate must validate the saved project/checkout, identity/provisional correlation,
finishing-event correlation, queue observation and recipient-visible bytes before
using the package for live work. No host behavior was guessed to complete the slice.

The bounded source review found that an aggregate baseline alone allowed a resumed
coordinator to discard an accepted executor checkpoint. Every write operation and
resume now also requires ancestry from the current generation's checkpoint. The
original baseline remains only the aggregate scope boundary. Verification respects
an existing recipient rejection instead of overwriting that product decision.

Lost prepare/handoff output is recovered through current-authority discovery,
without replaying a native request. Recovery authority is the creating actor in
both the permission record and public response. Failed aggregate recovery records
a source disposition with the resolving actor and known contributors; it does not
claim the coordinator produced the executor's rejected commits. Dedicated regressions
cover these review-derived contract corrections.

A coordinator assignment retains the ordered IDs of every sequential executor it
created. Task retirement checks only those child assignments whose frozen report
recipient is the task being retired. Any missing exact receipt preserves that
recipient and returns the next action for the first unresolved child. This is an
assignment-local archival obligation: it never restores source permission or blocks
an unrelated successor from using the approved clean checkpoint.
