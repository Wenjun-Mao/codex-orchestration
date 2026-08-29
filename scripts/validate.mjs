#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { validateProjectConfig } from "../lib/config.mjs";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { CODEX_FLOW_STATE_NAMESPACE } from "../lib/git.mjs";
import { V06_RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import {
  createWorkflowPlanRevision,
  validateWorkflowPlanRevision,
} from "../lib/workflow-plan.mjs";
import { validateReleaseIdentity } from "./release-identity.mjs";

const root = resolve(import.meta.dirname, "..");
const EXPECTED_DEVELOPMENT_PACKAGE_VERSION = "0.6.0-dev.0";

// ACTIVE V0.6 SCHEMA REGISTRY INSERTION POINT:
// add every new operating schema here in the same change that introduces it.
const ACTIVE_V06_SCHEMA_NAMES = Object.freeze([
  "runtime-bundle",
  "runtime-context",
  "run-fence",
  "run-activation",
  "run-audit-v06",
  "urgent-signal",
  "urgent-record-v06",
  "adoption-manifest",
  "adoption-plan",
  "adoption-retirement-plan",
  "workflow-plan",
  "workflow-journal-v06",
  "generated-task-contract",
  "subagent-operation",
  "visible-task-creation",
  "release-record",
  "terminal-receipt-v3",
  "callback-record",
  "task-disposition",
  "verification-record",
  "integration-record",
  "archive-operation",
  "cleanup-plan-v06",
]);

// These contracts are retained package history. They are syntax-checked as JSON
// assets, but they are not compiled into the active v0.6 schema graph.
const HISTORICAL_V05_SCHEMA_NAMES = new Set([
  "project",
  "install-plan",
  "task-packet",
  "parallel-plan",
  "task-operation",
  "host-capability-evidence",
  "host-observation-evidence",
  "terminal-receipt",
  "git-branch-claim",
  "git-ownership",
  "git-integration",
  "git-cleanup-plan",
]);

const ACTIVE_V06_EXAMPLES = new Set(["v0.6-workflow-draft.json"]);
const HISTORICAL_V05_EXAMPLES = new Set([
  "parallel-plan.json",
  "task-packet.json",
  "task-thread-packet.json",
  "host-capability-evidence.json",
  "host-observation-evidence.json",
  "terminal-receipt.json",
  "urgent-signal.json",
]);

async function walk(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function assertExactInventory(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const missing = expectedSorted.filter((entry) => !actualSorted.includes(entry));
    const unregistered = actualSorted.filter((entry) => !expectedSorted.includes(entry));
    throw new Error(
      `${label} inventory mismatch; missing: ${missing.join(", ") || "none"}; `
      + `unregistered: ${unregistered.join(", ") || "none"}`,
    );
  }
}

function normalizeMarker(value) {
  return value.replace(/\s+/g, " ").trim();
}

function assertMarkers(source, markers, label) {
  const normalizedSource = normalizeMarker(source);
  for (const marker of markers) {
    if (!normalizedSource.includes(normalizeMarker(marker))) {
      throw new Error(`${label} is missing current v0.6 contract: ${marker}`);
    }
  }
}

async function readRequired(path, label = path) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Required active asset is missing: ${label}`);
    throw error;
  }
}

function schemaNameFromFile(path) {
  const suffix = ".schema.json";
  const name = basename(path);
  if (!name.endsWith(suffix)) throw new Error(`Unexpected schema filename: ${name}`);
  return name.slice(0, -suffix.length);
}

function decodeJsonPointer(fragment, label) {
  if (fragment === "" || fragment === "#") return [];
  const pointer = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!pointer.startsWith("/")) throw new Error(`${label} has an unsupported JSON Pointer: ${fragment}`);
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
  return cursor;
}

function compileActiveSchemas(schemas) {
  const byId = new Map();
  const byFile = new Map();
  for (const [name, schema] of schemas) {
    const label = `Schema ${name}`;
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`${label} must use JSON Schema draft 2020-12`);
    }
    const expectedId = `https://private.local/codex-flow/${name}.schema.json`;
    if (schema.$id !== expectedId) throw new Error(`${label} must use canonical $id ${expectedId}`);
    if (byId.has(schema.$id)) throw new Error(`${label} duplicates schema $id ${schema.$id}`);
    byId.set(schema.$id, { name, schema });
    byFile.set(`${name}.schema.json`, { name, schema });
    if (schema.type !== "object" || schema.additionalProperties !== false || !schema.properties) {
      throw new Error(`${label} must declare a closed top-level object contract`);
    }
  }

  function targetForRef(current, reference) {
    if (typeof reference !== "string" || reference === "") {
      throw new Error(`Schema ${current.name} contains an invalid $ref`);
    }
    const hashIndex = reference.indexOf("#");
    const document = hashIndex < 0 ? reference : reference.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : reference.slice(hashIndex);
    let target = current;
    if (document !== "") {
      target = byId.get(document) ?? byFile.get(document);
      if (!target) {
        throw new Error(
          `Schema ${current.name} references an unregistered or historical schema: ${document}`,
        );
      }
    }
    resolveJsonPointer(
      target.schema,
      decodeJsonPointer(fragment, `Schema ${current.name} reference ${reference}`),
      `Schema ${current.name} reference ${reference}`,
    );
  }

  function compileNode(current, node, path = "#") {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => compileNode(current, entry, `${path}/${index}`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (Object.hasOwn(node, "$ref")) targetForRef(current, node.$ref);
    if (Object.hasOwn(node, "pattern")) {
      if (typeof node.pattern !== "string") throw new Error(`Schema ${current.name} ${path}.pattern must be text`);
      try {
        new RegExp(node.pattern);
      } catch (error) {
        throw new Error(`Schema ${current.name} ${path}.pattern does not compile: ${error.message}`);
      }
    }
    if (Object.hasOwn(node, "required")) {
      if (!Array.isArray(node.required) || node.required.some((field) => typeof field !== "string")) {
        throw new Error(`Schema ${current.name} ${path}.required must be a string array`);
      }
      if (new Set(node.required).size !== node.required.length) {
        throw new Error(`Schema ${current.name} ${path}.required contains duplicates`);
      }
      if (node.properties) {
        for (const field of node.required) {
          if (!Object.hasOwn(node.properties, field)) {
            throw new Error(`Schema ${current.name} ${path} requires undeclared property ${field}`);
          }
        }
      }
    }
    if (path.startsWith("#/$defs/") && node.type === "object" && node.required && node.properties
      && node.additionalProperties !== false) {
      throw new Error(`Schema ${current.name} ${path} must declare a closed object contract`);
    }
    for (const [key, value] of Object.entries(node)) {
      compileNode(current, value, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    }
  }

  for (const [name, schema] of schemas) compileNode({ name, schema }, schema);
}

const packageJson = JSON.parse(await readRequired("package.json"));
const plugin = JSON.parse(await readRequired(".codex-plugin/plugin.json"));
if (PACKAGE_VERSION !== EXPECTED_DEVELOPMENT_PACKAGE_VERSION) {
  throw new Error(`v0.6 development source must identify as ${EXPECTED_DEVELOPMENT_PACKAGE_VERSION}`);
}
if (packageJson.version !== PACKAGE_VERSION || plugin.version !== PACKAGE_VERSION) {
  throw new Error("Package, plugin, and runtime versions must match");
}
const releaseCore = PACKAGE_VERSION.split("-", 1)[0].split("+", 1)[0];
const expectedStateNamespace = `v${releaseCore}`;
if (CODEX_FLOW_STATE_NAMESPACE !== expectedStateNamespace || V06_RUNTIME_DIRECTORY !== expectedStateNamespace) {
  throw new Error(
    `Runtime state must use exact namespace ${expectedStateNamespace}, not package prerelease identity`,
  );
}
validateReleaseIdentity(root, packageJson);
if (packageJson.private !== true) throw new Error("Package must remain private");
if (packageJson.license !== "UNLICENSED" || plugin.license !== packageJson.license) {
  throw new Error("Source and plugin must preserve the UNLICENSED authority boundary");
}
const requiredPackageFiles = [
  ".codex-plugin/", "bin/", "lib/", "schemas/", "examples/", "skills/",
  "templates/", "docs/", "README.md",
];
for (const path of requiredPackageFiles) {
  if (!packageJson.files.includes(path)) throw new Error(`Published package is missing required path: ${path}`);
}
if (packageJson.files.includes("prompts/")) {
  throw new Error("Published package must exclude retired copy-paste prompts");
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

const managedAgentsTemplate = await readRequired("templates/agents-block.md");
const startMarker = `<!-- codex-flow:start v${PACKAGE_VERSION} -->`;
if (!managedAgentsTemplate.startsWith(`${startMarker}\n`)
  || managedAgentsTemplate.split(startMarker).length !== 2
  || managedAgentsTemplate.split("<!-- codex-flow:end -->").length !== 2) {
  throw new Error("Managed AGENTS template must have one exact package-version boundary");
}
assertMarkers(managedAgentsTemplate, [
  "progressively activate one explicit v0.6 run without tracked setup",
  "visible tasks for independently running or mutating work",
  "native subagents are a separate read-only supporting lane",
  "Visible-task routine completion goes only to the quiet durable journal",
  "result -> disposition -> integration/no-change -> combined verification -> archive -> read-only cleanup plan",
  "v0.6 cleanup never deletes Git refs or worktrees",
], "templates/agents-block.md");

const modules = (await walk(root)).filter((path) => (
  path.endsWith(".mjs") && !path.includes("node_modules") && !path.startsWith(resolve(root, ".git"))
));
for (const modulePath of modules) {
  const syntax = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
  if (syntax.status !== 0) throw new Error(`Syntax check failed for ${modulePath}: ${syntax.stderr}`);
  const source = await readFile(modulePath, "utf8");
  const staticImports = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
  ];
  for (const match of staticImports) {
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

const schemaDirectory = resolve(root, "schemas");
const schemaFiles = (await readdir(schemaDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
  .map((entry) => entry.name);
const registeredSchemaNames = new Set([
  ...ACTIVE_V06_SCHEMA_NAMES,
  ...HISTORICAL_V05_SCHEMA_NAMES,
]);
assertExactInventory(schemaFiles.map(schemaNameFromFile), registeredSchemaNames, "Schema authority");

const parsedSchemas = new Map();
for (const file of schemaFiles) {
  const name = schemaNameFromFile(file);
  parsedSchemas.set(name, JSON.parse(await readRequired(`schemas/${file}`)));
}
const activeSchemas = new Map(ACTIVE_V06_SCHEMA_NAMES.map((name) => [name, parsedSchemas.get(name)]));
compileActiveSchemas(activeSchemas);

const exampleDirectory = resolve(root, "examples");
const exampleJsonFiles = (await readdir(exampleDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name);
assertExactInventory(
  exampleJsonFiles,
  new Set([...ACTIVE_V06_EXAMPLES, ...HISTORICAL_V05_EXAMPLES]),
  "Example authority",
);
const workflowDraft = JSON.parse(await readRequired("examples/v0.6-workflow-draft.json"));
if (Object.hasOwn(workflowDraft, "revision_digest")) {
  throw new Error("The v0.6 workflow example must remain a user-authored draft, not a runtime record");
}
const workflowRevision = createWorkflowPlanRevision(workflowDraft);
validateWorkflowPlanRevision(workflowRevision);
if (!workflowRevision.tasks.some((task) => task.execution_kind === "task-thread")
  || !workflowRevision.tasks.some((task) => task.execution_kind === "subagent")) {
  throw new Error("The v0.6 workflow example must cover both native task surfaces");
}
const examplesReadme = await readRequired("examples/README.md");
assertMarkers(examplesReadme, [
  "v0.6-workflow-draft.json` is the only user-authored v0.6 example",
  "remaining JSON files in this directory are v0.5.1 historical fixtures",
  "not active v0.6 operating guidance",
], "examples/README.md");
assertMarkers(await readRequired("docs/coverage-v0.6.md"), [
  "Historical v0.5 coverage documents, examples, and field tests remain useful evidence",
  "not active v0.6 guidance",
], "docs/coverage-v0.6.md");

const skillContracts = new Map([
  ["index", [
    "A repository does not need `.codex/orchestration/` to discuss or plan Codex Flow",
    "progressively activate one v0.6 run without tracked setup",
    "Native subagents are a distinct, read-only supporting lane",
  ]],
  ["setup", [
    "installed plugin containing this skill as package authority",
    "Permanent adoption is optional",
    "adopt plan|apply|status",
    "adopt retire-plan|retire-apply",
  ]],
  ["coordinate", [
    "include the explicit `run_id` in every stateful operation",
    "There is no requirement for tracked `.codex/orchestration/`",
    "Use `workflow create|revise|status|contract`",
    "Visible-task routine completion must stay quiet and journal-only",
  ]],
  ["execute", [
    "use `release accept`",
    "Persist exactly one terminal-receipt-v3 result with `callback deliver`",
    "Ordinary completion must not call direct messaging or Steer",
  ]],
  ["integrate", [
    "do not expose a public bare callback-consume shortcut",
    "content-addressed PASS verification record",
    "Finalization performs any internal result consumption exactly once",
  ]],
  ["cleanup", [
    "Name the exact `run_id`",
    "cleanup plan --run-id",
    "v0.6 exposes no cleanup apply command",
    "complete admitted path/resource/branch envelope durable",
  ]],
]);
for (const [skillName, markers] of skillContracts) {
  const skill = await readRequired(`skills/${skillName}/SKILL.md`);
  if (!skill.startsWith("---\n") || !skill.includes(`\nname: ${skillName}\n`)) {
    throw new Error(`Invalid skill entrypoint: ${skillName}`);
  }
  assertMarkers(skill, markers, `skills/${skillName}/SKILL.md`);
}

const setupMetadata = await readRequired("skills/setup/agents/openai.yaml");
assertMarkers(setupMetadata, [
  "allow_implicit_invocation: true",
  "$codex-orchestration:setup",
], "skills/setup/agents/openai.yaml");
const setupResolver = await readRequired("skills/setup/scripts/resolve-plugin-root.mjs");
assertMarkers(setupResolver, [
  'resolve(import.meta.dirname, "../../..")',
  "packageMetadata.version !== PACKAGE_VERSION",
  "pluginMetadata.version !== PACKAGE_VERSION",
], "skills/setup/scripts/resolve-plugin-root.mjs");
const setupReferences = new Map([
  ["new-repository.md", [
    ".codex/orchestration/v0.6/",
    "First activate a named v0.6 run",
    "adoption promotes that run's runtime and cannot bootstrap one",
    "Run `adopt apply --run-id ...` only for that exact unchanged plan",
    "Adoption does not authorize additional task creation",
  ]],
  ["existing-repository.md", [
    "never retroactively assumes authority for earlier tasks",
    "has no tracked-v0.5 retirement operation",
    "`adopt retire-plan|retire-apply` retires only a tracked v0.6 adoption",
    "Pre-adoption tasks finish under their original contract",
  ]],
]);
for (const [name, markers] of setupReferences) {
  assertMarkers(
    await readRequired(`skills/setup/references/${name}`),
    markers,
    `skills/setup/references/${name}`,
  );
}

if (!Array.isArray(plugin.interface?.defaultPrompt)
  || !plugin.interface.defaultPrompt.some((item) => item.includes("separate Terra executor tasks"))
  || !plugin.interface.defaultPrompt.some((item) => item.includes("Sol coordinator and Terra tasks"))
  || !plugin.interface.defaultPrompt.some((item) => item.includes("journaled task results"))) {
  throw new Error("Plugin interface must expose task orchestration, model routing, and result starter prompts");
}

const templateContracts = new Map([
  ["templates/references/communication-loop.md", [
    "Routine completion",
    "quiet Git-common journal write",
    "There is no public bare callback-consume operation",
    "Urgent interruption",
  ]],
  ["templates/references/host-operations.md", [
    "cryptographic launch nonce but no objective",
    "`clientThreadId`, record it only as provisional",
    "send its exact prompt at most once",
    "Archive is also a prepared/reconciled host operation",
  ]],
  ["templates/references/parallel-execution.md", [
    "acyclic dependency graph",
    "Visible tasks are the primary independent/mutating lanes",
    "Native subagents are read-only supporting lanes",
  ]],
  ["templates/references/stop-policy.md", [
    "primary outcome, causal question, and cheapest safe direct attempt",
    "After one supporting-instrument checkpoint",
    "persist the signal before one identified interrupt attempt",
  ]],
  ["templates/references/task-lifecycle.md", [
    ".git/codex-flow/v0.6.0/runtimes/<bundle-sha256>/",
    "terminal-receipt-v3 journal result without messaging",
    "content-addressed PASS verification and integration/no-change records",
    "Every stateful command names the run explicitly",
  ]],
  ["templates/roles/coordinator.md", [
    "preserve provisional and ready identities separately",
    "Visible-task routine results remain in the quiet journal",
    "Close only a fully reconciled run",
  ]],
  ["templates/roles/executor.md", [
    "launch-nonce bootstrap carries no objective",
    "Routine terminal completion never calls messaging or Steer",
    "terminal-receipt-v3 result in the journal",
  ]],
]);
for (const [path, markers] of templateContracts) {
  assertMarkers(await readRequired(path), markers, path);
}
validateProjectConfig(JSON.parse(await readRequired("templates/project.json")));

try {
  await access(resolve(root, "prompts"));
  throw new Error("Retired copy-paste prompts directory must not exist");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(
  `codex-orchestration ${PACKAGE_VERSION} source contracts validated `
  + `(${ACTIVE_V06_SCHEMA_NAMES.length} active v0.6 schemas; state ${CODEX_FLOW_STATE_NAMESPACE})`,
);
