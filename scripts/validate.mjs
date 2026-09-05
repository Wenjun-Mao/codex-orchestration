#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { CODEX_FLOW_STATE_NAMESPACE } from "../lib/git.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import {
  createWorkflowPlanRevision,
  validateWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { validateReleaseIdentity } from "./release-identity.mjs";

const root = resolve(import.meta.dirname, "..");
const EXPECTED_PACKAGE_VERSION = "0.9.1-rc.1";

const ACTIVE_SCHEMA_NAMES = Object.freeze([
  "archive-operation",
  "callback-record",
  "cleanup-plan",
  "codex-app-host-evidence",
  "generated-task-contract",
  "integration-record",
  "refresh-handoff-v1",
  "refresh-inspection",
  "refresh-origin",
  "run-activation",
  "run-audit",
  "run-fence",
  "runtime-bundle",
  "runtime-context",
  "subagent-operation",
  "task-disposition",
  "task-launch",
  "task-terminal-receipt-v4",
  "unplug-plan",
  "unplug-plan-v2",
  "urgent-record",
  "urgent-signal",
  "verification-record",
  "workflow-journal",
  "workflow-plan",
]);

const RETIRED_AUTHORITY_PATHS = Object.freeze([
  "lib/task-creation-v07.mjs",
  "lib/release-lifecycle.mjs",
  "lib/codex-app-private-resolution-v07.mjs",
  "lib/private-resolution-recovery-v08.mjs",
  "lib/refresh-v078-bridge.mjs",
  "lib/model-routing-v07.mjs",
  "schemas/visible-task-creation.schema.json",
  "schemas/release-record.schema.json",
  "schemas/terminal-receipt-v3.schema.json",
  "templates/agents-block.md",
  "lib/config.mjs",
  "lib/doctor.mjs",
  "lib/installation.mjs",
  "lib/managed.mjs",
  "lib/adoption-v06.mjs",
  "lib/legacy-retirement-v06.mjs",
  "lib/legacy-v05-readonly.mjs",
  "scripts/test-accepted-v05.mjs",
  "skills/setup",
]);

const FORBIDDEN_CURRENT_TEST_PATTERNS = [/-v07\.test\.mjs$/, /-v08\.test\.mjs$/];
const CORE_HOST_PRIVATE_TOKENS = Object.freeze([
  ".jsonl",
  "rollout-",
  "mcp_tool_call_end",
  ".codex/plugins/cache",
  "clientThreadId",
  "provisional_client_thread_id",
]);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

