# ADR 0058: Bounded archived-session observation

- Status: accepted for v0.9.8
- Date: 2026-09-08
- Authority: approved v0.9.8 large-history closeout plan
- Refines: ADR 0042

## Context

The private archived-session adapter rejected an authentic 96,032,235-byte
coordinator history at a 32 MiB whole-file cap. It then read and split the
entire file before hashing or validating its sole `session_meta` row. The
failure was an adapter memory contract, not missing archive evidence and not a
reason to replay archival.

## Decision

Read the canonical archived JSONL through one opened descriptor in 64 KiB
chunks. Incrementally hash every byte and parse one newline-delimited record at
a time. Retain only the SHA-256 state, compact metadata, counters, and bounded
fragments of the current record.

The observer accepts histories up to 16 GiB, one million non-empty records,
and 32 MiB per record. These are explicit resource ceilings, not a total-memory
budget: working memory is bounded by the configured current-record ceiling
rather than total history. Materializing and decoding that one record can
temporarily hold bounded representations of it. Exceeding a byte, line, or
record ceiling has a distinct diagnostic. The emitted digest and observation
schema remain unchanged.

Before and after the read, the adapter verifies canonical placement,
non-symlink paths, the actual opened descriptor identity, path identity, size,
modification/change times, and the complete byte count. A replacement,
truncation, path swap, or concurrent content change therefore fails closed.
Active-session absence and a unique canonical archived session remain separate
placement checks.

## Rejected alternatives

- Raising the old whole-file cap: this keeps memory proportional to history.
- Reading only a tail: this cannot authenticate the full digest or metadata
  uniqueness.
- Restoring active-session append tolerance: archived evidence must remain
  stable.
- Adding an index or background cache: that would create new authority without
  authenticating the App session.

## Consequences and guardrails

Focused tests retain small-file digest compatibility, independently hashed
large histories, a near-maximum single record, compact configured limit
failures, metadata conflicts, symlinks, active counterparts, descriptor-bound
swap-and-restore, and append/replacement/truncation during reading. The release
gate also authenticates the existing 96 MB archived coordinator before closeout
is attempted.
