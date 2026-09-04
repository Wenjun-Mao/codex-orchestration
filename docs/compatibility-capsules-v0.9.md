# v0.9 finite compatibility register

Compatibility is finite and evidence-bound. A retained capsule addresses one
named host or immediately preceding release gap; it is not a tolerant runtime
reader, journal migration framework, or silent fallback.

| Capsule | Narrow authority | Failure behavior | Compatibility exit condition |
| --- | --- | --- | --- |
| Authenticated v0.8 semantic refresh export | Invoke the exact source snapshot to validate and export one bounded semantic handoff for a long-lived coordinator. v0.9 receives task briefs, dependency topology, baseline, and cleanup evidence; it never parses v0.8 journals. | Unsupported version, malformed export, runtime drift, task/archive disagreement, or Git ambiguity blocks before target activation. | Retire when supported long-lived coordinators no longer retain v0.8 runs, following a separately reviewed compatibility checkpoint. |
| Provisional-to-ready mapping | Read the registered forward/reverse App mapping only for an exact provisional task that never produced an executor start claim, so that task can be archived. | Zero, multiple, mismatched, or contradictory candidates remain unresolved; the capsule cannot activate work or authorize another creation call. | Retire when the public task API returns or resolves an operation-bound ready ID reliably enough for archival. |
| Private archive observation | Confirm that one exact task is archived and has no active session when public archive indexing is delayed or incomplete. | Conflicting active state, duplicate archive records, task mismatch, or unreadable evidence blocks archival reconciliation. | Retire when public archive status supplies the same exact positive and negative evidence consistently. |

## Admission rule

Any proposed capsule must name:

1. the exact host or predecessor gap;
2. the minimum authority it needs;
3. the typed evidence it returns;
4. its fail-closed cases;
5. a focused fixture or live acceptance result; and
6. a removal trigger.

Capsules may not mutate private App records, infer identity from title/project,
retry a native operation, migrate predecessor journals, or leak App-private
vocabulary into the governance core.

## Explicitly retired from current authority

- the exact v0.7.8 refresh bridge;
- the v0.8.1 private-resolution recovery bridge;
- bootstrap-only visible-task creation and its release lifecycle; and
- current-package readers or mutators for v0.7 and older workflow state.

Immutable tags preserve historical behavior and evidence. Unsupported retained
state uses explicit archive/finish through its authenticated source runtime or
the repository-scoped unplug lifecycle; v0.9 does not reinterpret it.
