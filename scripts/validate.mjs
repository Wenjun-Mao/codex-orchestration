#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { validateTaskPacket } from "../lib/task-packet.mjs";
import { validateTerminalReceipt } from "../lib/callbacks.mjs";
import { validateUrgentSignal } from "../lib/urgent-signals.mjs";
import {
  validateHostCapabilityEvidence,
  validateHostObservationEvidence,
} from "../lib/task-operations.mjs";

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
if (packageJson.private !== true) throw new Error("Package must remain private");
if (!packageJson.files.includes("skills/") || packageJson.files.includes("prompts/")) {
  throw new Error("Published package must include skills and exclude retired copy-paste prompts");
}
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

const schemas = new Map();
for (const name of [
  "project",
  "install-plan",
  "task-packet",
  "parallel-plan",
  "task-operation",
  "host-capability-evidence",
  "host-observation-evidence",
  "terminal-receipt",
  "urgent-signal",
  "git-branch-claim",
  "git-ownership",
  "git-integration",
  "git-cleanup-plan",
]) {
  const schema = JSON.parse(await readFile(resolve(root, "schemas", `${name}.schema.json`), "utf8"));
  schemas.set(name, schema);
  if (schema.type !== "object" || schema.additionalProperties !== false || !schema.properties) {
    throw new Error(`Schema ${name} must declare a closed object contract`);
  }
  for (const field of schema.required ?? []) {
    if (!(field in schema.properties)) throw new Error(`Schema ${name} requires undeclared property ${field}`);
  }
}

for (const name of ["task-packet", "task-operation"]) {
  const environment = schemas.get(name).$defs.environment.oneOf.find(
    (entry) => entry.properties?.type?.const === "host-worktree",
  );
  if (JSON.stringify(environment?.["x-codex-flow-distinct-properties"])
    !== JSON.stringify(["starting_branch", "executor_branch"])) {
    throw new Error(`Schema ${name} must declare the host-worktree branch-distinctness constraint`);
  }
}

validateTaskPacket(JSON.parse(await readFile(resolve(root, "examples/task-packet.json"), "utf8")));
validateTaskPacket(JSON.parse(await readFile(resolve(root, "examples/task-thread-packet.json"), "utf8")));
validatePlan(JSON.parse(await readFile(resolve(root, "examples/parallel-plan.json"), "utf8")), {
  projectMaxConcurrency: 2,
});
validateTerminalReceipt(JSON.parse(await readFile(resolve(root, "examples/terminal-receipt.json"), "utf8")));
validateUrgentSignal(JSON.parse(await readFile(resolve(root, "examples/urgent-signal.json"), "utf8")));
validateHostCapabilityEvidence(JSON.parse(
  await readFile(resolve(root, "examples/host-capability-evidence.json"), "utf8"),
));
validateHostObservationEvidence(JSON.parse(
  await readFile(resolve(root, "examples/host-observation-evidence.json"), "utf8"),
));

for (const skillName of ["index", "setup", "coordinate", "execute", "integrate", "cleanup"]) {
  const skill = await readFile(resolve(root, "skills", skillName, "SKILL.md"), "utf8");
  if (!skill.startsWith("---\n") || !skill.includes(`\nname: ${skillName}\n`)) {
    throw new Error(`Invalid skill entrypoint: ${skillName}`);
  }
}

const setupContracts = new Map([
  ["new-repository.md", [
    "codex/codex-flow-v0.5-bootstrap",
    "--setup-mode new",
    "Use managed AGENTS mode",
    "Do not modify product files or launch delegated",
  ]],
  ["existing-repository.md", [
    "Do not migrate or assume ownership of tasks launched before adoption.",
    "codex/codex-flow-v0.5-adoption",
    "--setup-mode existing",
    "must not be retroactively journaled, integrated, archived, or cleaned",
  ]],
]);
for (const [name, contractMarkers] of setupContracts) {
  const reference = await readFile(resolve(root, "skills", "setup", "references", name), "utf8");
  const normalizedReference = reference.replace(/\s+/g, " ");
  for (const marker of contractMarkers) {
    if (!normalizedReference.includes(marker.replace(/\s+/g, " "))) {
      throw new Error(`${name} is missing setup contract: ${marker}`);
    }
  }
}

const setupSkill = await readFile(resolve(root, "skills/setup/SKILL.md"), "utf8");
for (const marker of [
  "installed plugin containing this skill as the accepted package",
  "Automatic discovery is not mutation authority",
  "explicit retirement and fresh installation",
  "populated non-Git directory",
]) {
  if (!setupSkill.includes(marker)) throw new Error(`setup skill is missing authority contract: ${marker}`);
}
const setupMetadata = await readFile(resolve(root, "skills/setup/agents/openai.yaml"), "utf8");
for (const marker of [
  "allow_implicit_invocation: true",
  "$codex-orchestration:setup",
]) {
  if (!setupMetadata.includes(marker)) throw new Error(`setup skill metadata is missing: ${marker}`);
}
const setupResolver = await readFile(
  resolve(root, "skills/setup/scripts/resolve-plugin-root.mjs"),
  "utf8",
);
for (const marker of [
  'resolve(import.meta.dirname, "../../..")',
  "packageMetadata.version !== PACKAGE_VERSION",
  "pluginMetadata.version !== PACKAGE_VERSION",
]) {
  if (!setupResolver.includes(marker)) throw new Error(`setup root resolver is missing: ${marker}`);
}
if (!plugin.interface.defaultPrompt.some((item) => item.includes("Set up Codex Flow"))
  || !plugin.interface.defaultPrompt.some((item) => item.includes("Adopt Codex Flow"))) {
  throw new Error("Plugin interface must expose setup and adoption starter prompts");
}
try {
  await access(resolve(root, "prompts"));
  throw new Error("Retired copy-paste prompts directory must not exist");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(`codex-orchestration ${PACKAGE_VERSION} source contracts validated`);
