# ADR 0004: Authenticate local task baselines before host creation

## Status

Accepted for `local`; superseded for host-created worktrees by ADR 0008.

## Context

The first complete UK Dev v0.3 pilot manually expanded a short Git revision to
the wrong full SHA while preparing an executor packet. Structural validation
accepted the packet, a host task was created, and only the executor's own
authority check stopped work. The fail-closed executor prevented a repository
change, but the host call and recovery turn were avoidable.

A task operation is useful only when its source identity is authenticated, not
merely well-shaped. Linked worktrees also share an operation journal, so the
packet must be bound to the same Git common directory as that journal.

## Decision

1. `local` and `worktree` task packets require an absolute
   `environment.project_path` identifying the exact Git worktree root.
2. `task operation prepare` compares the packet's revision and cleanliness to
   that worktree's current Git state before creating or updating a journal
   record. Revisions must match the exact full `HEAD`; abbreviated or manually
   expanded values do not pass by prefix.
3. The packet worktree must share the operation journal's Git common directory.
   A coordinator cannot journal a packet for an unrelated repository.
4. `task operation attempt` repeats the authentication immediately before the
   private host creation call. Revision or clean/dirty drift produces no
   attempt record.
5. Existing v0.3 operation records without persisted baseline evidence remain
   readable. They cannot launch until the same original packet is prepared
   again and authenticated.
6. `projectless` packets retain structural baseline fields but have no local
   Git repository to authenticate.

## Rejected alternatives

- **Trust executor startup alone:** this prevents product mutation but wastes a
  host task and makes coordinator intent unreliable.
- **Accept abbreviated revisions:** prefixes are transcription-prone and may
  cease to be unique as history grows.
- **Authenticate only at preparation:** repository state can drift before the
  host call.
- **Hash every dirty byte:** this release binds only the declared
  `dirty-authorized` state. Exact dirty-patch attestation is a separate contract
  if future workflows require it.

## Consequences

- Coordinators must derive task identity from Git rather than type it from
  memory or prose.
- Local task preparation does bounded read-only Git work twice.
- A narrow time-of-check/time-of-use gap remains between the second check and
  the private host call. The call stays immediate and one-shot, and executors
  continue to authenticate their received baseline before mutation.

## Guardrails

- Tests reject wrong and abbreviated revisions before journaling.
- Tests reject revision and cleanliness drift before an attempt is recorded.
- Tests bind linked operations to the same Git common directory.
- Tests prove legacy records are readable, blocked from launch, and safely
  enriched by authenticated re-preparation.
