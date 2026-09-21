# Relay 0.4.0 installation

- Source implementation: `2450fc1`; executable-bit correction: `421bdd7`.
- Source tests 9/9 (1.314s); relocated tests 9/9 (1.183s).
- Artifact SHA-256: `5894183cce395c40ca2db3d37e5876eccf9e4da9eae569fc5236f80416a13c40`.
- Managed personal installation: `0.4.0+codex.20260921040211`.
- Marketplace source and installed cache match all 16 artifact files, allowing
  only the manifest distribution cachebuster. Old source-only runtime files were
  removed from the marketplace payload; previous version remains in installed cache.
- Read-only inventory found no Relay source owner in saved projects. Plotloom's
  director confirmed its latest assignment retired and held new old-runtime dispatch.
  Other project source and registry state were not changed. Legacy state remains
  subject to explicit project-scoped retirement before new registration.
- Installed native transport self-check returned `queued / exact-queue-response`.
  Text: `Relay 0.4.0 installed transport check — exact text, 雪. No action needed.`
  This is a queue transport test, not a genuine worker Stop event. Recipient-visible
  receipt and reloaded native Stop qualification remain pending.

No new product task, namespace reset, historical-state migration, release tag, or
npm publication was performed. Reload/new-task pickup is the next installation
boundary, not a request to resume old lifecycle commands.
