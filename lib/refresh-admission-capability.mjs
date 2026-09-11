import {
  CliError,
  requireExactFields,
  requireText,
  stableStringify,
} from "./core.mjs";

const issuedCapabilities = new WeakSet();

function validateTarget(value) {
  requireExactFields(value, {
    required: [
      "run_id", "runtime_context_digest", "configuration_digest",
      "repository_digest", "repository_root", "repository_branch", "plan_id",
      "revision_digest", "namespace", "bound_at", "assignment_id",
    ],
  }, "refresh admission target");
  return value;
}

export function issueRefreshAdmissionCapability({ sourceNamespace, target }) {
  const capability = Object.freeze({
    source_namespace: requireText(sourceNamespace, "sourceNamespace", { max: 128, safeId: true }),
    target: Object.freeze({ ...validateTarget(target) }),
  });
  issuedCapabilities.add(capability);
  return capability;
}

export function consumeRefreshAdmissionCapability({ capability, expectedTarget }) {
  if (
    typeof capability !== "object"
    || capability === null
    || !issuedCapabilities.delete(capability)
  ) throw new CliError("Retained-fence exclusion lacks authenticated refresh capability", 73);
  const expected = validateTarget(expectedTarget);
  if (stableStringify(capability.target) !== stableStringify(expected)) {
    throw new CliError("Retained-fence exclusion capability does not match target admission", 73);
  }
  return { namespace: capability.source_namespace };
}
