# 0007 — Missing task disposition and idle baseline adoption

Accepted for 0.3.4.

Revocation released source permission but left an impossible archive obligation
for a never-created task; direct retirement could even generate a null target.
Separately, normal director commits between assignments invalidated the approved
checkpoint while recovery required a ticket that no longer existed.

Use explicit `dispose-uncreated` for revoked, never-enabled, unobserved creation.
The creating actor affirms the exact action was never invoked. Absence of evidence
alone is insufficient. Record `not-created`, never `archived`; parent settlement
recognizes either truthful terminal case. Prevent later native binding and refuse
identity-less native actions. Retain old malformed idle-check history unchanged.

Use explicit `adopt-baseline` under the existing lock for idle, clean, same-checkout,
same-branch forward commits. Require expected old/current revisions, actor, stopped
writers and reason. Update only the approved checkpoint and latest adoption note;
preserve task/assignment facts and pending cleanup. This cooperative director
decision does not validate or accept the intervening work. Exact repeats succeed;
stale/conflicting requests fail. No package namespace or migration engine.

Rejected: null guards alone (still blocked), fake archives (false history), silent
prepare-time adoption (hides changes), resetting all metadata (loses unrelated duties).
Regression journeys cover child/parent retirement, an unrelated active writer,
late binding, idle forward adoption and retained cleanup obligations.

Scratch request/results default to ignored `.local/relay/` inside the project.
Ignored files already lie outside source snapshots; no verifier weakening is needed.
Keep durable docs tracked, and remove scratch only after its final consumer and
cleanup. No automatic migration or report store is introduced.
