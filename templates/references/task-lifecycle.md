# Task Lifecycle

1. **Activate:** snapshot the exact runtime under
   `.git/codex-flow/v0.6.0/runtimes/<bundle-sha256>/`; bind repository/common
   directory, host, coordinator lineage/generation, configuration/policy,
   leases, and fences to an explicit run ID.
2. **Plan:** persist a content-addressed workflow revision with dependency DAG,
   ownership, models, primary outcomes, direct attempts, and instrument roles.
   Generate every task contract from that revision.
3. **Create:** for visible work, prepare one native call, bootstrap with the
   launch nonce, and preserve provisional and ready identities separately. For
   subagents, use the separate read-only lifecycle.
4. **Bind and release:** reconcile selector evidence, bind the exact pristine
   worktree/baseline, send the prepared objective once, and require exact
   executor acceptance.
5. **Execute:** stay inside the generated contract and attempt the named direct
   outcome. Supporting instrumentation returns one bounded checkpoint only.
6. **Signal:** routine completion persists one terminal-receipt-v3 journal
   result without messaging; urgent blocker/approval/high-risk drift persists
   before one identified interrupt attempt.
7. **Select and dispose:** native waits and finals provide liveness only. The
   coordinator authenticates and observes the exact journaled result, then
   prepares its durable disposition.
8. **Reconcile repository state:** integrate each accepted `clean-commit`
   serially or record authoritative no-change. `dirty-blocked` remains fenced.
9. **Verify and finalize:** run combined checks at the exact reconciled state,
   reload the content-addressed PASS verification and integration/no-change
   records, finalize the disposition, and consume the result internally exactly
   once.
10. **Archive and clean:** reconcile native archive only after the full proof
    chain and managed-worktree reconciliation. Apply Git cleanup separately
    from a reviewed exact-state plan, release leases/fences, then close the run.
    Abandonment preserves unresolved fences.

Every stateful command names the run explicitly. No phase infers the newest
run, trusts a raw digest, or treats a task final as durable authority.
