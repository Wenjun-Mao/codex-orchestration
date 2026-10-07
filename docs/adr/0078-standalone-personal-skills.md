# 0078 — Standalone personal skills

Status: accepted.

## Context

Personal skills maintained only in user-local folders lack this repository's
version history and review path. They belong alongside our personal plugins,
without acquiring plugin packaging or a shared release lifecycle.

## Decision

Extend the repository umbrella with `skills/<name>` for personal skills we own
and maintain. Each skill keeps its `SKILL.md`, references and optional metadata
together. Plugins remain independent in `plugins/`; root docs cover shared
repository decisions. No repository rename or shared build framework is needed.

The repository is the authoring source. Deployment to Codex's skill-discovery
locations is a separate, deliberate action; source commits do not automatically
promote installed skills. Keep installed copies as deployments, not competing
editable masters.

Begin by importing External Consultation's five source files byte-for-byte,
excluding `.DS_Store`. Leave its existing installation, discovery configuration
and Relay unchanged. Bring in other maintained personal skills selectively;
do not collect bundled skills, third-party installations or project runtime data.

Add the approved Codex Usage Retrospective as one self-contained, read-only
workflow with optional UI metadata and explicit-only invocation. It inspects
existing evidence, proposes changes and stops; it adds no scheduler, review
ledger or automatic implementation. Retain the reviewed wording unchanged and
deliberately install the two source files from a pinned, pushed revision.

Expose Relay App Check locally through a checked-in relative symlink,
`.agents/skills/relay-app-check` to `skills/relay-app-check`. Keep one authoring
copy and explicit-only invocation; do not globally install it or package it in
Relay. It inspects current installation/hook state and runs existing tests.
The initial transport-only self-probe left native Stop invocation and worker
routing untested. The routine check therefore now creates one disposable native
worker in the retained local checkout, registers only its test route and requires
its normal final to arrive through installed Relay. The checker returns idle
after dispatch so queued delivery can resume it in a second turn; polling or a
native wait result is not delivery evidence. Verify the exact body and genuine
worker final before archiving the idle worker and removing only its route.
Preserve unrelated routes/source, native permissions and explicit invocation.

The first App Check run on 2026-10-07 exposed a diagnostic execution-boundary
gap: sandboxed Desktop IPC startup closed without acknowledgement. An
initialization-only comparison reproduced `Operation not permitted` inside the
sandbox and succeeded with approved execution outside it. Request scoped native
approval before a direct transport probe; if unavailable, report permission-blocked.
Keep that helper only for missing-report diagnosis or an explicitly requested
transport-only check. It reuses Relay rather than implementing another transport;
its acknowledgement/receipt cannot substitute for the genuine Stop canary. Do not
retry an ambiguous send or change Relay to accommodate the diagnostic sandbox.
No repairs, other-project work, monitoring or permanent check ledger are added.

A subsequent canary attempt was rejected before creation: its request added a
top-level `projectId`, and its manually copied manager ID differed from the host
identity. Generate the complete native creation arguments and worker brief in a
read-only helper, taking the manager solely from `CODEX_THREAD_ID`. Keep native
launching and permission checks with the checker, not inside that helper. Limit
the check to one created worker; a confirmed pre-creation validation rejection may
be corrected with the same canary token/brief, while an uncertain outcome must not
be retried. Test argument shape, identity consistency and preparation side effects.
This corrects diagnostic preparation, not Relay's runtime or model selection.

## Alternatives and guardrails

Keeping the user-local folder as the authoring source misses versioned review.
Wrapping every skill in a plugin adds unnecessary packaging; one shared release
process couples otherwise independent tools.

For the initial import, compare source bytes, validate skill structure and check
relative references. Later changes use proportional checks and explicit deployment;
exclude caches, credentials and private runtime records from the source tree.

Codex's [local-skill discovery guidance](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
distinguishes discovery locations from this repository's source-only `skills/`.
