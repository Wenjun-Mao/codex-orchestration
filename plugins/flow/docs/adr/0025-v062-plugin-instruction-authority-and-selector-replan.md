# ADR 0025: v0.6.2 plugin instruction authority and selector replan

## Status

Accepted for v0.6.2.

This supersedes ADR 0003's `AGENTS.md` instruction-ownership mechanism for
v0.6.2. ADR 0003 remains the historical decision record for the exact v0.5
authority it describes.

## Context

v0.5 made a package-managed or externally attested `AGENTS.md` instruction
contract part of installation and ongoing compliance. That duplicated the
plugin's live skill guidance, made ordinary use depend on repository setup,
and created a second mutable prompt authority. Separately, explicit model
selection needs a safe response when the host rejects the selector before it
creates a task or subagent: repeating the original call is unsafe, but treating
an object-free rejection as permanent would prevent a deliberate correction.

## Decision

- Plugin skills are the sole live instruction authority for v0.6.2. Ordinary
  activation and tracked v0.6 adoption do not read, write, require, validate,
  or create `AGENTS.md` or tracked `INSTRUCTIONS.md`. Adoption retains only the
  exact runtime bundle, configuration, and structured policy.
- Accepted v0.5.1 remains independently readable and may be explicitly retired
  through its isolated exact-version path. That path alone may remove an
  authenticated old managed `AGENTS.md` block; it never edits external
  instructions. Earlier ADRs remain historical evidence, not live v0.6.2
  instruction authority.
- Every task records and hashes a bounded `selector_rationale` with its explicit
  model, reasoning effort, surface, and bounded subagent fork setting. Routing
  follows the least-capable-sufficient rubric documented by the plugin.
- Only an exact pre-identity selector rejection becomes
  `terminal-no-object`: `selector-rejected-before-task-identity` for visible
  tasks or `selector-rejected-before-agent-identity` for subagents. It consumes
  the one-shot operation.
- One ordinary content-addressed child revision may supersede that claim for the
  same unstarted task, changing only model, reasoning effort, and rationale.
  It receives a new contract and operation. Ambiguity, transport failure,
  identity evidence, post-creation selector mismatch, and missing evidence
  remain fail-closed. Visible-branch reuse additionally requires exact
  predecessor/run/task binding and live proof of no branch or worktree.

## Rejected alternatives

- Keep `AGENTS.md` or a tracked instruction copy as a v0.6 adoption requirement.
  This retains duplicated mutable authority and setup friction.
- Silently inherit or escalate a model. That defeats auditable routing.
- Retry or automatically fall back after a rejected selector. A second native
  call needs a new immutable contract and an explicit rationale.
- Add a retry journal, daemon, selector blacklist, or evidence state machine.
  The existing workflow claim and one child revision are the smallest durable
  authority boundary.

## Consequences and guardrails

The v0.6.2 package removes live v0.5 mutators, instruction writers, and their
templates from current authority while preserving an isolated read-only v0.5.1
verifier and exact retirement safeguards. Tests prove no ordinary activation or
adoption needs instruction files, selector rationale is required and disclosed,
one exact no-object child is allowed, and identity or ambiguity cannot open a
replan path.
