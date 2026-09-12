# Relay 0.2.0-rc.1 director experience — source checkpoint

Source candidate only; not installed or native-qualified.

The capture-only hook explained why directors waited through implementation.
The candidate freezes the report before issuing one advisory continuation, keeps
receipt and acceptance separate, and requires fresh sender-idle observation before
archival. It adds the direct skill and the approved cheap-unplug guidance, including
finished executor/coordinator archival and clean merged local Git resource cleanup.
See decision 0003 in the Relay package for the contract and failure boundaries.

An attended independent Terra-high review identified host-scoping ambiguity in
native observations. Explicit wrong-host results are now refused and archive
listing is host-scoped; legitimate responses that omit host echoes remain supported.

Final verification on 2026-09-12:

- `npm run release:check`: exit 0; 36/36 source tests in 33.947 seconds.
- Relocated packed candidate: 21/21 tests in 8.907 seconds.
- Package: 24 files, 37,332 packed bytes, 127,294 unpacked bytes.
- Plugin validation and whitespace checks passed.

These are fixture observations, not evidence of native idle-director wakeup.
The next gate is a disposable live director/worker journey: genuine Stop capture,
one notification to an idle director, shared report review and acceptance, sender
idle observation, archival, and successor admission.

Plotloom's director reported a clean completed boundary at `5ff6ad6`, accepted and
retired assignment, archived coordinator, and no current dependence on installed
0.1.0. This is readiness information, not evidence of candidate installation. No
Plotloom files or installed plugin bytes were changed for this checkpoint.
