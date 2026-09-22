#!/usr/bin/env node

import { resolve } from "node:path";
import { installStableReportLauncher } from "../lib/adapters/codex-app/report-runtime.mjs";

for await (const _chunk of process.stdin) {
  // Consume the small lifecycle event before exiting so the host never writes
  // into a closed hook pipe. The event is not installation authority.
}
await installStableReportLauncher({
  pluginData: process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA ?? "",
  packageRoot: resolve(import.meta.dirname, ".."),
});
process.stdout.write("{}\n");
