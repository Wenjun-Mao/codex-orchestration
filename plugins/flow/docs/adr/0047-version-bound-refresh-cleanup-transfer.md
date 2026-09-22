# ADR 0047: Version-bound refresh cleanup transfer

- Status: accepted for v0.9 maintenance
- Date: 2026-09-05
- Refines: ADR 0040 long-lived coordinator refresh

## Context

The refresh target authenticates and invokes each source run's immutable
runtime snapshot. v0.8 cleanup plans identify executors with `operation_id`
and `blocking_operation_ids`; v0.9 cleanup plans identify them with
`launch_id` and `blocking_launch_ids`. The target-side transfer check still
required the v0.8 shape unconditionally, so a cleanup-complete, closed v0.9.0
run failed during namespace retirement even though its source runtime had
proved that no cleanup or blockers remained.

Accepting either field by shape, or copying a launch ID into an operation-ID
field, would erase the lifecycle generation that owns the evidence. Parsing
source journals in the target would also violate snapshot authority.

## Decision

The authenticated source package version selects one exact cleanup transfer
grammar. v0.8 requires the v07 cleanup kind and operation identity fields;
v0.9 requires the v09 cleanup kind and launch identity fields. The target
projects either validated grammar into internal `executor_id` evidence while
retaining an explicit identity kind. A response that mixes generations or
uses a grammar not selected by its authenticated package version fails closed.

Refresh handoff v1 continues to represent v0.8 discard cleanup with its legacy
creation-operation identity. It must not carry v0.9 launch-based discard
cleanup; that case remains blocked until a separately designed handoff version
can name launch authority directly. Cleanup-complete terminal v0.9 sources need
no discard entries and may complete an already-terminal, no-replacement
refresh through their own snapshot.

A v0.9 direct-coordinator task can be terminal without a generated task
contract or launch. Its authenticated source state carries `launch: null`, which
means there is no executor resource to archive or delete. A discard decision may
therefore reissue its semantic assignment with no cleanup entry. This is an
explicit versioned absence, not permission inferred from a missing field:
states with neither identity field, both identity fields, or a non-null v0.9
launch fail closed.

## Rejected alternatives

- Accept both blocker arrays or item identity fields regardless of source
  version. This turns authenticated version authority into shape guessing.
- Treat `launch_id` as `creation_operation_id`. This creates a false authority
  join between distinct lifecycle generations.
- Re-read v0.9 source state with target modules. This bypasses the immutable
  source export and makes the target an accidental source parser.

## Consequences and guardrails

Exact-tag regressions cover a closed v0.9.0 source, a terminal v0.9.5 direct
coordinator with `launch: null`, and v0.8.3 operation-based discard cleanup.
The direct-coordinator regression executes inspect, prepare, source retirement,
and replacement activation while negative checks reject resource-bearing or
malformed authority. The source export envelope and source retirement command
remain package-, bundle-, runtime-, and snapshot-bound; only the cleanup
response grammar differs.
