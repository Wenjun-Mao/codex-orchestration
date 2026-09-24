import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Routes } from '../lib/routes.mjs';
import { captureStopEvent, processStopEvent } from '../lib/final-hook.mjs';

const cli = fileURLToPath(new URL('../bin/relay.mjs', import.meta.url));
const hook = fileURLToPath(new URL('../bin/relay-final-hook.mjs', import.meta.url));
function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'relay-routing-test-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'baseline');
  const routes = new Routes(repo);
  const worker = randomUUID(), manager = randomUUID();
  const command = (...args) => spawnSync(process.execPath, [cli, ...args, '--repo', repo], { encoding: 'utf8' });
  const event = { hook_event_name: 'Stop', session_id: worker, turn_id: 'turn-1', cwd: repo, last_assistant_message: 'Exact final 雪\n' };
  return { repo, routes, worker, manager, git, command, event };
}

test('status, missing routes and absent unregister are read-only', t => {
  const f = fixture(t);
  assert.equal(f.command('status').status, 0);
  assert.equal(captureStopEvent(f.event).status, 'ignored');
  f.routes.update(f.worker, f.manager, true);
  assert.equal(existsSync(f.routes.root), false);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('real CLI registration replay, conflicts, expected-manager removal and fresh identity', t => {
  const f = fixture(t);
  const args = ['--worker', f.worker, '--manager', f.manager];
  assert.equal(f.command('register', ...args).status, 0);
  const original = readFileSync(f.routes.file, 'utf8');
  assert.equal(f.command('register', ...args).status, 0);
  assert.equal(readFileSync(f.routes.file, 'utf8'), original);
  assert.notEqual(f.command('register', '--worker', f.worker, '--manager', randomUUID()).status, 0);
  assert.notEqual(f.command('unregister', '--worker', f.worker, '--manager', randomUUID()).status, 0);
  assert.equal(readFileSync(f.routes.file, 'utf8'), original);
  assert.equal(f.command('unregister', ...args).status, 0);
  assert.equal(f.command('unregister', ...args).status, 0);
  assert.equal(f.command('register', ...args).status, 0);
  assert.notEqual(readFileSync(f.routes.file, 'utf8'), original);
  for (const [worker, manager] of [[f.worker, f.worker], ['client-new-thread:123', f.manager], ['__proto__', f.manager]]) {
    assert.throws(() => f.routes.update(worker, manager), /distinct real/);
  }
  assert.match(f.command('finish', '--ticket', 'old').stderr, /Unsupported command/);
  assert.deepEqual(readdirSync(f.routes.root), ['routes.json']);
});

test('short lock prevents competing mutation; recovery is explicit and token-bound', t => {
  const f = fixture(t);
  f.routes.update(f.worker, f.manager);
  const token = randomUUID(), before = readFileSync(f.routes.file, 'utf8');
  writeFileSync(f.routes.lock, JSON.stringify({ token, pid: 0 }));
  assert.throws(() => f.routes.update(randomUUID(), f.manager), /lock exists/);
  assert.equal(f.routes.read().routes[f.worker].manager, f.manager);
  assert.equal(readFileSync(f.routes.file, 'utf8'), before);
  assert.throws(() => f.routes.recoverLock(token, false), /Stop registry/);
  assert.throws(() => f.routes.recoverLock(randomUUID(), true), /Stop registry/);
  f.routes.recoverLock(token, true);
  assert.equal(existsSync(f.routes.lock), false);
  f.routes.update(randomUUID(), f.manager);
  assert.equal(Object.keys(f.routes.read().routes).length, 2);
});

test('malformed schema and legacy state are diagnostic and unchanged', t => {
  const f = fixture(t);
  f.routes.update(f.worker, f.manager);
  for (const value of ['{', 'null', '{"schema":2,"routes":{}}', '{"schema":1,"routes":[]}',
    JSON.stringify({ schema: 1, routes: { [f.worker]: { manager: f.worker, id: randomUUID() } } })]) {
    writeFileSync(f.routes.file, value);
    assert.throws(() => f.routes.read());
    assert.throws(() => f.routes.update(f.worker, f.manager));
    const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(f.event), encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(f.routes.file, 'utf8'), value);
    assert.equal(existsSync(f.routes.lock), false);
  }
  const legacy = join(f.routes.root, 'control.json');
  writeFileSync(legacy, '{"untouched":true}');
  assert.throws(() => f.routes.update(f.worker, f.manager), /Legacy/);
  assert.equal(readFileSync(legacy, 'utf8'), '{"untouched":true}');
});

test('failed atomic replacement preserves target and removes temporary file and lock', t => {
  const f = fixture(t);
  mkdirSync(f.routes.file, { recursive: true });
  const marker = join(f.routes.file, 'preserved');
  writeFileSync(marker, 'unchanged');
  // Inject the read result to reach the write boundary; an actual directory
  // prevents rename from replacing the destination.
  f.routes.read = () => ({ schema: 1, routes: {} });
  assert.throws(() => f.routes.update(f.worker, f.manager));
  assert.equal(readFileSync(marker, 'utf8'), 'unchanged');
  assert.deepEqual(readdirSync(f.routes.root), ['routes.json']);
});

test('failed lock initialization removes only its own lock and preserves registered routes', t => {
  const f = fixture(t);
  f.routes.update(f.worker, f.manager);
  const before = readFileSync(f.routes.file, 'utf8');
  for (const boundary of ['writeFileSync', 'fsyncSync']) {
    const originalOpen = fs.openSync, originalOperation = fs[boundary];
    let lockFd;
    fs.openSync = (...args) => {
      const fd = originalOpen(...args);
      if (args[0] === f.routes.lock) lockFd = fd;
      return fd;
    };
    fs[boundary] = (...args) => {
      if (args[0] === lockFd) throw Object.assign(new Error('Injected lock initialization failure'), { code: 'ENOSPC' });
      return originalOperation(...args);
    };
    syncBuiltinESMExports();
    try { assert.throws(() => f.routes.update(randomUUID(), f.manager), { code: 'ENOSPC' }); }
    finally { fs.openSync = originalOpen; fs[boundary] = originalOperation; syncBuiltinESMExports(); }
    assert.equal(existsSync(f.routes.lock), false);
    assert.equal(readFileSync(f.routes.file, 'utf8'), before);
  }
  f.routes.update(randomUUID(), f.manager);
  assert.equal(Object.keys(f.routes.read().routes).length, 2);
  writeFileSync(f.routes.lock, '');
  assert.throws(() => f.routes.update(randomUUID(), f.manager), /lock exists/);
  assert.throws(() => f.routes.inspectLock(), /Incomplete Relay routing lock/);
  assert.throws(() => f.routes.recoverLock(randomUUID(), true), /Incomplete Relay routing lock/);
  assert.equal(readFileSync(f.routes.lock, 'utf8'), '');
});

test('continued finals keep exact replay identity but distinguish corrections in the same turn', async t => {
  const f = fixture(t), sent = [];
  f.routes.update(f.worker, f.manager);
  const submit = async request => { sent.push(request); return { status: 'queued' }; };
  const corrected = { ...f.event, stop_hook_active: true, last_assistant_message: 'Corrected final 雪\n' };
  for (const event of [f.event, { ...f.event, stop_hook_active: true }, corrected, corrected,
    { ...corrected, turn_id: 'next-turn' }]) {
    assert.equal((await processStopEvent(event, { submit })).status, 'queued');
  }
  assert.equal(sent[0].id, sent[1].id);
  assert.notEqual(sent[0].id, sent[2].id);
  assert.equal(sent[2].id, sent[3].id);
  assert.notEqual(sent[3].id, sent[4].id);
  assert.equal(sent[2].text, corrected.last_assistant_message);
  assert.deepEqual(readdirSync(f.routes.root), ['routes.json']);
});

test('hierarchical routing forwards all finals without lifecycle or source checks/writes', async t => {
  const f = fixture(t), director = randomUUID();
  f.routes.update(f.worker, f.manager);
  f.routes.update(f.manager, director);
  f.git('checkout', '--detach', '-q');
  writeFileSync(join(f.repo, 'untracked.txt'), 'dirty');
  const before = readFileSync(f.routes.file, 'utf8'), head = f.git('rev-parse', 'HEAD');
  const requests = [];
  const submit = async request => { requests.push(request); return { status: 'queued' }; };
  for (const event of [f.event, f.event, { ...f.event, session_id: f.manager }]) {
    assert.equal((await processStopEvent(event, { submit })).status, 'queued');
  }
  assert.equal(requests[0].text, f.event.last_assistant_message);
  assert.equal(requests[0].recipient, f.manager);
  assert.equal(requests[2].recipient, director);
  assert.equal(requests[0].id, requests[1].id);
  assert.notEqual(requests[0].id, requests[2].id);
  assert.equal(captureStopEvent({ ...f.event, stop_hook_active: true }).status, 'ready');
  assert.equal(captureStopEvent({ ...f.event, session_id: 'toString' }).status, 'ignored');
  let calls = 0;
  const failure = await processStopEvent(f.event, { submit: async () => { calls++; throw Error('uncertain'); } });
  assert.equal(calls, 1);
  assert.equal(failure.status, 'ambiguous');
  assert.equal(readFileSync(f.routes.file, 'utf8'), before);
  assert.deepEqual(readdirSync(f.routes.root), ['routes.json']);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(join(f.repo, 'untracked.txt'), 'utf8'), 'dirty');
  f.routes.update(f.worker, f.manager, true);
  assert.equal(captureStopEvent(f.event).status, 'ignored');
});

