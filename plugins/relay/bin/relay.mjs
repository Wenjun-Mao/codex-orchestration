#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Routes } from '../lib/routes.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const operations = ['register', 'unregister', 'status', 'inspect-lock', 'recover-lock'];
try {
  const operation = process.argv[2];
  if (!operation || ['help', '--help'].includes(operation)) {
    console.log(`Relay ${version} — same-host report forwarding
relay register --repo PATH --worker TASK --manager TASK
relay unregister --repo PATH --worker TASK --manager TASK
relay status --repo PATH
relay inspect-lock --repo PATH
relay recover-lock --repo PATH --token EXACT --commands-stopped

Register real native task IDs before the manager becomes idle.
Relay forwards Stop text; it does not verify, accept, or archive work.`);
  } else {
    if (!operations.includes(operation)) throw Error(`Unsupported command: ${operation}. Relay 0.4 replaces lifecycle commands with register/unregister/status; it does not migrate old state.`);
    const { values, positionals } = parseArgs({ args: process.argv.slice(3), allowPositionals: true, options: {
      repo: { type: 'string' }, worker: { type: 'string' }, manager: { type: 'string' },
      token: { type: 'string' }, 'commands-stopped': { type: 'boolean' },
    } });
    if (positionals.length) throw Error('Unexpected positional arguments');
    const routes = new Routes(values.repo ?? process.cwd());
    const result = operation === 'status' ? routes.read()
      : operation === 'inspect-lock' ? routes.inspectLock()
      : operation === 'recover-lock' ? routes.recoverLock(values.token, values['commands-stopped'])
      : routes.update(values.worker, values.manager, operation === 'unregister');
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(`Relay: ${error.message}`);
  process.exitCode = 1;
}
