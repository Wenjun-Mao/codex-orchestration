# ADR 0070: Classify reclaimed history from owning durable authorities

Status: Accepted for the v0.9.12 historical-settlement consolidation

## Context

Refresh inspection selected the newest terminal run before it established
whether that run still required executable source. A normally reclaimed
coordinator therefore reached Git authentication with its recorded, now absent
worktree as `cwd` and failed with `ENOENT`. The missing checkout was expected;
the defect was treating source location as a prerequisite for classifying
already-settled history.

A closure audit alone is insufficient. It proves that one execution could close,
not that its outer assignment was accepted and retired, its report route and
locator were retired, its iteration resources were reclaimed, or its result is
still preserved. Conversely, a missing assignment record cannot prove that an
execution was intentionally standalone.

## Decision

Use one invocation-local, read-only predecessor classification before choosing
an executable refresh source. It has three outcomes:

- `settled-history`: every run in the namespace is a closed, fully authenticated
  historical execution and no recorded checkout remains live;
- `live-source-required`: at least one run still has an authenticated live
  checkout and all absent siblings are independently settled;
- `blocked`: an active or abandoned run lost its checkout, terminal fences or
  obligations remain, or any required authority is missing, ambiguous, or
  inconsistent.

Modern assignment-backed settlement composes facts owned by their existing
modules. The run lifecycle, runtime context and bundle, admitted workflow
journal, and unique terminal-ready audit must agree. Exactly one retired
assignment must contain the exact execution binding and released runtime
retirement. Registration must have reached readiness; its accepted report,
director acceptance, closed route, locator retirement, and closed iteration
must agree. The effective coordinator worktree and disposable branch must be
absent, no attachment owned by that task may remain, and the captured result tip
must be an ancestor of the currently authenticated primary worktree.

The iteration registry owns the read-only resource-absence and authenticated-
primary checks. It resolves any authenticated coordinator binding correction
for cleanup ownership instead of forcing that effective resource identity to
equal the historical execution root and branch. It proves both the later archive
capture and the exact audited result are retained by primary; neither observation
is required to contain the other. Assignment authority owns validation of a
retired assignment against its route and exact execution binding. Refresh only
joins their returned facts with run and audit authority. No settlement record or
cache is written.

All runs in every supported candidate namespace are classified before selection.
If live source is required, the existing source exporter, baseline, cleanup, and
namespace-removal contracts remain strict. Existing v0.8 and exact v0.9.7
compatibility readers retain their narrower rules. A reclaimed modern run with
no exact retired assignment blocks; a legitimately standalone run remains usable
through its live-source path while its checkout exists.

Inspection is advisory. Ordinary activation repeats the classification while
holding the existing repository admission lock and before target runtime or
workflow preparation. An existing refresh handoff takes precedence: unrelated
ordinary activation fails without changing either the handoff or target state.

`refresh prepare` may name one exact settled run using `source_resume: null`,
empty decisions and replacements, no target workflow, and empty target fences.
When every predecessor is settled and no handoff exists, it exits successfully
with `kind: codex-flow-refresh-v1-preparation`, status
`fresh-start-required`, `mutation_performed: false`, and a `run activate` next
action whose `refresh_id` is null. It does not create a handoff or alter history.

Refresh-ID admission has two additional transaction boundaries. First admission
revalidates every unrelated predecessor namespace while holding the repository
lock; the handoff source keeps its source-specific removal proof. For an
assignment-backed source, the exact assignment lock persists the target binding
first and remains held through target preparation and run admission. Cancellation
that wins the lock therefore blocks before target state, while cancellation that
runs later sees the durable target obligation even if admission was interrupted.
Standalone refresh remains permitted only when no assignment authority for the
exact source execution exists.

The runtime owner also compares the target checkout's current root, common
directory, branch, revision, and cleanliness with the derived runtime authority
immediately before first target preparation. This closes the interval between
the command's initial Git snapshot and locked preparation without claiming a
global lock against arbitrary external Git writers.

## Rejected alternatives

- Recreate a deleted checkout or run the historical exporter from primary. This
  fabricates live infrastructure and can authenticate the wrong revision.
- Treat any closed run or terminal audit as globally complete. This omits the
  assignment, reporting, iteration, locator, and preservation owners.
- Require namespace deletion through a no-op refresh. Fresh-admission permission
  does not grant deletion permission, and settled records are useful evidence.
- Add a persisted `settled` flag. It would duplicate mutable preservation and
  attachment facts and introduce another lifecycle to reconcile.
- Treat a cancelled source as standalone because open-assignment lookup returns
  nothing. Terminal assignment state is evidence that must fail closed, not
  evidence absence.

## Consequences and guardrails

Lawfully reclaimed assignments can permit fresh work across multiple retained
namespaces. Candidate-emitted records use the same v1 owner contracts and can be
consumed by a later stable identity. Missing, tampered, ambiguous, incomplete, or
unpreserved evidence fails closed. Tests cover a frozen v0.9.11 two-assignment
producer, non-mutating preparation, candidate completion and reclamation, a
two-namespace stable rehearsal, standalone refusal, and pending-handoff
precedence. Adversarial coverage also fixes cancellation between apply and
activation, unrelated-history drift at refresh-ID admission, independently
preserved audit/archive tips, and clean target Git drift before preparation.
