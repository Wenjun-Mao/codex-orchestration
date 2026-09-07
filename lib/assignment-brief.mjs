import { CliError, requireExactFields, requireText, sha256, stableStringify } from "./core.mjs";
import { validateAssignmentAuthority } from "./assignment-authority.mjs";
import { iterationTitle } from "./iteration-registry.mjs";

function textList(value, label, { min = 1, max = 16 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new CliError(`${label} must contain between ${min} and ${max} entries`);
  }
  return value.map((entry, index) => requireText(entry, `${label}[${index}]`, { max: 1200 }));
}

export function generateCoordinatorBrief({ assignment: value, authored }) {
  const assignment = validateAssignmentAuthority(value);
  requireExactFields(authored, {
    required: ["outcome", "scope", "acceptance_criteria", "constraints", "reasons"],
    optional: ["assignment_id"],
  }, "authored brief");
  const input = {
    outcome: requireText(authored.outcome, "outcome", { max: 2400 }),
    scope: textList(authored.scope, "scope"),
    acceptance_criteria: textList(authored.acceptance_criteria, "acceptance_criteria"),
    constraints: textList(authored.constraints, "constraints", { min: 0 }),
    reasons: textList(authored.reasons, "reasons", { min: 0 }),
  };
  const title = iterationTitle("Coordinator", assignment.iteration_label, assignment.purpose);
  const lines = [
    `# ${title}`,
    "",
    input.outcome,
    "",
    "## Scope",
    "",
    ...input.scope.map((entry) => `- ${entry}`),
    "",
    "## Acceptance",
    "",
    ...input.acceptance_criteria.map((entry) => `- ${entry}`),
  ];
  if (input.constraints.length > 0) lines.push("", "## Constraints", "", ...input.constraints.map((entry) => `- ${entry}`));
  if (input.reasons.length > 0) lines.push("", "## Action-changing reasons", "", ...input.reasons.map((entry) => `- ${entry}`));
  lines.push(
    "",
    "## Authenticated mechanics",
    "",
    `- Assignment: \`${assignment.assignment_id}\``,
    `- Iteration: \`${assignment.iteration_id}\` (${assignment.iteration_label})`,
    `- Approved plan: \`${assignment.approved_plan.digest}\` at \`${assignment.approved_plan.snapshot_path}\``,
    `- Report route: \`${assignment.route_id}\` to \`${assignment.recipient.thread_id}\` on \`${assignment.recipient.host_id}\``,
    `- Execution run: \`${assignment.execution_bindings.at(-1).run_id}\``,
    "- Complete assigned work in one report; the idle-final hook captures it unchanged.",
  );
  const text = `${lines.join("\n")}\n`;
  return {
    title,
    assignment_id: assignment.assignment_id,
    brief_digest: sha256(stableStringify({ assignment_id: assignment.assignment_id, authored: input, text })),
    text,
  };
}
