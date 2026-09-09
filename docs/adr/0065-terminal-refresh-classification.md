# ADR 0065: Authenticate reclaimed closed refresh history by terminal evidence

Status: Accepted for the source-only terminal refresh correction

Date: 2026-09-09

Refines: ADR 0045, ADR 0062

## Context

The shared refresh check authenticated every non-selected terminal run by
opening its historical checkout before it classified terminal state. A closed
run may have a legitimately reclaimed checkout after audited closeout, so this
reported Git `ENOENT` before the recorded settlement evidence could be read.
The same helper guards refresh inspection and source-namespace removal.

A run-closure audit contains a digest of the active lifecycle entry. Normal
closure subsequently changes that entry's status, terminal fields, and update
time. Replaying the active-entry digest against the closed entry would reject a
valid transition.

## Decision

Classify every non-selected run before opening its checkout. Non-terminal runs
and any run with terminal fences remain blocked. An abandoned run whose
checkout is absent remains blocked; absence never settles abandonment. A
closed run with a present checkout continues through the existing source
authentication and cleanup-plan path.

For a closed run with an absent checkout, accept only one typed,
terminal-ready run-closure audit bound to the current immutable run authority,
runtime, repository, workflow journal, and binding. The audit must have no
blockers or required cleanup, must precede the closed timestamp, and must
contain its matching active-lifecycle source record. This deliberately checks
the immutable authority plus the authorized audit-before-close transition; it
does not build a second general-purpose replay engine.

The run's activated workflow revision remains an admitted historical journal
revision. A lawful selector replan may advance the journal's current revision,
so settlement binds the audit's current revision to the journal's current
revision rather than requiring either value to equal the activation revision.

Closure audits are append-only evidence. Earlier blocked audits do not compete
with a later terminal-ready audit; settlement selects exactly one audit that
matches the current lawful authority. Multiple matching terminal-ready audits
remain ambiguous and fail closed. Selection never relies on timestamp order or
deletes historical audit records.

## Consequences and guardrails

Both inspection and source-namespace removal use the same classifier. The
classifier recognizes history only; it grants no deletion authority and leaves
the selected source's live authentication unchanged. Missing, malformed,
non-unique, mismatched, or tampered audit evidence fails closed.

Focused regressions cover a reclaimed closed task run through both consumers,
a reclaimed closed coordinator-local-work run, audit tampering, and an
abandoned run retaining a live Git fence, plus a reclaimed selector-replan
run and an earlier blocked audit followed by successful close. The repair is
source-only; release, installation, and historical namespace retirement remain
separate decisions.
