import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
export function readJSON(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function durableWrite(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
}
function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Only control.json grants authority. Unreferenced immutable facts are inert.
export class Store {
  constructor(root, fault = () => {}) {
    this.root = root;
    this.fault = fault;
    mkdirSync(join(root, 'facts'), { recursive: true });
  }
  control() {
    const path = join(this.root, 'control.json');
    const value = existsSync(path) ? readJSON(path) : { schema: 1, generation: 0, permission: null, approved: null, assignments: {} };
    requireThat(value.schema === 1, 'Unsupported current Relay control schema');
    return value;
  }
  assignment(control, id) {
    requireThat(Object.hasOwn(control.assignments, id), 'Unknown assignment');
    const value = readJSON(join(this.root, 'facts', control.assignments[id]));
    requireThat(value.schema === 1 && value.id === id, 'Unsupported or mismatched assignment');
    return value;
  }
  commit(control, records = []) {
    for (const record of records) {
      const name = randomUUID() + '.json';
      durableWrite(join(this.root, 'facts', name), record);
      control.assignments[record.id] = name;
    }
    syncDirectory(join(this.root, 'facts'));
    this.fault('facts-persisted');
    const temporary = join(this.root, randomUUID() + '.tmp');
    durableWrite(temporary, control);
    renameSync(temporary, join(this.root, 'control.json'));
    syncDirectory(this.root);
    this.fault('control-committed');
  }
  locked(fn) {
    const path = join(this.root, 'transition.lock');
    const token = randomUUID();
    try { durableWrite(path, { token, pid: process.pid }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Transition lock exists; stop competing commands, inspect the exact lock, then explicitly recover-lock. No automatic reclamation.');
      throw error;
    }
    try { return fn(this.control()); }
    finally { unlinkSync(path); }
  }
  recoverLock({ token, commandsStopped }) {
    requireThat(commandsStopped === true, 'Explicit confirmation that all competing commands are stopped is required');
    const path = join(this.root, 'transition.lock');
    requireThat(readJSON(path).token === token, 'Lock identity differs; do not reclaim');
    // Safe only under externally established command quiescence. This is not a CAS.
    unlinkSync(path);
    syncDirectory(this.root);
  }
}
