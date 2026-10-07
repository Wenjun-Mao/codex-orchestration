import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function selfCheck({
  pluginRoot, env = process.env, dryRun = false,
  loadTransport = url => import(url),
}) {
  const threadId = env.CODEX_THREAD_ID;
  if (!uuid.test(threadId ?? '')) throw new Error('A host-provided CODEX_THREAD_ID UUID is required');
  if (typeof pluginRoot !== 'string' || !pluginRoot) throw new Error('--plugin-root is required');
  const root = realpathSync(resolve(pluginRoot));
  const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== 'relay' || typeof manifest.version !== 'string' || !manifest.version) {
    throw new Error('The selected plugin root must identify Relay and its version');
  }
  const modulePath = realpathSync(join(root, 'lib/queue-notification.mjs'));
  const id = randomUUID();
  const request = {
    id, sender: threadId, recipient: threadId, hostId: 'local', senderHostId: 'local',
    text: `Relay App-update check — ${id}, exact text, 雪. No action needed.`,
  };
  const observation = {
    pluginRoot: root, pluginVersion: manifest.version, request,
    recipientReceipt: 'not-observed', genuineStopHook: 'not-exercised',
  };
  if (dryRun) return { ...observation, transport: { status: 'not-exercised', reason: 'dry-run' } };
  const { submitQueueNotification } = await loadTransport(pathToFileURL(modulePath).href);
  if (typeof submitQueueNotification !== 'function') throw new Error('Installed Relay transport export unavailable');
  let transport;
  try {
    transport = await submitQueueNotification(request);
  } catch (error) {
    // The installed call might already have sent; never compensate with a retry.
    transport = { status: 'ambiguous', reason: 'transport-threw',
      error: error instanceof Error ? error.message : String(error) };
  }
  return { ...observation, transport };
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      'plugin-root': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log('node self-check.mjs --plugin-root INSTALLED_RELAY_ROOT [--dry-run]');
    } else {
      const result = await selfCheck({ pluginRoot: values['plugin-root'], dryRun: values['dry-run'] });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = values['dry-run'] || (result.transport?.status === 'queued'
        && result.transport.reason === 'exact-queue-response') ? 0 : 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'not-confirmed', error: error.message }));
    process.exitCode = 1;
  }
}
