# Planning, optional grilling, and strategic review

Recorded: 2026-10-12.
Status: agreed design direction with an unverified review-trigger mechanism.
Current scope: capture decisions before any probes or implementation. This note
does not install or rename skills, start a run, create an automation, or change Relay.

## Purpose and boundaries

Generalize the useful parts of UK Dev's plan/direct/review modernization workflow
for ordinary and extended autonomous work. The objective is meaningful completion,
with broad thinking before execution and periodic reassessment during execution.
Overnight use motivated the discussion, but elapsed duration does not distinguish
this workflow from normal Relay work, which can also take hours.

Keep Relay lean. Reuse its planning, delegation, reporting, and worker lifecycle
instead of adding a parallel long-run orchestration system. Preserve useful
instructions even when that takes more words; reducing instruction length is not
worth weakening the resulting work. No new report store, runtime registry, hook,
daemon, shared framework, or mandatory review-agent hierarchy is agreed here.

## Agreed components and names

| Component | Responsibility |
| --- | --- |
| Relay `brainstorm-grill-and-plan` | Explore alternatives, offer optional grilling, and produce an actionable implementation plan. Replaces the current `brainstorm-and-plan` entrypoint when implemented. |
| Companion `grill` skill | Own the reusable, thorough interview method; available directly or through the main planning skill. |
| Relay `direct` | Execute authorized work, delegate, review worker results, and invoke strategic review at the selected checkpoints. |
| Personal `strategic-review` skill | Reassess the whole effort during execution and at its end, including direction, evidence, alternatives, and remaining work. |

The main displayed name is **Brainstorm & Plan — Optional Grilling**. Its invocation
is `brainstorm-grill-and-plan`. Continuity with the old invocation is not a design
constraint; do not compromise clarity to preserve it. The companion owns the
grilling instructions so the main skill does not duplicate them.

Relay remains responsible for its existing mechanics. The standalone review skill
owns strategic judgment. Exact skill wording, metadata, packaging, and deployment
still need to be worked out; these names do not mean the skills already exist.

## Breadth, depth, and execution planning

These activities have different purposes:

- **Brainstorm:** broaden the available approaches and question the initial
  framing. Look for options such as simplifying or removing work, not only better
  implementations of the first suggestion. Avoid manufacturing alternatives when
  there is no genuine choice.
- **Grill:** examine a promising approach, its assumptions, and the decisions that
  depend on it. Thorough questioning can expose the need to return to brainstorming.
- **Plan:** translate the resulting decisions into scope, deliverables, acceptance
  criteria, dependencies, permissions, verification, and relevant recovery work.

Grilling does not replace breadth. A deeply examined approach can still be a local
optimum if no different approach was considered. The usual flow is brainstorm,
optionally grill, then plan; it is not a mandatory sequence of conversational rounds.

## Entry and handoff behavior

The main skill uses the request and established context to select the starting
activity. This is an instruction-level handoff in the existing conversation, not
a new task, automation, state machine, or separate routing skill.

1. A broad idea benefits from exploring alternatives before committing to a design.
2. Once brainstorming reaches a promising direction and planning is the next step,
   ask once whether the user wants grilling, if no preference has been supplied.
   Offer **Grill first** and **Proceed to planning**, with a recommendation based on
   the actual uncertainty and consequences rather than always preferring grilling.
3. Honor an explicit preference without asking again. Do not repeat the offer during
   revisions unless the user requests reconsideration. Do not treat an unanswered
   recommendation as the user's selection.
4. A settled design can go directly to planning. A small missing detail gets a
   focused clarification, not an automatic full grilling session.
5. When grilling is selected, actually load and apply the companion instructions.
   Carry its decisions and open questions forward, then resume the same planning
   request without repeating discovery or already-answered questions.
6. Direct invocation of `grill` does not itself request a written implementation
   plan. Brainstorming can also end with useful options when that is the requested
   outcome. Neither activity authorizes implementation.

Skipping grilling does not remove ordinary clarification, contradiction checks,
or plan-quality checks. The optional step is the deliberate deep examination.

## Grilling method to preserve

Use Matt Pocock's approach as a substantive reference, not merely a name:

- Model the discussion as connected decisions. Ask questions whose prerequisites
  are settled; incorporate answers before posing questions that depend on them.
