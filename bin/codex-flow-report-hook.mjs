#!/usr/bin/env node

import { resolve } from "node:path";
import { runReportHook } from "../lib/report-hook.mjs";

// A Stop hook must write JSON, and it must never return a continuation or
// other control decision.  Reporting remains a one-way, native-queue attempt.
await runReportHook({
  input: process.stdin,
  pluginData: process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA ?? "",
  packageRoot: resolve(import.meta.dirname, ".."),
});
process.stdout.write("{}\n");
