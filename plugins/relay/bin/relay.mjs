#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Relay } from '../lib/relay.mjs';

const help = `Relay source-stage CLI (native adapters are not installed or qualified)

Genuine work choices go in a spec file:
  {"outcome":"...","plan":"approved plan path","acceptance":"...",
   "branch":"main","projectId":"saved-project-id","recipient":"director-task",
   "selector":{"model":"selected-model","thinking":"selected-effort"},
   "scope":["src/"],"checks":[["node","--test"]],"dependencies":[]}
Checks are argv arrays. Scope is exact paths or directory/ prefixes.

relay prepare --repo PATH --actor TASK --spec FILE
  Generates assignment/ticket, native create arguments and startup brief.
relay record-native --repo PATH --assignment ID --actor TASK --observation FILE
  Exact prepared creation/archive observation. Never retries native actions.
relay start --repo PATH --ticket GENERATED --actor ACTUAL_TASK
relay handoff --repo PATH --ticket GENERATED --actor TASK --spec FILE
relay finish --repo PATH --ticket GENERATED --actor TASK
relay verify --repo PATH --ticket GENERATED --actor TASK --decision continue|finish|reject
relay capture --repo PATH --assignment ID --actor TASK --event FILE
relay submit --repo PATH --assignment ID --actor TASK
relay observe-report --repo PATH --assignment ID --actor TASK --observation FILE
relay receive --repo PATH --assignment ID --actor TASK --envelope FILE [--decision accepted|rejected]
relay accept|reject|retire --repo PATH --assignment ID --actor TASK
relay recover --repo PATH --ticket GENERATED --actor CREATOR --resolution FILE
relay status --repo PATH [--assignment ID]
relay inspect-lock --repo PATH --actor OPERATOR
relay recover-lock --repo PATH --token EXACT --commands-stopped

Public responses name the actor, permitted source activity and one next action.
READY is cooperative permission, not filesystem enforcement. Stop all writers
before handoff or recovery. Final capture and native observations require exact
external evidence; fixture files prove only the source contract. See README.md.
`;
let context = {};
let instance;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string' }, actor: { type: 'string' }, spec: { type: 'string' }, ticket: { type: 'string' }, assignment: { type: 'string' },
    observation: { type: 'string' }, event: { type: 'string' }, envelope: { type: 'string' }, decision: { type: 'string' }, resolution: { type: 'string' }, token: { type: 'string' },
    'commands-stopped': { type: 'boolean' }, help: { type: 'boolean' },
  }});
  context = values;
  const [operation] = positionals;
  if (values.help || operation === 'help' || !operation) { process.stdout.write(help); }
  else {
    const relay = new Relay(values.repo ?? process.cwd());
    instance = relay;
    const file = key => JSON.parse(readFileSync(values[key], 'utf8'));
    let result;
    if (operation === 'prepare') result = relay.prepare(file('spec'), values.actor);
    else if (operation === 'record-native') result = relay.recordNative(values.assignment, values.actor, file('observation'));
    else if (operation === 'start') result = relay.start(values.ticket, values.actor);
    else if (operation === 'handoff') result = relay.handoff(values.ticket, values.actor, file('spec'));
    else if (operation === 'finish') result = relay.finish(values.ticket, values.actor);
    else if (operation === 'verify') result = relay.verify(values.ticket, values.actor, values.decision);
    else if (operation === 'recover') result = relay.recover(values.ticket, values.actor, file('resolution'));
    else if (operation === 'status') result = relay.status(values.assignment);
    else if (operation === 'inspect-lock') {
      const lock = JSON.parse(readFileSync(relay.store.root + '/transition.lock', 'utf8'));
      result = relay.response(values.actor ?? 'recovering operator', 'none', relay.command('recover-lock', { token: lock.token, actor: values.actor ?? 'recovering operator' }) + ' --commands-stopped', { status: 'LOCKED', lock, prerequisite: 'Stop all competing Relay commands before the generated recovery action. This grants no source permission.' });
    } else if (operation === 'recover-lock') {
      relay.store.recoverLock({ token: values.token, commandsStopped: values['commands-stopped'] });
      result = relay.response(values.actor ?? 'recovering operator', 'none', 'Inspect the current assignment; command-lock recovery grants no source permission.', { status: 'LOCK_RECOVERED' });
    } else result = relay.report(operation, values.assignment, values.actor,
      operation === 'capture' ? file('event') : operation === 'observe-report' ? file('observation') : operation === 'receive' ? { envelope: file('envelope'), decision: values.decision } : {});
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  const assignment = context.assignment ?? context.ticket?.split(':')[0];
  const nextAction = instance && /lock exists/.test(error.message) ? instance.command('inspect-lock', { actor: context.actor ?? 'recovering operator' })
    : instance ? instance.command('status', assignment ? { assignment } : {}) : 'relay --help';
  process.stderr.write(JSON.stringify({ status: 'REFUSED', actor: context.actor ?? 'invoking operator', permittedSourceActivity: 'none under this command', reason: error.message, nextAction }) + '\n');
  process.exitCode = 1;
}
