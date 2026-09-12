# Relay 0.3.2 — plain forwarding

User-directed simplification: capture the worker final and send it unchanged to
the manager. Removed message persistence, retrieval/acknowledgement commands,
status decorations, notification continuations, and report-dependent retirement.
Source ownership, verification, review and idle-gated task archival remain separate.
Existing project histories were not purged or rewritten.

Verification: 30/30 source tests (25.123s); 15/15 relocated 0.3.2 package tests
(5.815s); plugin/skill validation and whitespace/syntax checks passed. Removed
tests concerned the deleted report protocol; source safety and connected
coordinator/executor/review/archive/successor checks remain exercised.

The current task received a direct queue transport check with exact Unicode text.
The host returned exact queue acceptance on CLI 0.154.0-alpha.6.2. This was a
transport check, not a genuine worker Stop event. New native Stop behavior after
Desktop reload remains to be observed; no old event was replayed.

Artifact: `.git/codex-release-evidence/relay/0.3.2/relay-0.3.2.tgz`
SHA-256: `a813986d5bd4bafad2de468bc79817fede4b3725c2721b21018f4d6fcc2f9236`.
Managed install: `0.3.2+codex.20260912222217`. All 29 artifact, personal-source,
and cache files match except the permitted distribution version suffix.
No npm publication. Plotloom source, task state and registries were untouched.
