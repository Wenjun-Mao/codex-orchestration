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

## Alternatives and guardrails

Keeping the user-local folder as the authoring source misses versioned review.
Wrapping every skill in a plugin adds unnecessary packaging; one shared release
process couples otherwise independent tools.

For the initial import, compare source bytes, validate skill structure and check
relative references. Later changes use proportional checks and explicit deployment;
exclude caches, credentials and private runtime records from the source tree.

Codex's [local-skill discovery guidance](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
distinguishes discovery locations from this repository's source-only `skills/`.
