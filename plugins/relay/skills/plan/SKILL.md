---
name: plan
description: Turn an agreed direction or clear brief into a practical implementation plan, with sufficient completion evidence, foreseeable permissions, a duration estimate and two independent reviews. Use to draft or revise a plan; use relay:brainstorm when the purpose or approach still needs exploration.
---
# Plan

Write a plan that lets the implementer finish the result the user
actually wants. It should explain what to do, how to tell whether it
worked, and which decisions the implementer can make along the way.

You can start with a design from `relay:brainstorm`, an existing plan,
or a clear user brief. Brainstorming is not a required ceremony before
every plan. Writing a plan is not permission to execute it; the final
handoff carries forward any execution approval the user already gave.

## Start From What Is Already Known

Read the user's request, relevant decisions and applicable repository
instructions. Inspect enough current source, tests and project records
to check the assumptions the plan depends on. Use a project wrapper's
domain requirements with this workflow, without repeating both.

Carry forward settled decisions. If a small missing detail would change
the plan, ask about that detail. If the purpose or approach is still
open, use `relay:brainstorm` for that part, then return with the answer.
Don't restart the whole conversation because one question remains.

For design questions, use the available native question UI under its
usage rules, with chat as the fallback. Don't assume an unanswered
suggestion is the user's choice.

## Say What Must Be True When We Finish

Start with the intended result in plain language. Then specify the
evidence that would establish it, the scope it covers, and the kinds of
help that would or would not be consistent with that result.

For example, if the user wants another operator to complete a workflow
without help from its author, a successful demonstration coached by the
author is useful progress but does not prove the promised result. Plan
the unassisted attempt and define the normal documentation and tools
the operator may use. If the user instead wants an assisted workflow,
judge that agreed result; don't invent a requirement for autonomy.

For each important deliverable, explain how it contributes to the
result. Passing component tests, publishing a document or cleaning up
branches may be necessary, but none automatically proves the user's
goal was achieved. State what would leave the result incomplete even
if the deliverables were present.

An investigation can succeed by finding that an approach does not work,
when answering that question is the agreed purpose. Don't describe that
as delivering a working capability, or make a useful negative answer
look like failed execution.

**Include proof after repairs where it matters.** If an attempted
independent use needs a rescue, fixing the defect doesn't prove that
the next user can succeed unaided. Include the follow-up check the
claim needs. Require a fresh operator or context only when that is
necessary to establish the promised result; ordinary fixes do not all
need a separate real-world trial.

## Make the Work Executable

Describe the steps in a useful order, with the relevant components,
source entrypoints, dependencies and checks. An implementer should be
able to find the work and understand why it is needed. They should
still have room to make ordinary engineering decisions.

- Resolve uncertain feasibility before committing to expensive work
  that depends on it. A small probe should answer a specific question
  and lead to a decision, not become an open-ended research project.
- Cover the complete path where relevant: setup, implementation,
  integration, verification, activation, recovery and cleanup.
- Distinguish established facts from assumptions. Explain important
  failure cases and what the implementer should do if they occur.
- Default to serial work on the retained checkout. Propose independent
  review or isolated work when it has a concrete benefit. Don't assume
  that separate tasks can safely edit the same files at once.
- Put model selection at dispatch, rather than copying model choices
  into each worker's work instructions. The two planning-review roles
  below have their own explicit settings.

Do not prewrite every line of code or every possible command. Give
enough detail to make the work actionable without locking the
implementer into guesses that should be tested during implementation.

## Resolve Foreseeable Permissions Before the Run

Walk through the whole plan and identify actions that need particular
access or permission. Depending on the work, that may include creating
tasks, choosing models, installing dependencies, using an external
service, activating a feature, restarting a service, publishing,
running CI, recovering from failure or removing temporary resources.
These are prompts for checking the actual plan, not a universal list
of approvals to request.

Read the user's existing one-off and standing instructions first.
Record what they already cover; don't ask again. For permissions that
are genuinely missing, make the action and its effects concrete and
group independent decisions into one informed request where possible.
Use a question tool only when its rules permit that kind of request;
otherwise ask in chat. Don't change an environment just to find out
whether you have permission to change it.

Make clear which decisions the director can make during the run and
which genuinely require the user. If a review is an internal work step,
say what happens when it passes: continue with the covered work. Don't
turn every review, retry or activation step into another approval gate.
Also identify native confirmations that advance approval cannot remove.

The user's absence doesn't supply missing permission. For unattended
work, resolve foreseeable choices before launch and leave useful
authorized work available where an unexpected decision could block
one part of the plan. An unresolved permission can be recorded in a
planning draft; don't call the affected work ready to run until it is
resolved.

## Estimate the Effort and Choose Review Points