- Independent questions may be grouped into coherent rounds. Include clear
  recommendations and make short answers unambiguous: "yes" can accept the stated
  recommendation without presenting alternatives unfairly.
- Discover facts through available evidence rather than asking the user questions
  that source inspection can answer. Recommendations do not replace user decisions.
- Follow the agreed subject thoroughly, including consequences that initially look
  like implementation details. Do not silently discard a branch as "immaterial"
  simply to finish the plan sooner.
- Preserve active user participation and disagreement; repeated agreement with the
  agent is not evidence that the design was deeply examined.
- Bound the subject when it becomes too broad rather than impose an arbitrary
  question quota. When discussion cannot resolve a question, identify the needed
  evidence or prototype rather than manufacture certainty or keep rephrasing it.
- Reach shared understanding before moving on. Carry explicit unresolved questions
  and agreed implementation discretion forward rather than silently guessing.

The earlier suggestion to soften grilling into only "material decisions" was
reconsidered: it could give the agent permission to skip a consequential dependency
before discovering why it mattered. The agreed approach preserves grilling's depth
when selected while keeping its use optional and its subject bounded.

## Long-run planning and directing

The original long-run requirements remain part of the design:

- **Completion first.** Use observable acceptance criteria. Time limits are optional;
  include them when supplied by the user or when they materially affect the work.
  Do not require or invent a deadline for ordinary planning. Review cadence is not
  a run deadline, and available time is not a quota to fill with activity.
- **Prepare for autonomy.** Resolve foreseeable choices, dependencies, permissions,
  verification, activation, and recovery needs before launch. Cover ordinary
  diagnosis, repairs, retesting, and review within the authorized scope instead of
  inserting routine approval gates or arbitrary attempt counts.
- **Carry standing authorization.** The user's task-creation approval is intended
  to apply across their work, not only to one example plan. Preserve that instruction
  in the relevant handoff rather than asking for every task. It does not change
  native restrictions or authorize unrelated actions.
- **Make launch instructions usable.** When relevant, offer a concise kickoff that
  invokes Relay Direct and restates actual execution authority and known standing
  task-creation approval. Do not infer launch from approval of a planning discussion.
- **Use viable work choices.** Investigate uncertain prerequisites before expensive
  dependent work. Keep useful independent alternatives available where justified;
  do not manufacture a reserve backlog to occupy a promised number of hours.
- **Account for the whole effort.** Include integration, verification, strategic
  review, restoration, and closeout. If a time budget is supplied, preserve its
  original clock across resumptions and delegation rather than restarting it.
- **Resume coherently.** Keep compact decisions, evidence, remaining work, ownership,
  and applicable constraints in the existing plan/run notes. Recover that checkpoint
  after compaction or resumption rather than reconstructing the entire history.
- **Finish honestly.** Distinguish actual completion, useful partial results,
  unresolved blockers, and unproven claims. Retain reusable gains and negative
  findings through capture, review, and promotion into the appropriate project docs.

The user's example of ten hours with a twelve-hour cap illustrated intent; it was
not authority to launch or alter ADE, and those numbers are not skill defaults.
Native Goal controls remain separate. Planning and review do not create, pause,
complete, extend, or restart a Goal by themselves.

## Strategic review during and after execution

For extended runs, the desired cadence is roughly every two to three hours at safe
checkpoints, with earlier review when significant evidence changes the direction.
The final review assesses the outcome of the whole effort. Ordinary shorter work
should not acquire unnecessary ceremonies merely because the skills support long runs.

Worker-result review asks whether assigned work was done correctly. Strategic
review asks whether it remains the right work to pursue. It should examine:

- The original outcome, what the evidence establishes, and what remains unmet.
- Accumulated failures, recurring root causes, dependency changes, and local optima,
  including whether to broaden the alternatives again despite local success.
- Actual end-to-end behavior versus component checks, artifacts, or activity alone.
- Effort, coordination, rescue, uncertainty, and maintenance burden; do not claim
  savings or independent success from incomplete or unmatched comparisons.
- Credible next choices: continue, repair at the owning layer, redirect within the
  approved scope, or close with a truthful outcome. Keeping the direction is valid
  when supported; reviews must not manufacture a change to justify themselves.
