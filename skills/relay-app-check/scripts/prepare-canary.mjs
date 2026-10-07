import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;

function absoluteRoot(value, flag) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${flag} must be an absolute path`);
  return realpathSync(value);
}

export function prepareCanary({ repo, pluginRoot, projectId, model, thinking, env = process.env }) {
  const manager = env.CODEX_THREAD_ID;
  if (!uuid.test(manager ?? '')) throw new Error('A host-provided CODEX_THREAD_ID UUID is required');
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('--project-id from list_projects is required');
  if (model !== undefined && (typeof model !== 'string' || !model.trim())) throw new Error('--model must not be empty');
  if (thinking !== undefined && !efforts.has(thinking)) throw new Error('--thinking must be a native reasoning effort');
  const repoRoot = absoluteRoot(repo, '--repo');
  const root = absoluteRoot(pluginRoot, '--plugin-root');
  const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== 'relay' || typeof manifest.version !== 'string' || !manifest.version) {
    throw new Error('The selected plugin root must identify Relay and its version');
  }
  const entrypoint = realpathSync(join(root, 'bin/relay.mjs'));
  const token = randomUUID();
  const body = `Relay native Stop-hook check — ${token}, exact text, 雪.`;
  const register = `node ${quote(entrypoint)} register --repo ${quote(repoRoot)} --worker "$CODEX_THREAD_ID" --manager ${quote(manager)}`;
  // Return only native creation arguments, so diagnostic metadata cannot leak into the call.
  return {
    title: `Relay native Stop-hook check ${token}`,
    target: { type: 'project', projectId, environment: { type: 'local' } },
    prompt: `Run this disposable Relay Stop-hook canary in the retained local checkout, not implementation.
Repository: ${repoRoot}
Installed Relay root: ${root}
Manager/checker native thread ID: ${manager}

Register only your own host-provided CODEX_THREAD_ID with that manager; never invent an identity or use a provisional creation ID:
${register}
Request scoped native execution approval if required for the protected Git directory; do not change permission settings.
Confirm registration succeeded. If it fails, end with the actual error instead of the expected success body.
Make no source changes, extra checks, files, branches, worktrees or other tasks.
Never send a direct completion message, call a transport helper, manually invoke a hook, fabricate a Stop event, unregister yourself, self-archive or delete the checkout. Leave it available for the installed Stop hook.
After successful registration, end normally with only this exact final body, without a heading, quotation marks or a code fence:
${body}`,
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
  };
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      repo: { type: 'string' }, 'plugin-root': { type: 'string' }, 'project-id': { type: 'string' },
      model: { type: 'string' }, thinking: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log('node prepare-canary.mjs --repo ABSOLUTE_REPO --plugin-root INSTALLED_RELAY_ROOT --project-id NATIVE_PROJECT_ID [--model MODEL] [--thinking EFFORT]');
    } else {
      console.log(JSON.stringify(prepareCanary({
        repo: values.repo, pluginRoot: values['plugin-root'], projectId: values['project-id'],
        model: values.model, thinking: values.thinking,
      }), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'not-prepared', error: error.message }));
    process.exitCode = 1;
  }
}
