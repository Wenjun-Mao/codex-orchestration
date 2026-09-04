# v0.8 lessons carried into v0.9

## Stable lessons

1. Model names are configurable routing policy, not Flow's architectural
   identity. The durable contract is explicit selection plus a bounded
   rationale, not a fixed coordinator-worker pairing.
2. Selector evidence has three distinct stages: requested, host-accepted, and
   independently observed. Partial evidence is useful but must stay partial;
   a contradiction blocks and an unavailable observation is `null`.
3. The immutable runtime snapshot is the authority for an active run. A new
   installed skill may begin a fresh run only through the bounded refresh
   handoff; it must not reinterpret or hot-switch a source run.
4. Host gaps need narrow, evidence-backed adapters. Title, path, timing, and
   retry are not substitutes for operation-bound task identity evidence.
5. Flow's correctness tests prove protocol behavior, not cost or quality
   gains from routing or multi-task orchestration.

## Open questions

- Does the four-lane policy improve outcomes relative to one strong task on
  held-out, fixed task cohorts after coordination overhead?
- Which work classes merit separate visible tasks rather than one task or a
  native read-only subagent?
- Can the model-name-specific rubric be thinned while preserving explicit
  selector provenance and fail-closed replanning?

Until those questions have a preregistered, source-backed evaluation, the
policy is explicit guidance rather than automatic optimization. This conclusion
preserves the classifications and evaluation design in
[the routing evidence record](research/2026-08-30-orchestration-routing-evidence.md)
and the snapshot/refresh boundaries in
[ADR 0040](adr/0040-long-lived-coordinator-refresh.md).
