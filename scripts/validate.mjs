#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { CODEX_FLOW_STATE_NAMESPACE } from "../lib/git.mjs";
import * as selectorPolicy from "../lib/policy/selector-policy.mjs";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import {
  createWorkflowPlanRevision,
  validateWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { validateReleaseIdentity } from "./release-identity.mjs";

const root = resolve(import.meta.dirname, "..");
const EXPECTED_PACKAGE_VERSION = "0.9.7-rc.3";

const ACTIVE_SCHEMA_NAMES = Object.freeze([
  "assignment-authority",
  "assignment-preparation",
  "archive-operation",
  "callback-record",
  "cleanup-plan",
  "codex-app-host-evidence",
  "coordinator-work",
  "generated-task-contract",
  "integration-record",
  "iteration",
  "refresh-handoff-v1",
  "refresh-inspection",
  "refresh-origin",
  "report-delivery",
  "report-envelope",
  "report-route",
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
if (packageJson.license !== "MIT" || plugin.license !== packageJson.license) {
  throw new Error("Source and plugin must declare the MIT SPDX license");
}
const repositoryUrl = "https://github.com/Wenjun-Mao/codex-orchestration";
if (
  packageJson.homepage !== `${repositoryUrl}#readme`
  || packageJson.repository?.type !== "git"
  || packageJson.repository?.url !== `git+${repositoryUrl}.git`
  || packageJson.bugs?.url !== `${repositoryUrl}/issues`
  || plugin.homepage !== packageJson.homepage
  || plugin.repository !== repositoryUrl
) throw new Error("Package and plugin repository metadata must identify the authenticated public repository");
const license = await readRequired("LICENSE");
if (
  !license.startsWith("MIT License\n\nCopyright (c) 2026 Wenjun Mao\n")
  || !license.includes("Permission is hereby granted, free of charge")
  || !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')
) throw new Error("LICENSE must contain the approved standard MIT grant and copyright");
for (const path of [
  ".codex-plugin/", "bin/", "hooks/", "lib/", "schemas/", "examples/", "skills/",
  "templates/", "docs/adr/", "docs/coverage-v0.9.md", "docs/architecture-v0.9.md",
  "docs/compatibility-capsules-v0.9.md", "docs/lessons-learned-v0.8.md",
  "docs/mission.md", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
  "CHANGELOG.md",
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
if (Object.hasOwn(plugin, "hooks")) {
  throw new Error("Plugin manifest must rely on supported hooks/hooks.json discovery");
}
const pluginHooks = JSON.parse(await readRequired("hooks/hooks.json"));
const stopHandlers = pluginHooks?.hooks?.Stop;
const subagentStopHandlers = pluginHooks?.hooks?.SubagentStop;
if (
  !Array.isArray(stopHandlers)
  || stopHandlers.length !== 1
  || !Array.isArray(subagentStopHandlers)
  || subagentStopHandlers.length !== 1
  || Object.keys(pluginHooks.hooks).sort().join(",") !== "Stop,SubagentStop"
) {
  throw new Error("Queued-report hook must register exactly one Stop and one SubagentStop event");
}
for (const commandHook of [stopHandlers[0]?.hooks?.[0], subagentStopHandlers[0]?.hooks?.[0]]) {
  if (
    commandHook?.type !== "command"
    || commandHook.command !== "node \"$PLUGIN_ROOT/bin/codex-flow-report-hook.mjs\""
    || commandHook.timeout !== 3
  ) {
    throw new Error("Queued-report completion hooks must use the bounded immutable package entrypoint");
  }
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
  if (
    moduleName.startsWith("adapters/codex-app/")
    || ["codex-app-report-adapter.mjs", "report-hook.mjs"].includes(moduleName)
  ) return "codex-app-adapter";
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
  ["index", ["codex-orchestration:direct", "codex-orchestration:refresh", "generated first-turn assignment", "iteration closeout"]],
  ["direct", ["goals", "strategic decisions", "assignment prepare", "assignment accept", "Do not poll progress"]],
  ["coordinate", ["zero children", "workflow local start", "visible tasks", "assignment closeout", "closing an execution run does not finish"]],
  ["execute", ["task launch start", "same first turn", "terminal-receipt-v4", "Routine completion never Steers"]],
  ["integrate", ["launch", "content-addressed PASS evidence", "assignment closeout"]],
  ["cleanup", ["assignment status", "assignment closeout", "Membership is not discard authority"]],
  ["refresh", ["refresh inspect", "wait", "discard", "Preserve assignment reporting"]],
  ["unplug", ["unplug plan", "exact targets and digest", "planned state"]],
]);
for (const [name, markers] of skillContracts) {
  const source = await readRequired(`skills/${name}/SKILL.md`);
  if (!source.startsWith("---\n") || !source.includes(`\nname: ${name}\n`)) {
    throw new Error(`Invalid skill entrypoint: ${name}`);
  }
  assertMarkers(source, markers, `skills/${name}/SKILL.md`);
}

if (Object.keys(selectorPolicy).some((name) => name.endsWith("_VERSION"))) {
  throw new Error("Selector policy must use package/runtime identity, not an independent version export");
}

for (const [path, markers] of new Map([
  ["templates/references/assignment-and-reporting.md", ["assignment prepare", "preparation_id", "Result brief", "assignment accept"]],
  ["templates/references/communication-loop.md", ["Routine completion", "quiet", "Queue acceptance proves only transport submission", "Urgent interruption"]],
  ["templates/references/host-operations.md", ["full contract", "task launch start", "one native creation call", "accepted archive call"]],
  ["templates/references/parallel-execution.md", ["acyclic dependency graph", "Visible tasks", "Native subagents"]],
  ["templates/references/task-lifecycle.md", ["exact installed package authority", "first prompt", "terminal-receipt-v4", "launch"]],
  ["templates/roles/director.md", ["goals", "tradeoffs", "final acceptance", "do not take over"]],
  ["templates/roles/coordinator.md", ["Own delivery", "Zero children", "preserve the route"]],
  ["templates/roles/executor.md", ["task launch start", "same first turn", "terminal-receipt-v4"]],
])) {
  assertMarkers(await readRequired(path), markers, path);
}
if ((await readRequired("templates/references/communication-loop.md")).includes(
  "Automated full-final reporting is experimental and is neither provided nor guaranteed",
)) throw new Error("Communication loop contradicts the installed same-host report contract");

assertMarkers(await readRequired("docs/adr/0050-authenticated-report-locator-retirement.md"), [
  "sender-scoped process lock",
  "persists a content-addressed retirement record",
  "The missing namespace is never sufficient authority",
], "ADR 0050");
assertMarkers(await readRequired("docs/adr/0051-lean-coordinator-delivery.md"), [
  "Coordinator is an ownership boundary",
  "bounded_coordination",
  "retains delivery, integration, verification, reporting, release, and cleanup",
], "ADR 0051");
assertMarkers(await readRequired("docs/adr/0052-mit-source-license.md"), [
  "standard MIT License",
  "2026 Wenjun Mao",
  "private: true",
], "ADR 0052");
assertMarkers(await readRequired("docs/adr/0053-consolidated-release-candidates.md"), [
  "skip unnecessary intermediate stable publishing, installation, and repeated full testing",
  "Retain necessary release candidates",
  "never moved, overwritten, or reused",
], "ADR 0053");

assertMarkers(await readRequired("README.md"), [
  "Native-first visible-task launch",
  "Stable governance core",
  "Replaceable routing policy",
  "Codex App adapter",
  "task launch prepare",
  "terminal receipt v4",
  "codex plugin add codex-orchestration@personal",
  "same local host",
  "sender-scoped locator",
], "README.md");
assertMarkers(await readRequired("CONTRIBUTING.md"), [
  "npm test",
  "ADR 0053",
  "Do not move or reuse a published version or tag",
], "CONTRIBUTING.md");
assertMarkers(await readRequired("SECURITY.md"), [
  "GitHub private vulnerability reporting",
  `${repositoryUrl}/security/advisories/new`,
  "does not promise a response SLA",
], "SECURITY.md");
assertMarkers(await readRequired("CHANGELOG.md"), [
  "0.9.6 - 2026-09-06",
  "0.9.5 - 2026-09-06",
  "launch evidence still fails closed",
], "CHANGELOG.md");
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

const defaultPrompts = plugin.interface?.defaultPrompt;
if (!Array.isArray(defaultPrompts)
  || defaultPrompts.length !== 3
  || !defaultPrompts.some((item) => item.includes("Direct this outcome"))
  || !defaultPrompts.some((item) => item.includes("bounded assignment")
    && item.includes("explicit model routing"))
  || !defaultPrompts.some((item) => item.includes("Review and integrate")
    && item.includes("refresh the coordinator"))) {
  throw new Error("Plugin interface must expose exactly three compatible direction, delivery, and review/refresh prompts");
}

console.log(
  `codex-orchestration ${PACKAGE_VERSION} source contracts validated `
  + `(${ACTIVE_SCHEMA_NAMES.length} schemas, ${libModules.length} classified modules; state ${expectedNamespace})`,
);