test('linked worktrees share one routing registry', t => {
  const f = fixture(t);
  const linked = join(f.repo, 'linked');
  f.git('worktree', 'add', '--detach', linked, 'HEAD');
  f.routes.update(f.worker, f.manager);
  assert.equal(new Routes(linked).root, f.routes.root);
  assert.equal(captureStopEvent({ ...f.event, cwd: linked }).notification.recipient, f.manager);
});

test('worker startup registration delivers before manager discovery; fallback preserves route', async t => {
  const f = fixture(t), linked = join(f.repo, 'worker');
  f.git('worktree', 'add', '--detach', linked, 'HEAD');
  const startup = spawnSync(process.execPath, [cli, 'register', '--repo', linked,
    '--worker', f.worker, '--manager', f.manager], { encoding: 'utf8' });
  assert.equal(startup.status, 0, startup.stderr);
  const before = readFileSync(f.routes.file, 'utf8'), requests = [];
  const result = await processStopEvent({ ...f.event, cwd: linked }, {
    submit: async request => { requests.push(request); return { status: 'queued' }; },
  });
  assert.equal(result.status, 'queued');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].recipient, f.manager);
  assert.equal(requests[0].text, f.event.last_assistant_message);
  assert.equal(f.command('register', '--worker', f.worker, '--manager', f.manager).status, 0);
  assert.equal(readFileSync(f.routes.file, 'utf8'), before);
  assert.notEqual(f.command('register', '--worker', f.worker, '--manager', randomUUID()).status, 0);
  assert.equal(readFileSync(f.routes.file, 'utf8'), before);
});
