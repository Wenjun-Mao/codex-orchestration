#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { validateTaskPacket } from "../lib/task-packet.mjs";
import { validateTerminalReceipt } from "../lib/callbacks.mjs";

const root = resolve(import.meta.dirname, "..");

async function walk(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const plugin = JSON.parse(await readFile(resolve(root, ".codex-plugin/plugin.json"), "utf8"));
if (packageJson.version !== PACKAGE_VERSION || plugin.version !== PACKAGE_VERSION) {
  throw new Error("Package, plugin, and runtime versions must match");
}
if (packageJson.private !== true) throw new Error("v0.1 package must remain private");
for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
]) {
  if (packageJson[field]) throw new Error(`Zero-third-party-dependency contract violated by ${field}`);
}

const modules = (await walk(root)).filter((path) => path.endsWith(".mjs") && !path.includes("node_modules"));
for (const modulePath of modules) {
  const syntax = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
  if (syntax.status !== 0) throw new Error(`Syntax check failed for ${modulePath}: ${syntax.stderr}`);
  const source = await readFile(modulePath, "utf8");
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith("node:") && !specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw new Error(`External module import is not allowed: ${specifier} in ${modulePath}`);
    }
  }
  const dynamicImports = [...source.matchAll(/\bimport\s*\(/g)];
  const literalDynamicImports = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)];
  if (dynamicImports.length !== literalDynamicImports.length) {
    throw new Error(`Nonliteral dynamic import is not allowed in ${modulePath}`);
  }
  for (const match of literalDynamicImports) {
    const specifier = match[1];
    if (!specifier.startsWith("node:") && !specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw new Error(`External dynamic import is not allowed: ${specifier} in ${modulePath}`);
    }
  }
}

for (const name of ["project", "task-packet", "parallel-plan", "terminal-receipt"]) {
  const schema = JSON.parse(await readFile(resolve(root, "schemas", `${name}.schema.json`), "utf8"));
  if (schema.type !== "object" || schema.additionalProperties !== false || !schema.properties) {
    throw new Error(`Schema ${name} must declare a closed object contract`);
  }
  for (const field of schema.required ?? []) {
    if (!(field in schema.properties)) throw new Error(`Schema ${name} requires undeclared property ${field}`);
  }
}

validateTaskPacket(JSON.parse(await readFile(resolve(root, "examples/task-packet.json"), "utf8")));
validatePlan(JSON.parse(await readFile(resolve(root, "examples/parallel-plan.json"), "utf8")), {
  projectMaxConcurrency: 2,
});
validateTerminalReceipt(JSON.parse(await readFile(resolve(root, "examples/terminal-receipt.json"), "utf8")));

for (const skillName of ["index", "coordinate", "execute", "integrate", "cleanup"]) {
  const skill = await readFile(resolve(root, "skills", skillName, "SKILL.md"), "utf8");
  if (!skill.startsWith("---\n") || !skill.includes(`\nname: ${skillName}\n`)) {
    throw new Error(`Invalid skill entrypoint: ${skillName}`);
  }
}

console.log(`codex-orchestration ${PACKAGE_VERSION} source contracts validated`);
