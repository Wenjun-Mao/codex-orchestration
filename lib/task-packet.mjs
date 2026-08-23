import { isAbsolute } from "node:path";
import {
  CliError,
  requireEnum,
  requireExactFields,
  requireNullableText,
  requireObject,
  requireStringArray,
  requireText,
  stableStringify,
} from "./core.mjs";
import { REASONING_EFFORTS } from "./config.mjs";

const PACKET_FIELDS = [
  "schema_version",
  "task_id",
  "title",
  "objective",
  "baseline",
  "environment",
  "model",
  "reasoning_effort",
  "ownership",
  "dependencies",
  "shared_resources",
  "verification",
  "callback",
  "stop_policy",
];

export function normalizeOwnedPath(value, label) {
  const text = requireText(value, label, { max: 512 }).replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    text === "" || text === "." || text.startsWith("/") || isAbsolute(text)
    || /^[A-Za-z]:\//.test(text) || text.split("/").includes("..")
    || /[*?\[\]{}]/.test(text) || text === ".git" || text.startsWith(".git/")
  ) {
    throw new CliError(`${label} must be a bounded repository-relative path without globs or parent traversal`);
  }
  return text.replace(/^\.\//, "");
}

function validatePaths(value, label, { allowEmpty = true } = {}) {
  const raw = requireStringArray(value, label, { maxItems: 128, maxText: 512, allowEmpty });
  const normalized = raw.map((entry, index) => normalizeOwnedPath(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new CliError(`${label} contains equivalent duplicate paths`);
  return normalized;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function rejectOverlappingPaths(paths, label) {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (pathsOverlap(paths[left], paths[right])) {
        throw new CliError(`${label} contains overlapping paths: ${paths[left]} / ${paths[right]}`);
      }
    }
  }
}

export function validateTaskPacket(value) {
  requireExactFields(value, { required: PACKET_FIELDS }, "Task packet");
  if (value.schema_version !== 1) throw new CliError("Unsupported task packet schema_version");
  const taskId = requireText(value.task_id, "task_id", { max: 128, safeId: true });
  const title = requireText(value.title, "title", { max: 160 });
  const objective = requireText(value.objective, "objective", { max: 2000 });

  requireExactFields(value.baseline, { required: ["revision", "cleanliness"] }, "baseline");
  const baseline = {
    revision: requireText(value.baseline.revision, "baseline.revision", { max: 256 }),
    cleanliness: requireEnum(value.baseline.cleanliness, ["clean", "dirty-authorized"], "baseline.cleanliness"),
  };

  requireExactFields(value.environment, { required: ["type", "project_path"] }, "environment");
  const environmentType = requireEnum(value.environment.type, ["local", "worktree", "projectless"], "environment.type");
  const projectPath = value.environment.project_path === null
    ? null
    : requireText(value.environment.project_path, "environment.project_path", { max: 1024 });
  if (environmentType !== "projectless" && projectPath === null) {
    throw new CliError("environment.project_path is required for local and worktree tasks");
  }
  const environment = { type: environmentType, project_path: projectPath };

  const model = requireNullableText(value.model, "model", { max: 128 });
  requireEnum(value.reasoning_effort, REASONING_EFFORTS, "reasoning_effort");

  requireExactFields(value.ownership, {
    required: ["write_paths", "read_paths", "exclusions"],
  }, "ownership");
  const ownership = {
    write_paths: validatePaths(value.ownership.write_paths, "ownership.write_paths", { allowEmpty: false }),
    read_paths: validatePaths(value.ownership.read_paths, "ownership.read_paths"),
    exclusions: validatePaths(value.ownership.exclusions, "ownership.exclusions"),
  };
  rejectOverlappingPaths(ownership.write_paths, "ownership.write_paths");
  for (const writePath of ownership.write_paths) {
    for (const excludedPath of ownership.exclusions) {
      if (pathsOverlap(writePath, excludedPath)) {
        throw new CliError(`ownership write path overlaps an explicit exclusion: ${writePath} / ${excludedPath}`);
      }
    }
  }

  const dependencies = requireStringArray(value.dependencies, "dependencies", {
    maxItems: 128,
    maxText: 128,
    safeIds: true,
  });
  const sharedResources = requireStringArray(value.shared_resources, "shared_resources", {
    maxItems: 64,
    maxText: 128,
    safeIds: true,
  });
  const verification = requireStringArray(value.verification, "verification", {
    maxItems: 64,
    maxText: 512,
    allowEmpty: false,
  });

  requireExactFields(value.callback, {
    required: ["coordinator_thread_id", "executor_id"],
  }, "callback");
  const callback = {
    coordinator_thread_id: requireText(value.callback.coordinator_thread_id, "callback.coordinator_thread_id", {
      max: 128,
      safeId: true,
    }),
    executor_id: requireText(value.callback.executor_id, "callback.executor_id", { max: 128, safeId: true }),
  };
  if (callback.executor_id !== taskId) throw new CliError("callback.executor_id must equal task_id");

  requireExactFields(value.stop_policy, {
    required: ["urgent", "ordinary_completion"],
  }, "stop_policy");
  const urgent = requireStringArray(value.stop_policy.urgent, "stop_policy.urgent", {
    maxItems: 3,
    maxText: 32,
    safeIds: true,
    allowEmpty: false,
  });
  const requiredUrgent = ["approval", "blocker", "high-risk-drift"];
  if (stableStringify([...urgent].sort()) !== stableStringify(requiredUrgent)) {
    throw new CliError("stop_policy.urgent must contain blocker, approval, and high-risk-drift exactly");
  }
  requireEnum(value.stop_policy.ordinary_completion, ["queue"], "stop_policy.ordinary_completion");

  return {
    schema_version: 1,
    task_id: taskId,
    title,
    objective,
    baseline,
    environment,
    model,
    reasoning_effort: value.reasoning_effort,
    ownership,
    dependencies,
    shared_resources: sharedResources,
    verification,
    callback,
    stop_policy: {
      urgent: ["blocker", "approval", "high-risk-drift"],
      ordinary_completion: "queue",
    },
  };
}

export function applyTaskDefaults(packet, projectConfig) {
  const value = validateTaskPacket(packet);
  return {
    ...value,
    model: value.model ?? projectConfig.default_model,
    reasoning_effort: value.reasoning_effort ?? projectConfig.default_reasoning_effort,
  };
}

export function renderTaskPacket(packet) {
  const value = validateTaskPacket(packet);
  const lines = [
    `# ${value.title}`,
    "",
    value.objective,
    "",
    "## Execution Contract",
    "",
    `- Task ID: \`${value.task_id}\``,
    `- Baseline: \`${value.baseline.revision}\` (${value.baseline.cleanliness})`,
    `- Environment: \`${value.environment.type}\`${value.environment.project_path ? ` at \`${value.environment.project_path}\`` : ""}`,
    `- Model: ${value.model ? `\`${value.model}\`` : "host default"}`,
    `- Reasoning effort: ${value.reasoning_effort ? `\`${value.reasoning_effort}\`` : "host default"}`,
    `- Coordinator callback: \`${value.callback.coordinator_thread_id}\``,
    "",
    "Write ownership:",
    ...value.ownership.write_paths.map((path) => `- \`${path}\``),
    "",
    "Read context:",
    ...(value.ownership.read_paths.length ? value.ownership.read_paths.map((path) => `- \`${path}\``) : ["- None declared"]),
    "",
    "Explicit exclusions:",
    ...(value.ownership.exclusions.length ? value.ownership.exclusions.map((path) => `- \`${path}\``) : ["- None declared"]),
    "",
    "Dependencies:",
    ...(value.dependencies.length ? value.dependencies.map((id) => `- \`${id}\``) : ["- None"]),
    "",
    "Exclusive resources:",
    ...(value.shared_resources.length ? value.shared_resources.map((id) => `- \`${id}\``) : ["- None"]),
    "",
    "Verification:",
    ...value.verification.map((item) => `- ${item}`),
    "",
    "Before acting, run the pinned executor role entrypoint and validate this packet. Preserve unrelated and sibling changes. Steer only a true blocker, approval request, or high-risk drift. Send ordinary terminal completion through the durable callback queue exactly once.",
    "",
    "## Machine-Readable Packet",
    "",
    "```json",
    stableStringify(value, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}
