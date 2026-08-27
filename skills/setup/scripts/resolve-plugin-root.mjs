#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKAGE_VERSION } from "../../../lib/core.mjs";

const pluginRoot = resolve(import.meta.dirname, "../../..");
const packageMetadata = JSON.parse(
  await readFile(resolve(pluginRoot, "package.json"), "utf8"),
);
const pluginMetadata = JSON.parse(
  await readFile(resolve(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
);

if (
  packageMetadata.name !== "@wjmao/codex-flow"
  || packageMetadata.version !== PACKAGE_VERSION
  || pluginMetadata.name !== "codex-orchestration"
  || pluginMetadata.version !== PACKAGE_VERSION
) {
  throw new Error(`Installed Codex Flow metadata must agree on version ${PACKAGE_VERSION}`);
}

console.log(pluginRoot);

