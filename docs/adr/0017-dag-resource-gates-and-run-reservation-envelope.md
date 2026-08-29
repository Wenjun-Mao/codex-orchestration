# ADR 0017: DAG resource gates and the run reservation envelope

## Status

Accepted for v0.6.

## Context

The v0.6 content-addressed workflow preserved dependency and path validation
but omitted the per-task exclusive-resource claims that v0.5 plans carried.
Run activation separately accepted path, resource, branch, and operation
strings, without proving that the workflow stayed inside those reservations.
An abandonment caller could also retain only a selected subset of the admitted
fences. These gaps made the documented shared-resource and retained-fence
promises stronger than the runtime contract.

The v0.5 TTL lease ledger is not a sound basis for v0.6. A lease may expire
while native work is still running, and adding lease tokens and another
lifecycle would duplicate authority already available from the workflow DAG,
the one-active-run invariant, and durable terminal dispositions.

## Decision

Every v0.6 workflow task carries a canonical `shared_resources` array. Resource
IDs are exclusive within one Git-common-directory workflow. Tasks unordered by
the transitive dependency DAG must have disjoint resource claims. Ordered tasks
may share a resource; the downstream task becomes startable only after the
predecessor has an accepted durable terminal authority.

The admitted run fence is a conservative reservation envelope:

- every workflow write path must be equal to or descend from an admitted path
  fence;
- every workflow shared resource must be present in the admitted resource
  fences; and
- later workflow revisions may change only unstarted work that remains inside
  the same path/resource envelope.

The root workflow is checked when its persisted revision and run admission are
joined. Every later revision is checked before persistence. Generated task
contracts continue to embed the complete canonical workflow task, so resource
claims participate in task and contract digests.

Abandonment retains the entire admitted envelope. It cannot accept a
caller-selected subset. This is intentionally conservative until a separately
reviewed release mechanism can prove individual reservations safe to release.

Operation IDs remain content-addressed provenance checked by the workflow and
closure journals; they are not collision locks. v0.6 therefore removes
`operation_fences` from the run reservation schema. Branch reservations remain
separate because host-worktree branch claims are reconciled against native Git
effects later in the task lifecycle.

v0.6 does not acquire, renew, expire, break, or release TTL leases. Retained
v0.5 lease records remain historical v0.5 evidence and are not migrated.

## Rejected alternatives

- Reintroduce v0.5 leases. This adds a second, time-based authority and can
  release a resource while native work remains live.
- Treat run-level resource strings as sufficient. Without task ownership and
  DAG validation they do not prevent two unordered executors from sharing the
  resource.
- Derive an exact envelope only from revision one. A conservative admitted
  superset permits bounded replanning while preventing later claims from
  silently expanding run authority.
- Retain caller-selected fences on abandonment. The caller cannot prove which
  effects remain live without a reconciled release contract.

## Consequences and guardrails

- `shared_resources: []` is required even when a task claims no exclusive
  resource; this keeps the workflow schema closed and explicit.
- The reservation scope is one repository clone/Git common directory. This
  decision does not claim a global lock across unrelated repositories or host
  sessions.
- Static DAG ordering is an authorization gate, not a native scheduler. Native
  tasks start only from generated contracts whose dependency authorities are
  durably accepted.
- Abandoned envelopes may block later overlapping runs until a future reviewed
  release mechanism exists. Safety takes precedence over automatic expiry.
