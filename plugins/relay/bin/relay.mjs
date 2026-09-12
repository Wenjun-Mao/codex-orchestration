#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Relay } from '../lib/relay.mjs';

const help = `Relay 0.2.0 — same-host serial source coordination

Genuine work choices go in a spec file:
  {"outcome":"...","plan":"approved plan path","acceptance":"...",
   "branch":"main","projectId":"saved-project-id","recipient":"director-task",
   "recipientHostId":"director-host",
   "selector":{"model":"selected-model","thinking":"selected-effort"},
   "scope":["src/"],"checks":[["node","--test"]],"dependencies":[]}
Checks are argv arrays. Scope is exact paths or directory/ prefixes.

relay prepare --repo PATH --actor TASK --spec FILE
  Generates assignment/ticket, native create arguments and startup brief.
relay record-native-result --repo PATH --assignment ID --actor TASK --action-id ID --result FILE
  Normalize one unmodified purpose-built App tool result. Never retries native actions.
relay record-native --repo PATH --assignment ID --actor TASK --observation FILE
  Low-level injected observation for deterministic source tests only.
relay start --repo PATH --ticket GENERATED --actor-env CODEX_THREAD_ID
  Generated startup reads the invoking Codex task identity from that environment
  variable. Missing or conflicting --actor identity is refused before admission.
  Explicit --actor TASK remains available for authenticated fixtures and API use.
relay handoff --repo PATH --ticket GENERATED --actor TASK --spec FILE
relay finish --repo PATH --ticket GENERATED --actor TASK
relay verify --repo PATH --ticket GENERATED --actor TASK --decision continue|finish|reject
relay capture --repo PATH --assignment ID --actor TASK --event FILE
relay read-report --repo PATH --assignment ID --actor RECIPIENT
relay acknowledge --repo PATH --assignment ID --actor RECIPIENT --event-id ID --digest SHA256 --association-digest SHA256
relay submit --repo PATH --assignment ID --actor TASK
relay prepare-receipt --repo PATH --assignment ID --actor RECIPIENT  # optional native notification
relay observe-report --repo PATH --assignment ID --actor TASK --observation FILE
relay receive --repo PATH --assignment ID --actor TASK --delivery-key KEY [--decision accepted|rejected]
relay accept|reject|retire --repo PATH --assignment ID --actor TASK
relay recover --repo PATH --ticket GENERATED --actor CREATOR --resolution FILE
relay status --repo PATH [--assignment ID]
relay inspect-lock --repo PATH --actor OPERATOR
relay recover-lock --repo PATH --token EXACT --commands-stopped

Public responses name the actor, permitted source activity and one next action.
READY is cooperative permission, not filesystem enforcement. Stop all writers
before handoff or recovery. Final capture and native observations require exact
external evidence; fixture files prove only the source contract.
`;
let context = {};
let instance;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string' }, actor: { type: 'string' }, 'actor-env': { type: 'string' }, spec: { type: 'string' }, ticket: { type: 'string' }, assignment: { type: 'string' },
    observation: { type: 'string' }, event: { type: 'string' }, envelope: { type: 'string' }, result: { type: 'string' }, decision: { type: 'string' }, resolution: { type: 'string' }, token: { type: 'string' },
    'action-id': { type: 'string' }, 'delivery-key': { type: 'string' }, 'event-id': { type: 'string' },
    digest: { type: 'string' }, 'association-digest': { type: 'string' },
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
    else if (operation === 'record-native-result') result = relay.recordNativeResult(values.assignment, values.actor, values['action-id'], file('result'));
    else if (operation === 'record-native') result = relay.recordNative(values.assignment, values.actor, file('observation'));
    else if (operation === 'start') {
      const identityVariable = values['actor-env'];
      const environmentActor = identityVariable ? process.env[identityVariable] : undefined;
      if (identityVariable && !environmentActor) throw new Error(`Runtime identity environment variable ${identityVariable} is missing`);
      if (values.actor && environmentActor && values.actor !== environmentActor) throw new Error('Explicit start actor conflicts with runtime identity');
      const actor = environmentActor ?? values.actor;
      context.actor = actor;
      result = relay.start(values.ticket, actor);
    }
    else if (operation === 'handoff') result = relay.handoff(values.ticket, values.actor, file('spec'));
    else if (operation === 'finish') result = relay.finish(values.ticket, values.actor);
    else if (operation === 'verify') result = relay.verify(values.ticket, values.actor, values.decision);
    else if (operation === 'recover') result = relay.recover(values.ticket, values.actor, file('resolution'));
    else if (operation === 'read-report') result = relay.readReport(values.assignment, values.actor);
    else if (operation === 'status') result = relay.status(values.assignment);
    else if (operation === 'inspect-lock') {
      const lock = JSON.parse(readFileSync(relay.store.root + '/transition.lock', 'utf8'));
      result = relay.response(values.actor ?? 'recovering operator', 'none', relay.command('recover-lock', { token: lock.token, actor: values.actor ?? 'recovering operator' }) + ' --commands-stopped', { status: 'LOCKED', lock, prerequisite: 'Stop all competing Relay commands before the generated recovery action. This grants no source permission.' });
    } else if (operation === 'recover-lock') {
      relay.store.recoverLock({ token: values.token, commandsStopped: values['commands-stopped'] });
      result = relay.response(values.actor ?? 'recovering operator', 'none', 'Inspect the current assignment; command-lock recovery grants no source permission.', { status: 'LOCK_RECOVERED' });
    } else result = relay.report(operation, values.assignment, values.actor,
      operation === 'capture' ? file('event') : operation === 'observe-report' ? file('observation') : operation === 'receive' ? {
        envelope: values.envelope ? file('envelope') : null,
        deliveryKey: values['delivery-key'], decision: values.decision,
      } : operation === 'acknowledge' ? {
        eventId: values['event-id'], digest: values.digest,
        associationDigest: values['association-digest'],
      } : {});
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  const assignment = context.assignment ?? context.ticket?.split(':')[0];
  const nextAction = instance && /lock exists/.test(error.message) ? instance.command('inspect-lock', { actor: context.actor ?? 'recovering operator' })
    : instance ? instance.command('status', assignment ? { assignment } : {}) : 'relay --help';
  process.stderr.write(JSON.stringify({ status: 'REFUSED', actor: context.actor ?? 'invoking operator', permittedSourceActivity: 'none under this command', reason: error.message, nextAction }) + '\n');
  process.exitCode = 1;
}