async function readRequired(path, label = path) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Required active asset is missing: ${label}`);
    throw error;
  }
}

function assertExactInventory(actual, expected, label) {
  const observed = [...actual].sort();
  const required = [...expected].sort();
  if (JSON.stringify(observed) === JSON.stringify(required)) return;
  const missing = required.filter((entry) => !observed.includes(entry));
  const unregistered = observed.filter((entry) => !required.includes(entry));
  throw new Error(
    `${label} inventory mismatch; missing: ${missing.join(", ") || "none"}; `
    + `unregistered: ${unregistered.join(", ") || "none"}`,
  );
}

function normalizeMarker(value) {
  return value.replace(/\s+/g, " ").trim();
}

function assertMarkers(source, markers, label) {
  const normalized = normalizeMarker(source);
  for (const marker of markers) {
    if (!normalized.includes(normalizeMarker(marker))) {
      throw new Error(`${label} is missing current v0.9 contract: ${marker}`);
    }
  }
}

function schemaNameFromFile(path) {
  const name = basename(path);
  if (!name.endsWith(".schema.json")) throw new Error(`Unexpected schema filename: ${name}`);
  return name.slice(0, -".schema.json".length);
}

function decodeJsonPointer(fragment, label) {
  if (fragment === "" || fragment === "#") return [];
  const pointer = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!pointer.startsWith("/")) throw new Error(`${label} has an unsupported JSON Pointer`);
  return pointer.slice(1).split("/").map((part) => (
    decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~")
  ));
}

function resolveJsonPointer(schema, parts, label) {
  let cursor = schema;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, part)) {
      throw new Error(`${label} does not resolve`);
    }
    cursor = cursor[part];
  }
}

function compileSchemas(schemas) {
  const byId = new Map();
  const byFile = new Map();
  for (const [name, schema] of schemas) {
    const label = `Schema ${name}`;
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`${label} must use JSON Schema draft 2020-12`);
    }
    const expectedId = `https://private.local/codex-flow/${name}.schema.json`;
    if (schema.$id !== expectedId) throw new Error(`${label} must use canonical $id ${expectedId}`);
    if (schema.type !== "object" || schema.additionalProperties !== false || !schema.properties) {
      throw new Error(`${label} must declare a closed top-level object contract`);
    }
    if (byId.has(schema.$id)) throw new Error(`${label} duplicates ${schema.$id}`);
    byId.set(schema.$id, { name, schema });
    byFile.set(`${name}.schema.json`, { name, schema });
  }

  function compileNode(current, node, path = "#") {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => compileNode(current, entry, `${path}/${index}`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (Object.hasOwn(node, "$ref")) {
      const reference = node.$ref;
      if (typeof reference !== "string" || reference === "") {
        throw new Error(`Schema ${current.name} ${path} contains an invalid $ref`);
      }
      const hashIndex = reference.indexOf("#");
      const document = hashIndex < 0 ? reference : reference.slice(0, hashIndex);
      const fragment = hashIndex < 0 ? "" : reference.slice(hashIndex);
      const target = document === "" ? current : byId.get(document) ?? byFile.get(document);
      if (!target) throw new Error(`Schema ${current.name} references unregistered ${document}`);
      resolveJsonPointer(
        target.schema,
        decodeJsonPointer(fragment, `Schema ${current.name} ${path}`),
        `Schema ${current.name} reference ${reference}`,
      );
    }
    if (Object.hasOwn(node, "pattern")) new RegExp(node.pattern);
    if (Object.hasOwn(node, "required")) {
      if (!Array.isArray(node.required) || new Set(node.required).size !== node.required.length) {
        throw new Error(`Schema ${current.name} ${path}.required is invalid`);
      }
      if (node.properties) {
        for (const field of node.required) {
          if (!Object.hasOwn(node.properties, field)) {
            throw new Error(`Schema ${current.name} ${path} requires undeclared ${field}`);
          }
        }
      }
    }
    if (
      path.startsWith("#/$defs/")
      && node.type === "object"
      && node.required
      && node.properties
      && node.additionalProperties !== false
    ) throw new Error(`Schema ${current.name} ${path} must be a closed object contract`);
    for (const [key, value] of Object.entries(node)) {
      compileNode(current, value, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    }
  }

  for (const [name, schema] of schemas) compileNode({ name, schema }, schema);
}

function moduleSpecifiers(source) {
  return [
    ...[...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]),
    ...[...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((match) => match[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  ];
}

function resolveLibImport(moduleName, specifier) {
  if (!specifier.startsWith(".")) return null;
  const absolute = resolve(root, "lib", dirname(moduleName), specifier);
  const libRoot = resolve(root, "lib");
  if (absolute !== libRoot && !absolute.startsWith(`${libRoot}${sep}`)) return null;
  return relative(libRoot, absolute);
}

const packageJson = JSON.parse(await readRequired("package.json"));
const plugin = JSON.parse(await readRequired(".codex-plugin/plugin.json"));
if (PACKAGE_VERSION !== EXPECTED_PACKAGE_VERSION) {
  throw new Error(`v0.9 source must identify as ${EXPECTED_PACKAGE_VERSION}`);
}
if (packageJson.version !== PACKAGE_VERSION || plugin.version !== PACKAGE_VERSION) {
  throw new Error("Package, plugin, and runtime versions must match");
}
const expectedNamespace = `v${PACKAGE_VERSION}`;
if (CODEX_FLOW_STATE_NAMESPACE !== expectedNamespace || RUNTIME_DIRECTORY !== expectedNamespace) {
  throw new Error(`Runtime state must use exact package namespace ${expectedNamespace}`);
}
validateReleaseIdentity(root, packageJson);
if (packageJson.private !== true) throw new Error("Package must remain private");
if (packageJson.license !== "UNLICENSED" || plugin.license !== packageJson.license) {
  throw new Error("Source and plugin must preserve the UNLICENSED boundary");
}
for (const path of [
  ".codex-plugin/", "bin/", "lib/", "schemas/", "examples/", "skills/",
  "templates/", "docs/adr/", "docs/coverage-v0.9.md", "docs/architecture-v0.9.md",
  "docs/compatibility-capsules-v0.9.md", "docs/lessons-learned-v0.8.md",
  "docs/mission.md", "README.md",
]) {
  if (!packageJson.files.includes(path)) throw new Error(`Published package omits ${path}`);
}
for (const field of [
  "dependencies", "devDependencies", "peerDependencies", "optionalDependencies",
  "bundledDependencies", "bundleDependencies",
]) {
  if (packageJson[field]) throw new Error(`Zero-third-party-dependency contract violated by ${field}`);
}
if (packageJson.scripts["test:v07"] || packageJson.scripts["test:v08"]) {
  throw new Error("Current package scripts must not expose predecessor test authority");
}

for (const path of RETIRED_AUTHORITY_PATHS) {
  try {
    await access(resolve(root, path));
    throw new Error(`Retired executable authority remains present: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const sourceModules = [];
for (const directory of ["bin", "lib", "scripts", "test"]) {
  sourceModules.push(...(await walk(resolve(root, directory))).filter((path) => path.endsWith(".mjs")));
}
for (const modulePath of sourceModules) {
  const syntax = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
  if (syntax.status !== 0) throw new Error(`Syntax check failed for ${modulePath}: ${syntax.stderr}`);
  const source = await readFile(modulePath, "utf8");
  const dynamicCount = [...source.matchAll(/\bimport\s*\(/g)].length;
  const literalDynamicCount = [...source.matchAll(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g)].length;
  if (dynamicCount !== literalDynamicCount) {
    throw new Error(`Nonliteral dynamic import is not allowed in ${relative(root, modulePath)}`);
  }
  for (const specifier of moduleSpecifiers(source)) {
    if (!specifier.startsWith("node:") && !specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw new Error(`External module import ${specifier} in ${relative(root, modulePath)}`);
    }
  }
}

const layerRegistry = JSON.parse(await readRequired("lib/module-layers.json"));
if (layerRegistry.schema_version !== 1 || layerRegistry.kind !== "codex-flow-module-layer-registry-v1") {
  throw new Error("Module layer registry has unsupported authority");
}
const libModules = (await walk(resolve(root, "lib")))
  .filter((path) => path.endsWith(".mjs"))
  .map((path) => relative(resolve(root, "lib"), path));
assertExactInventory(libModules, Object.keys(layerRegistry.modules), "Module layer registry");
function physicalModuleLayer(moduleName) {
  if (moduleName.startsWith("policy/")) return "routing-policy";
  if (moduleName.startsWith("adapters/codex-app/")) return "codex-app-adapter";
  if (moduleName.startsWith("compat/")) return "compatibility-capsule";
  return "governance-core";
}
for (const [moduleName, layer] of Object.entries(layerRegistry.modules)) {
  if (layer !== physicalModuleLayer(moduleName)) {
    throw new Error(`${moduleName} is not physically located in its declared ${layer} layer`);
  }
  const allowed = layerRegistry.allowed_imports[layer];
  if (!Array.isArray(allowed)) throw new Error(`Unknown module layer ${layer} for ${moduleName}`);
  const source = await readRequired(`lib/${moduleName}`);
  if (layer === "governance-core") {
    for (const token of CORE_HOST_PRIVATE_TOKENS) {
      if (source.includes(token)) throw new Error(`Governance core ${moduleName} leaks host-private token ${token}`);
    }
    if (/gpt-[0-9]/i.test(source)) {
      throw new Error(`Governance core ${moduleName} embeds a current model name`);
    }
  }
  for (const specifier of moduleSpecifiers(source)) {
    const target = resolveLibImport(moduleName, specifier);
    if (target === null) continue;
    const targetLayer = layerRegistry.modules[target];
    if (targetLayer === undefined) throw new Error(`${moduleName} imports unregistered module ${target}`);
    if (!allowed.includes(targetLayer)) {
      throw new Error(`${layer} ${moduleName} cannot import ${targetLayer} ${target}`);
    }
  }
}

const schemaFiles = (await readdir(resolve(root, "schemas"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
  .map((entry) => entry.name);
assertExactInventory(schemaFiles.map(schemaNameFromFile), ACTIVE_SCHEMA_NAMES, "Schema authority");
const schemas = new Map();
for (const file of schemaFiles) {
  schemas.set(schemaNameFromFile(file), JSON.parse(await readRequired(`schemas/${file}`)));
}
compileSchemas(schemas);

const exampleFiles = (await readdir(resolve(root, "examples"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name);
assertExactInventory(exampleFiles, ["v0.9-workflow-draft.json"], "Example authority");
const workflowDraft = JSON.parse(await readRequired("examples/v0.9-workflow-draft.json"));
const workflowRevision = createWorkflowPlanRevision(workflowDraft);
validateWorkflowPlanRevision(workflowRevision);
if (!workflowRevision.tasks.some((task) => task.execution_kind === "task-thread")
  || !workflowRevision.tasks.some((task) => task.execution_kind === "subagent")) {
  throw new Error("The v0.9 example must cover both native task surfaces");
}

const currentTests = (await readdir(resolve(root, "test"), { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
for (const name of currentTests) {
  if (FORBIDDEN_CURRENT_TEST_PATTERNS.some((pattern) => pattern.test(name))) {
    throw new Error(`Obsolete predecessor test remains in current source authority: ${name}`);
  }
}
if (currentTests.includes("v07-lifecycle-fixture.mjs")) {
  throw new Error("Obsolete v0.7 lifecycle fixture remains in current source authority");
}

const skillContracts = new Map([
  ["index", ["codex-orchestration:refresh", "first-turn assignment", "Native subagents"]],
  ["coordinate", ["task launch prepare", "task launch attempt", "task launch reconcile", "full contract", "one native creation call"]],
  ["execute", ["task launch start", "same first turn", "terminal-receipt-v4", "Routine terminal completion"]],
  ["integrate", ["launch_id", "content-addressed PASS verification", "Finalization"]],
  ["cleanup", ["cleanup plan --run-id", "launch", "read-only"]],
  ["refresh", ["authenticated v0.8", "Wait", "Discard", "run activate --refresh-id", "no migration"]],
  ["unplug", ["unplug plan", "Apply only an approved exact plan", "state paths last"]],
]);
for (const [name, markers] of skillContracts) {
  const source = await readRequired(`skills/${name}/SKILL.md`);
  if (!source.startsWith("---\n") || !source.includes(`\nname: ${name}\n`)) {
    throw new Error(`Invalid skill entrypoint: ${name}`);
  }
  assertMarkers(source, markers, `skills/${name}/SKILL.md`);
}

for (const [path, markers] of new Map([
  ["templates/references/communication-loop.md", ["Routine completion", "quiet", "Urgent interruption"]],
  ["templates/references/host-operations.md", ["full contract", "task launch start", "one native creation call", "opaque"]],
  ["templates/references/parallel-execution.md", ["acyclic dependency graph", "Visible tasks", "Native subagents"]],
  ["templates/references/task-lifecycle.md", ["v0.9.1-rc.1", "first prompt", "terminal-receipt-v4", "launch"]],
  ["templates/roles/coordinator.md", ["full assignment", "quiet journal", "Close only"]],
  ["templates/roles/executor.md", ["task launch start", "same first turn", "terminal-receipt-v4"]],
])) {
  assertMarkers(await readRequired(path), markers, path);
}

assertMarkers(await readRequired("README.md"), [
  "Native-first visible-task launch",
  "Stable governance core",
  "Replaceable routing policy",
  "Codex App adapter",
  "task launch prepare",
  "terminal receipt v4",
], "README.md");
assertMarkers(await readRequired("docs/architecture-v0.9.md"), [
  "Replaceable routing policy",
  "Stable Flow governance core",
  "Codex App adapter",
  "Compatibility capsule",
], "docs/architecture-v0.9.md");
assertMarkers(await readRequired("docs/compatibility-capsules-v0.9.md"), [
  "Authenticated v0.8 semantic refresh export",
  "Provisional-to-ready mapping",
  "Private archive observation",
], "docs/compatibility-capsules-v0.9.md");
assertMarkers(await readRequired("docs/lessons-learned-v0.8.md"), [
  "Root cause",
  "Missed release gate",
  "Durable guardrail",
  "Compatibility exit condition",
], "docs/lessons-learned-v0.8.md");
assertMarkers(await readRequired("docs/adr/0043-native-first-modular-architecture.md"), [
  "v0.8.3 is maintenance-only",
  "first prompt",
  "module-layer registry",
  "terminal receipt v4",
], "ADR 0043");

if (!Array.isArray(plugin.interface?.defaultPrompt)
  || !plugin.interface.defaultPrompt.some((item) => item.includes("separate executor tasks"))
  || !plugin.interface.defaultPrompt.some((item) => item.includes("explicitly selected executor models"))
  || !plugin.interface.defaultPrompt.some((item) => item.includes("Refresh this long-lived coordinator"))) {
  throw new Error("Plugin interface omits orchestration, routing, or refresh entrypoints");
}

console.log(
  `codex-orchestration ${PACKAGE_VERSION} source contracts validated `
  + `(${ACTIVE_SCHEMA_NAMES.length} schemas, ${libModules.length} classified modules; state ${expectedNamespace})`,
);
