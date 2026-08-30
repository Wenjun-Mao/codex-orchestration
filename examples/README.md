# Examples

`v0.7-workflow-draft.json` is the only user-authored v0.7 example. The runtime
canonicalizes it, persists the workflow revision, and generates task contracts
and lifecycle records. Do not copy or hand-author operation IDs, nonce evidence,
callback IDs, dispositions, integration records, verification hashes, or
archive records; those derive their authority from persisted state.

Accepted v0.5.1 examples remain available from its immutable tag. They are not
shipped as current package authority and must not be used to author a new run.
