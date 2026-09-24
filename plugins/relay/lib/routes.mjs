import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message) => { if (!condition) throw Error(message); };
function writeNew(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  } catch (error) {
    // Exclusive creation succeeded: remove our incomplete file, never an existing lock.
    unlinkSync(path);
    throw error;
  }
}
function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export class Routes {
  constructor(cwd) {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    this.root = join(realpathSync(resolve(cwd, common)), 'relay');
    this.file = join(this.root, 'routes.json');
    this.lock = join(this.root, 'routes.lock');
  }
  assertCurrent() {
    check(!existsSync(join(this.root, 'control.json')), 'Legacy Relay control.json exists. Finish or stop its tasks and explicitly retire old state before registering Relay 0.4 routes; no automatic migration.');
  }
  read() {
    this.assertCurrent();
    if (!existsSync(this.file)) return { schema: 1, routes: {} };
    const registry = JSON.parse(readFileSync(this.file, 'utf8'));
    check(object(registry) && registry.schema === 1 && object(registry.routes)
      && Object.keys(registry).sort().join(',') === 'routes,schema', 'Invalid Relay routing registry');
    for (const [worker, route] of Object.entries(registry.routes)) {
      check(uuid(worker) && object(route) && uuid(route.manager) && uuid(route.id)
        && worker !== route.manager && Object.keys(route).sort().join(',') === 'id,manager', 'Invalid Relay route');
    }
    return registry;
  }
  update(worker, manager, remove = false) {
    check(uuid(worker) && uuid(manager) && worker !== manager, 'Worker and manager must be distinct real native task UUIDs');
    this.assertCurrent();
    if (remove && !existsSync(this.root)) return { status: 'unregistered', worker };
    mkdirSync(this.root, { recursive: true });
    try { writeNew(this.lock, { token: randomUUID(), pid: process.pid }); }
    catch (error) {
      if (error.code === 'EEXIST') throw Error('Relay routing lock exists. Inspect it; recover only after all registry commands have stopped.');
      throw error;
    }
    try {
      const registry = this.read();
      const prior = registry.routes[worker];
      check(!prior || prior.manager === manager, 'Worker already has a different manager; unregister with the expected manager first');
      if ((!remove && !prior) || (remove && prior)) {
        if (remove) delete registry.routes[worker];
        else registry.routes[worker] = { manager, id: randomUUID() };
        const temporary = join(this.root, `${randomUUID()}.tmp`);
        try { writeNew(temporary, registry); renameSync(temporary, this.file); syncDirectory(this.root); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }
      return { status: remove ? 'unregistered' : 'registered', worker, ...(remove ? {} : { route: registry.routes[worker] }) };
    } finally { unlinkSync(this.lock); }
  }
  inspectLock() {
    const text = readFileSync(this.lock, 'utf8');
    let lock;
    try { lock = JSON.parse(text); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    check(object(lock) && uuid(lock.token),
      `Incomplete Relay routing lock: ${this.lock}. Stop all registry commands before manually removing only this lock; preserve routes.json.`);
    return lock;
  }
  recoverLock(token, commandsStopped) {
    check(commandsStopped === true && uuid(token) && this.inspectLock().token === token, 'Stop registry commands and provide the exact inspected lock token');
    unlinkSync(this.lock);
    syncDirectory(this.root);
    return { status: 'lock-recovered' };
  }
}