- The complete remaining path to verification and closeout, plus reusable lessons.

Record the evidence considered, the decision and reason, and the resulting next
action in the existing notes. A timestamp, status recap, or repeated local test is
not a strategic review. Whole-effort coverage does not require replaying every
transcript or rerunning every check. Review is not a routine human approval gate;
seek new authority only where the next action actually needs it.

## Review invocation proposal and unresolved behavior

Instruction text such as "review periodically" is not a reliable clock. The agreed
direction is two triggers feeding the same review procedure:

| Trigger | Role |
| --- | --- |
| Work checkpoints | Check for review before another substantial work segment, after a meaningful milestone, repeated failure, or evidence that challenges the approach. |
| Elapsed-time reminder | Supply an independent reminder during long stretches without a natural checkpoint, using a temporary native heartbeat rather than a Relay scheduler. |

Direct would load and apply `strategic-review` when due, preserve the latest review
checkpoint in existing notes, and avoid a duplicate timed review immediately after
a substantive milestone review. An overdue review should be handled at a safe
boundary, not by interrupting an unsafe operation. The temporary reminder should
be removed when the run ends and must not override a user pause.

**Unverified:** the documented native same-chat scheduling capability does not
establish how a heartbeat behaves during an already-running director turn. Do not
claim reliable delivery, exact review timing, or non-interruption until the relevant
behavior is observed. A trigger also cannot guarantee the quality of the review.

The next bounded probe needs to distinguish:

- Idle director delivery from delivery while the director is already working.
- Behavior with an active Goal, without confusing a turn ending with a Goal pause.
- Whether reminders queue, defer, skip, or otherwise behave when the chat is busy,
  and whether they can be handled without interrupting existing work.
- Avoidance of duplicate review after a recent checkpoint and cessation after
  completion; user pause must remain authoritative.

The exact probe setup, reminder cadence, cleanup controls, and fallback if native
behavior is unsuitable remain open. No probe or automation is created by this note.

## Superseded directions and next steps

Do not revive these earlier proposals as additional requirements:

- A parallel long-run plan/direct framework or a separate planner selected by hours.
- Replacing brainstorming breadth with grilling depth.
- Weakening explicit grilling simply to shorten the conversation.
- Preserving an old skill invocation at the expense of clarity.
- Building a new hook, scheduler, registry, or mandatory reviewer hierarchy before
  testing the native reminder capability.

Next work, in order: evaluate the bounded reminder behavior; resolve the remaining
design questions; draft the skill wording for review; then implement and verify
the agreed changes proportionally. Keep implementation, source publication, and
installation distinct. Promote stable workflow decisions into the appropriate
decision records without treating this exploratory note as proof of effectiveness.

## References and original examples

- Current main skill source: [Relay brainstorm and plan](../../plugins/relay/skills/brainstorm-and-plan/SKILL.md).
- Current execution skill: [Relay direct](../../plugins/relay/skills/direct/SKILL.md).
- Repository boundary: [standalone personal skills](../adr/0078-standalone-personal-skills.md).
- External reference: [Matt Pocock's grilling instructions](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md),
  [grill-me explanation](https://www.aihero.dev/skills-grill-me), and
  [grilling mechanism](https://www.aihero.dev/skills-grilling), inspected during this discussion.
- Native capability: [scheduled tasks inside a chat](https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat).
  This documents same-chat review-loop reminders, not the busy-thread behavior above.
- Original UK Dev examples, reviewed read-only and not modified:
  `/Users/wjmao/.codex/worktrees/gudong-downstream-reuse/uk_dev/.agents/skills/plan-modernization-run`,
  `direct-modernization-run`, and `review-modernization-run` under the same directory.
  Transfer their useful reasoning, not project-specific registries, hooks, or hosts.
- ADE conversation `019db09f-a9e0-7d93-a8b8-7697d67ad5bc` supplied another example
  of autonomous-run planning. Neither that conversation nor the illustrative kickoff
  authorizes this work to alter or launch ADE.

Agreement source: the human design discussion in this task, through the request
to record decisions before testing. Upstream skill text is reference material,
not execution authority. This note supersedes earlier intermediate proposals only
for this proposed skill design; it does not alter currently installed behavior.