Give an estimated duration for the complete effort, including review
fixes, final verification and cleanup. Use a range and state important
assumptions; separate external waiting from work time. If there isn't
enough evidence for a useful estimate, explain what is missing rather
than inventing precision.

**There is no time limit by default.** An estimate is a forecast, not a
deadline or a requirement to keep working after the result is finished.
Add a time cap or deadline only when the user supplies or agrees to it.
Keep that original clock through resumptions and delegated work, and
allow time for safe closeout within a real cap. Exceeding an estimate
alone is not a reason to stop or seek approval.

For long or uncertain work, identify a meaningful point to step back
and review the direction, plus changes in evidence that should bring
the review forward. A project wrapper may supply a cadence. Don't
invent a halfway deadline from a duration estimate. A short routine
change may need only a final assessment.

The review should help decide what to do next. Direct owns invoking
the applicable project review wrapper, or `relay:review` when there is
none. The plan doesn't need a timer, automation or new record system
to describe that decision point.

## Keep One Usable Plan

Update the existing plan for this scope. Use the repository's usual
plans directory, otherwise `docs/plans/`, unless the user requests
another location. Link an existing design rather than copying it.
Brief planning can stay in chat when no saved artifact is needed.

Keep the agreed outcome, relevant permissions and explicit later user
changes easy to find in normal project records. Say which technical
choices are yours and which came from the user. Leave unresolved
questions visible. Don't add a new ledger or schema merely to track
the plan.

## Review 1: Could All the Checks Pass and the Goal Still Fail?

Before presenting an implementation plan as ready for approval or
handoff, have an independent, read-only subagent challenge it. Give
the reviewer the original user goal, relevant decisions, the draft
plan and the actual constraints. Don't steer it with your own verdict.

Ask it to construct a concrete, credible case where every deliverable
and acceptance check passes but the intended result still fails.
It should identify the wording that permits that outcome and propose
the smallest correction. If it can't find such a case, it should
explain which planned evidence rules it out.

The reviewer should also check whether an implementer has enough
information to proceed. Deal with questions according to who can
answer them:

- If the conversation or source already answers it, put the answer
  in the plan.
- If it's an ordinary engineering choice, make a reasonable call or
  explicitly leave it to implementation.
- If only the user can decide and it changes the intended result,
  bring that decision to them.

Resolve justified findings before the second review. Keep the agreed
scope: the reviewer must not turn a bounded result into an ambitious
new project. No findings is a valid result.

## Review 2: Did the Plan Add Avoidable Reasons to Stop?

Give the corrected plan, user instructions, existing permissions and
actual project/native constraints to a separate independent, read-only
subagent. Ask it to find restrictions created by the plan that could
unnecessarily stall execution.

Examples include repeated approval requests, arbitrary retry limits,
invented budgets, unnecessary serialization and decisions that could
safely be left to the director. Each finding should name the clause,
explain the likely stall and propose a justified change.

Real user limits, native requirements and necessary engineering
safeguards stay in place. Evidence needed to prove the result is not
an unnecessary restriction merely because it takes work. No findings
is a valid result.

If this review changes what counts as success, how we prove it, how
much help is allowed, or an assumption the first review relied on,
send those changes back to the first reviewer for a focused recheck.
Neither review adds a routine human sign-off.

### Use Explicit Reviewer Settings

Unless the user overrides them, use:

| Role | Model | Reasoning effort |
| --- | --- | --- |
| Outcome and plan completeness | GPT-6.1 Sol | Xhigh |
| Avoidable execution restrictions | GPT-6.1 Sol | Medium |

Announce each reviewer's purpose, model and effort. Set both selectors
explicitly and use fresh context; never inherit the parent settings.
Keep the reviewers attended and collect their findings. If the native
interface cannot select the requested settings or does not permit it,
ask the user for guidance before that review. Don't silently substitute
another model or self-review, and don't claim effective settings were
verified merely because they were requested.

## Hand Off Without Starting Over

Present the plan, the important review findings and how they were
resolved, plus any remaining decisions or gates. Ask only for execution
approval that is still missing. Don't demand separate design and
execution approvals when the user's instruction already covers both.

Carry the agreed outcome, evidence, permitted assistance, scope,
permissions, review points, duration estimate and any real deadline
into the normal implementation handoff. Include explicit later user
changes. Execution must not quietly replace the promised result with
an easier completion standard.

If the user requested planning only, finish with the plan. If they
already authorized execution and the requirements are met, continue
through the appropriate execution workflow; use `relay:direct` for
managing delegated work. A separate kickoff message can be offered
when useful, but it is not compulsory for already-authorized work.
This skill neither starts a native Goal nor switches native Plan mode.
