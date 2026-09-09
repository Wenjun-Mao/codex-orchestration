# Terminal refresh classification

Status: Approved under the director's standing authority for bounded corrections.

## Outcome

Refresh must distinguish an authenticated, settled historical run whose checkout
was legitimately reclaimed from unresolved work. It must not fail with a raw Git
ENOENT before making that distinction. Published v0.9.10 remains immutable.

## Root cause and scope

The shared historical-run check opens each source checkout before classifying
terminal state. Reclamation is valid after closeout, so the checkout is not a
permanent prerequisite for interpreting settled history. Correct this shared
boundary used by inspection and namespace-removal validation, not each caller.

Reuse existing runtime and typed closure-evidence validation. Do not add a generic
audit replay engine: the audit's run-activation digest describes the active run,
while normal closure legitimately changes its terminal fields. Missing or
contradictory evidence must remain a clear blocker.

## Checkpoints

1. Establish a supported fresh execution authority before implementation. Do not
   reopen the closed stable-finalization run, extend its immutable assignment,
   retire referenced state, or mutate journals to unblock the repair. If no normal
   route exists, report that exact constraint before taking an exceptional path.
2. Implement the smallest shared classification correction and focused fixtures.
   Authenticate settled closed history without requiring its reclaimed checkout;
   preserve selected/active-run authentication and existing live-checkout checks.
3. Exercise both inspect and removal-safety consumers against the same evidence.
   In this repository the abandoned RC5 run still has retained fences: exposing
   that genuine blocker is correct, not a failed test or permission to erase it.
4. Independently review the change and repeat only affected live segments. Run
   broader verification once on the final candidate. Any release uses a new
   version and exact artifact; do not publish or reinstall intermediate changes
   merely to test pure classification.

## Acceptance

- Closed reclaimed executor and coordinator-local-work cases classify correctly
  with authenticated settlement evidence.
- Active/missing, abandoned retained-fence, closed unresolved-fence, missing or
  tampered evidence, and mismatched repository cases fail closed with useful errors.
- Normal terminal transitions do not invalidate their pre-close audit merely
  because status, terminal, or update fields changed.
- Inspection and removal safety agree; recognizing history does not itself grant
  deletion authority. Old journals and unrelated resources remain untouched.
- Record the root cause, focused regression results, and remaining genuine
  blockers. Do not claim a clean start until the whole path actually succeeds.

## Boundaries

No new registry, daemon, arbitrary predecessor compatibility, AGENTS.md access,
pilot work, broad cleanup, force deletion, or waiver of retained fences. Runtime
repair and any one-time historical retirement are separate decisions. Escalate
only an authority expansion or materially larger design; routine breakdown and
verification choices remain with the coordinator.

## Approved execution exception — 2026-09-09

The user approved a one-time source-only repair outside Flow's run lifecycle
after read-only checks proved that all linked checkouts share the blocked common
directory. The existing delivery coordinator may implement this plan in its own
clean checkout, on a new repair branch, without activating or reopening a Flow
run. This is a separate repair authorization, not an amendment to the closed
stable-finalization run or its immutable assignment.

Limit writes to source, focused tests, and concise decision/verification records.
Use ordinary Git checkpoints; do not modify historical journals, route bindings,
or cleanup state. Report the repair explicitly as source-only, by a direct message
if needed; any incidental hook delivery does not make it old-assignment work.
Obtain independent read-only review before release. Return the reviewed source
checkpoint and actual classification results first; installation, historical
retirement, and resumption through normal Flow authority are subsequent steps.
