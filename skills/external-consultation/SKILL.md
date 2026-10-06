---
name: external-consultation
description: Plan, brief, review, and integrate external expert or AI consultation when outside research, independent critique, or decision support can materially improve a project. Use for consultant briefs, research assignments, independent reviews, or synthesis of returned reports; prefer direct project work when it can answer the question cheaply.
---

# External Consultation

Use consultation for leverage, not ceremony. A useful consultation may improve
understanding, map trade-offs, generate possibilities, challenge assumptions,
or support a decision. It does not need to manufacture a recommendation.

## Frame The Work

- Name the primary purpose and intended use before writing the assignment.
  For decision support, identify the next decision and weigh potential benefit,
  downside, and the costs of delay, retaining the current approach, or added
  complexity.
- Match the mandate to the purpose; do not default to adversarial risk
  assessment. Distinguish binding constraints from assumptions and
  implementation choices open to challenge.
- Prefer a bounded local inspection, experiment, or source review when it can
  resolve the uncertainty directly.
- Use one consultant by default. Use multiple consultants only for genuinely
  complementary or independent evidence roles; do not give them duplicated jobs
  merely to create consensus.
- When framing or preparing a new consultation, read
  [evidence-mode.md](references/evidence-mode.md) and proactively recommend
  **Deep Research**, **Pro**, **both**, or **neither**. Base the choice on the
  user's goal, unresolved questions, evidence needs, and available access;
  do not wait to be asked to compare modes. Respect an explicitly chosen
  mode, while flagging material fit or access limitations.
- Preserve the user's authorization boundary. Writing a brief does not itself
  authorize dispatch, account use, private-repository access, or disclosure of
  confidential material.

## Prepare The Assignment

Make the complete self-contained packet the actual consultant prompt. A link,
repository, or attachment may supplement the packet but must not replace its
purpose, mandate, constraints, evidence boundary, or requested output. Carry the
relevant decision scope and evidence expectations into the prompt; do not assume
the consultant has read this skill.

Before new consultant prompts, include a brief **Mode recommendation**:
which mode(s), why they fit this task, and whether the other mode adds
material value. For both, state each assignment's contribution and the
recommended order or parallel arrangement. Label each prompt with its
intended mode and mandate. For neither, give the direct next step instead
of a consultant prompt.

Default handoff: in the final response, provide one separately labelled, fenced
plain-text prompt per consultant, ready to copy and paste in one action. Each
prompt includes its own context, mandate, access limits, evidence anchor
when applicable, links, and requested output. Assume no prior conversation memory.
Repeat essential shared context rather than asking the user to assemble a common
prefix, open local files, or combine messages. Link to published detailed briefs
for depth, not as a substitute for the usable prompt. Keep surrounding explanation
brief; use another handoff format when the user requests it. Manual copy-paste is
the default, not authorization to operate a consultant's browser or account.

For this user's repository consultations, default to **GitHub-only access**:
consultants cannot read our local files, worktrees, services, or conversation
history. State that access model in the packet; override it only when another
arrangement is explicitly established. Required source, briefs, and supporting
evidence must be accessible on GitHub before calling the packet ready for
handoff. Local preparation is not publication. If publication needs permission,
leave the packet marked draft and request that permission rather than pushing.

Read [consultation-packet.md](references/consultation-packet.md) when drafting a
prompt or specifying report expectations. When the consultant will inspect a
repository, dataset, document set, or other versioned evidence, also read
[repository-evidence.md](references/repository-evidence.md).

Ask for support proportional to intended use and error cost. For decision
support, match the evidence burden to the consequences and reversibility of
the next decision, not automatically to eventual adoption or broad success
claims. Distinguish limits on what can be claimed from reasons to block action.
Recommend proceeding when existing evidence is sufficient, or a bounded
experiment when its expected learning or benefit justifies its cost and risk.
An experiment's success does not automatically establish broader acceptance
or release readiness.

For any proposed additional gate, ask what concrete risk it addresses, what it
costs, and whether a simpler alternative suffices. Do not manufacture bold
proposals, objections, safeguards, experiments, or further review merely to
fill the report.

Clearly marked hypotheses are useful; unsupported certainty is not. Do not
impose a universal word limit. Prefer an answer-first report that is concise
where possible and detailed where the inquiry benefits.

## Review And Integrate

Preserve each returned report unchanged. Record interpretation, factual
corrections, and decisions separately.

1. Review usefulness first: what changed, simplified, challenged, or became
   newly possible?
2. Review reliability second: which claims are assumptions, what may depend on
   them, and what is the cheapest sufficient verification?
3. Classify individual insights as `Use`, `Test`, `Park`, or `Discard`; do not
   accept or reject a report as one indivisible unit.
4. Verify only the claims that downstream work will rely on, to a level
   proportional to that reliance.
5. Integrate the result in the form the purpose requires: a knowledge note,
   source map, option map, experiment, revised framing, decision, or named open
   question.
6. Reassess the next useful step from the combined findings of the report(s).
   Explicitly consider whether further consultation would materially improve
   understanding or the intended action. Consider unresolved issues,
   consequential disagreements, and valuable new directions, not just
   unanswered parts of the original assignment. Compare further consultation
   with direct inspection, a bounded experiment, or proceeding with explicit
   uncertainty.

   Reuse [evidence-mode.md](references/evidence-mode.md) and end the review
   with a brief **Follow-up recommendation**: **Deep Research**, **Pro**,
   **both**, or **none**. Choose from the remaining need, not the mode used
   previously. Explain the reason and the next step.

   When recommending consultation, name its bounded question or exploratory
   purpose, expected additional contribution, and what would count as a
   useful result. State whether it is useful now or depends on a specified
   finding or experiment. Identify any action that genuinely depends on its
   answer; do not delay unrelated work. For both, explain each contribution
   and their order or independence. For none, state the next step and give
   a condition for reopening consultation only when useful.

   Do not recommend another round merely because uncertainty remains,
   consultants disagree, or a report asks for more review. Apply this same
   reassessment to follow-up reports, and stop when another round lacks a
   credible additional contribution. A recommendation alone does not
   authorize dispatch, publication, or implementation.

Consultation is not implementation, acceptance, or release evidence. Those
claims still require direct proof from their owning system.
