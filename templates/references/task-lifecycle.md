# Task Lifecycle

1. **Activate:** snapshot the exact runtime under
   `.git/codex-flow/v0.6.5/runtimes/<bundle-sha256>/`; bind repository/common
   directory, host, coordinator lineage/generation, configuration/policy, and
   the path/resource/branch reservation envelope to an explicit run ID.
2. **Plan:** persist a content-addressed workflow revision with dependency DAG,
   ownership, exclusive resources, models, primary outcomes, direct attempts,
   and instrument roles.
   Generate every task contract from that revision.
3. **Create:** for visible work, prepare one native call, bootstrap with the
   launch nonce, record the host's provisional ID verbatim as bounded opaque
   evidence, and preserve provisional and ready identities separately. For
   subagents, use the separate read-only `prepare -> attempt -> reconcile ->
   complete -> dispose` lifecycle; an accepted subagent operation closes that lane
   with unchanged-Git proof and skips steps 4 through 10 below.
4. **Bind and release:** reconcile selector evidence, bind the exact pristine
   worktree/baseline, send the prepared objective once, and require acceptance
   from that persisted worktree and reserved branch through the exact
   run-bound runtime.
5. **Execute:** stay inside the generated contract and attempt the named direct
   outcome. Supporting instrumentation returns one bounded checkpoint only.
6. **Signal visible-task results:** routine completion persists one
   terminal-receipt-v3 journal result without messaging. Admission first
   matches its release, ready task, baseline, and exact selector evidence;
   unavailable host observation remains null. Urgent blocker/approval/high-risk
   drift persists before one identified interrupt attempt.
7. **Select and dispose:** native waits and finals provide liveness only. The
   coordinator authenticates and observes the exact journaled result, then
   prepares its durable disposition. If release was durably rejected before
   send, the callback-less path uses `disposition cancel`.
8. **Reconcile repository state:** integrate each accepted `clean-commit`
   serially or record authoritative no-change. `dirty-blocked` remains fenced.
9. **Verify and finalize:** run combined checks at the exact reconciled state,
   reload the content-addressed PASS verification and integration/no-change
   records, finalize the disposition, and consume the result internally exactly
   once.
10. **Archive and clean:** reconcile native archive only after the full proof
    chain and managed-worktree reconciliation. Derive the separate exact-state
    cleanup plan and independently resolve branch/worktree state; v0.6 does not
    apply Git deletion.
11. **Audit and close:** persist a content-addressed `run audit` over every
    current lifecycle record, then close only while that exact terminal proof
    remains current. Abandonment preserves the complete admitted reservation
    envelope.

Every stateful command names the run explicitly. No phase infers the newest
run, trusts a raw digest, or treats a task final as durable authority.
