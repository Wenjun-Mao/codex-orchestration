# Relay 0.3.5 — App update compatibility

Root cause: Relay 0.3.4 pinned `Codex Desktop/0.154.0-alpha.6.2` in the initialize
response. App 26.915.31029 ships CLI 0.155.0-alpha.9, so forwarding was refused
before testing the queue protocol. No actual queue incompatibility was observed.

The approved correction removes release-number gating, retaining Desktop identity,
same Codex home, exact queued ID/body echo, one send, bounded execution and no retry.
Decision 0006 records this policy. No source lifecycle or reporting storage changes.

- Focused hook tests: 5/5.
- Full source tests: 37/37, 41.203 seconds.
- Relocated package tests: 22/22, 14.834 seconds; 31 files.
- Plugin validation and whitespace check passed.
- Real current-task transport send returned `queued / exact-queue-response`.
- Recipient received `From: codex-orchestration main` and the exact body
  `Relay App-update transport check — exact text, 雪. No action needed.`
- This proves real transport delivery, not a new bound-worker Stop lifecycle.

Artifact: `.git/codex-release-evidence/relay/0.3.5/relay-0.3.5.tgz`.
SHA-256: `c0459a32e2bac32815f37ca2762db364f4b186d320536165c715344f76262c5a`.
Installed `0.3.5+codex.20260918030404`; all 31 artifact/source/cache files match
except the permitted manifest cachebuster. New-task/restart pickup is not yet
verified. Future incompatible protocol responses still fail visibly; compatible
version changes alone no longer stop reporting.
