#!/usr/bin/env node

import {
  CliError,
  requireExactFields,
  requireText,
  stableStringify,
} from "../lib/core.mjs";
import { exportRefreshSourceAuthority } from "../lib/compat/refresh-source.mjs";

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  requireExactFields(request, {
    required: [
      "protocol", "common_dir", "namespace", "run_id", "runtime_id",
      "runtime_context_digest", "bundle_sha256", "locator_digest",
    ],
  }, "refresh source export request");
  if (request.protocol !== 1) throw new CliError("Unsupported refresh source export protocol", 73);
  const result = await exportRefreshSourceAuthority({
    protocol: 1,
    commonDir: requireText(request.common_dir, "common_dir", { max: 2048 }),
    namespace: requireText(request.namespace, "namespace", { max: 128, safeId: true }),
    runId: requireText(request.run_id, "run_id", { max: 128, safeId: true }),
    runtimeId: requireText(request.runtime_id, "runtime_id", { max: 64 }),
    runtimeContextDigest: requireText(request.runtime_context_digest, "runtime_context_digest", { max: 64 }),
    bundleSha256: requireText(request.bundle_sha256, "bundle_sha256", { max: 64 }),
    locatorDigest: requireText(request.locator_digest, "locator_digest", { max: 64 }),
  });
  process.stdout.write(`${stableStringify(result)}\n`);
} catch (error) {
  const failure = error instanceof CliError ? error : new CliError(error.message || String(error), 73);
  process.stderr.write(`${failure.message}\n`);
  process.exitCode = failure.exitCode ?? 73;
}
