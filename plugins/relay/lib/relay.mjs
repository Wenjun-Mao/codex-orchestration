import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, requireThat } from './store.mjs';
import { repository, git, clean, snapshot, inspectResult, runChecks, validateScope, validateChecks, inScope, refuseFlow } from './source.mjs';
import { reportOperation } from './reports.mjs';

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export class Relay {
  constructor(cwd, options = {}) {
    this.repo = repository(cwd);
    this.store = new Store(this.repo.root, options.fault);
  }
  command(operation, args = {}) {
    return `${quote(process.execPath)} ${quote(fileURLToPath(new URL('../bin/relay.mjs', import.meta.url)))} ${operation} --repo ${quote(this.repo.checkout)}` + Object.entries(args).map(([key, value]) => ` --${key} ${quote(value)}`).join('');
  }
  response(actor, activity, next, extra = {}) { return { actor, permittedSourceActivity: activity, nextAction: next, ...extra }; }
  record(control, id) { return this.store.assignment(control, id); }
  current(control, ticket, actor, modes) {
    const p = control.permission;
    requireThat(p && `${p.assignment}:${p.generation}` === ticket && p.actor === actor && modes.includes(p.mode), 'No current permission for this actor/ticket/operation; inspect status without writing');
    const record = this.record(control, p.assignment);
    requireThat(record.checkout === this.repo.checkout, 'Wrong retained checkout');
    // The new generation inherits an exact checkpoint, even when aggregate scope starts earlier.
    git(this.repo.checkout, 'merge-base', '--is-ancestor', p.checkpoint, 'HEAD');
    return record;
  }
  transfer(control, assignment, actor, mode, checkpoint) {
    control.generation += 1;
    control.permission = assignment ? { assignment, actor, mode, checkpoint, generation: control.generation } : null;
    return assignment ? `${assignment}:${control.generation}` : null;
  }
  permissionResponse(control, record) {
    const p = control.permission;
    if (!p || p.assignment !== record.id) return this.reportingResponse(record);
    const ticket = `${record.id}:${p.generation}`;
    if (p.mode === 'reserved') {
      return this.response(record.task ?? record.creator, 'none', record.task
        ? this.command('start', { ticket, actor: record.task })
        : this.command('record-native', { assignment: record.id, actor: record.creator, observation: '<exact-creation-observation.json>' }),
      { status: record.task ? 'BOUND' : 'BINDING_PENDING', assignment: record.id, ticket });
    }
    const next = p.mode === 'write' ? this.command('finish', { ticket, actor: p.actor })
      : p.mode === 'verify' ? this.command('verify', { ticket, actor: p.actor, decision: 'finish' })
        : this.command('recover', { ticket, actor: record.creator, resolution: '<source-resolution.json>' });
    return this.response(p.actor, p.mode === 'write' ? 'write within recorded scope; no detached writers' : p.mode === 'verify' ? 'read-only verification; no source edits' : 'none; stop all source writers', next,
      { status: p.mode === 'write' ? 'READY' : p.mode.toUpperCase(), assignment: record.id, ticket, checkpoint: p.checkpoint, scope: record.scope });
  }
  reportingResponse(record) {
    const args = { assignment: record.id };
    const response = (actor, next, status) => this.response(actor, 'none', next, { status, assignment: record.id });
    if (!record.outcome) return response(record.task ?? record.creator, 'Wait for the current executor to transfer its exact result; do not edit the retained checkout.', 'DELEGATED');
    if (!record.task) return response(record.creator, this.command('record-native', { ...args, actor: record.creator, observation: '<exact-creation-observation.json>' }), 'ORPHAN_IDENTITY_PENDING');
    if (!record.report.final) return response(record.task, `Emit the genuine native final for correlation ${record.report.correlation}; capture must use the frozen result association.`, 'CAPTURE_PENDING');
    if (!record.report.submission) return response(record.task, this.command('submit', { ...args, actor: record.task }), 'SUBMISSION_PENDING');
    if (!record.report.receipt) return response(record.recipient, this.command('receive', { ...args, actor: record.recipient, envelope: '<actually-received-envelope.json>' }), 'RECEIPT_PENDING');
    if (!record.decision) return response(record.recipient, this.command('accept', { ...args, actor: record.recipient }), 'DECISION_PENDING');
    if (!record.archive) return response(record.recipient, this.command('retire', { ...args, actor: record.recipient }), 'RETIREMENT_PENDING');
    if (record.archive.status !== 'archived') return response(record.recipient, this.command('record-native', { ...args, actor: record.recipient, observation: '<exact-archive-observation.json>' }), 'ARCHIVE_PENDING');
    return response(record.recipient, 'Task retired; prepare the next approved assignment when needed.', 'RETIRED');
  }
  specification(spec) {
    requireThat(spec && typeof spec.outcome === 'string' && spec.outcome.length, 'Outcome required');
    requireThat(typeof spec.plan === 'string' && spec.plan.length && typeof spec.acceptance === 'string' && spec.acceptance.length, 'Approved plan and acceptance required');
    requireThat(typeof spec.projectId === 'string' && spec.projectId.length, 'Missing saved native project: select an existing project before preparation');
    requireThat(spec.selector?.model && spec.selector?.thinking, 'Explicit model and thinking selector required');
    validateScope(spec.scope); validateChecks(spec.checks);
  }
  newRecord(spec, baseline, creator, parent = null) {
    const id = randomUUID();
    return { schema: 1, id, creator, parent, role: parent ? 'executor' : 'coordinator', checkout: this.repo.checkout,
      branch: baseline.branch, baseline: baseline.head, scope: spec.scope, checks: spec.checks,
      outcomeIntent: spec.outcome, plan: spec.plan, acceptance: spec.acceptance,
      projectId: spec.projectId, selector: spec.selector, recipient: parent ? creator : spec.recipient,
      task: null, enabled: false, decision: null, outcome: null,
      creation: { id: randomUUID(), status: 'awaiting-observation', provisional: null },
      report: { correlation: randomUUID(), sender: null, recipient: parent ? creator : spec.recipient, association: null, final: null, submission: null, receipt: null },
    };
  }
  creationResponse(control, record) {
    const p = this.permissionResponse(control, record);
    const start = this.command('start', { ticket: p.ticket, actor: '<actual-native-task-id>' });
    const prompt = `Deliver: ${record.outcomeIntent}\nApproved plan: ${record.plan}\nScope: ${record.scope.join(', ')}\nAcceptance: ${record.acceptance}\nRole: ${record.role}; model ${record.selector.model}; thinking ${record.selector.thinking}.\nStart: ${start}\nNo writes before READY. Only the current ticket permits work; stop all source-changing tools before handoff/finish. Checks are read-only. Preserve failures. Emit your real final after source release; do not synthesize native events. Source-stage adapter qualification is still pending.`;
    return { ...p, nativeAction: { id: record.creation.id, kind: 'create', args: { target: { type: 'project', projectId: record.projectId, environment: { type: 'local' } }, model: record.selector.model, thinking: record.selector.thinking, prompt } },
      nextAction: 'Invoke this exact prepared native creation once, then record its actual observation using the returned command.', recordCommand: p.nextAction };
  }
  prepare(spec, actor) {
    return this.store.locked(control => {
      refuseFlow(this.repo.common);
      this.specification(spec);
      requireThat(actor && spec.recipient, 'Exact creator and report recipient required');
      requireThat(!control.permission, 'Source already reserved; no competing preparation');
      const base = clean(this.repo.checkout, spec.branch, control.approved?.head);
      if (control.approved) requireThat(control.approved.checkout === this.repo.checkout && control.approved.branch === spec.branch, 'Selected checkout or branch differs from approved retained source');
      for (const id of spec.dependencies ?? []) requireThat(this.record(control, id).decision === 'accepted', 'Explicit dependency is not accepted');
      const record = this.newRecord(spec, base, actor);
      record.dependencies = spec.dependencies ?? [];
      record.admissionTicket = this.transfer(control, record.id, null, 'reserved', base.head);
      this.store.commit(control, [record]);
      return this.creationResponse(control, record);
    });
  }
  recordNative(id, actor, observation) {
    return this.store.locked(control => {
      const record = this.record(control, id);
      if (observation.kind === 'archive') return reportOperation(this, control, record, 'recordArchive', actor, observation);
      requireThat(actor === record.creator && observation.actionId === record.creation.id, 'Creation actor/action mismatch');
      requireThat(['ready', 'provisional', 'ambiguous'].includes(observation.status), 'Creation observation status required');
      if (record.creation.status === 'ready') {
        requireThat(observation.status === 'ready' && observation.taskId === record.task, 'Native task identity is frozen');
        return this.permissionResponse(control, record);
      }
      if (observation.status === 'ready') {
        requireThat(typeof observation.taskId === 'string' && observation.taskId.length > 0, 'Exact ready task identity required');
        requireThat(!record.creation.provisional || observation.clientThreadId === record.creation.provisional, 'Ready observation must correlate the exact provisional creation');
        record.task = observation.taskId;
        record.report.sender = record.task;
        control.tasks ??= {};
        requireThat(!control.tasks[record.task] || control.tasks[record.task] === record.id, 'Native task already bound to another assignment');
        control.tasks[record.task] = record.id;
        if (record.outcome === 'revoked') this.seal(record, { revision: record.baseline, baseline: record.baseline, producer: record.task, outcome: 'revoked' });
        if (control.permission?.assignment === id && control.permission.mode === 'reserved') control.permission.actor = record.task;
      } else if (observation.status === 'provisional') {
        requireThat(typeof observation.clientThreadId === 'string' && observation.clientThreadId.length, 'Exact provisional identity required');
        requireThat(!record.creation.provisional || record.creation.provisional === observation.clientThreadId, 'Provisional identity conflict');
        record.creation.provisional = observation.clientThreadId;
      }
      record.creation.status = observation.status;
      this.store.commit(control, [record]);
      return this.permissionResponse(control, record);
    });
  }
  start(ticket, actor) {
    return this.store.locked(control => {
      const id = ticket.split(':')[0];
      const record = this.record(control, id);
      requireThat(control.permission?.assignment === id && ['reserved', 'write'].includes(control.permission.mode), 'Reservation revoked or transferred; late start rejected');
      requireThat(record.checkout === this.repo.checkout, 'Wrong retained checkout');
      requireThat(ticket === `${id}:${control.permission.generation}` || (ticket === record.admissionTicket && control.permission.generation === record.startGeneration), 'Stale admission ticket');
      if (!record.task) return this.response(record.creator, 'none', this.command('record-native', { assignment: id, actor: record.creator, observation: '<exact-creation-observation.json>' }), { status: 'BINDING_PENDING' });
      requireThat(actor === record.task, 'Start actor differs from exact native binding');
      if (control.permission.mode === 'write') {
        git(this.repo.checkout, 'merge-base', '--is-ancestor', control.permission.checkpoint, 'HEAD');
        return this.permissionResponse(control, record);
      }
      refuseFlow(this.repo.common);
      clean(this.repo.checkout, record.branch, record.baseline);
      requireThat(record.report.sender === actor && record.report.recipient && record.report.correlation, 'Reporting setup incomplete');
      record.enabled = true;
      this.transfer(control, id, actor, 'write', record.baseline);
      record.startGeneration = control.permission.generation;
      this.store.commit(control, [record]);
      return this.permissionResponse(control, record);
    });
  }
  handoff(ticket, actor, spec) {
    return this.store.locked(control => {
      const parent = this.current(control, ticket, actor, ['write']);
      requireThat(parent.role === 'coordinator', 'Only coordinator can hand off');
      this.specification(spec);
      requireThat(spec.projectId === parent.projectId, 'Executor must use the same saved project');
      requireThat(spec.scope.every(path => inScope(path, parent.scope)), 'Executor scope exceeds coordinator scope');
      const base = clean(this.repo.checkout, parent.branch);
      const checkpoint = inspectResult(this.repo.checkout, parent.baseline, parent.scope, parent.branch);
      runChecks(this.repo.checkout, checkpoint, parent.checks, parent.branch);
      const child = this.newRecord(spec, base, actor, parent.id);
      parent.children = [...(parent.children ?? []), child.id];
      parent.child = child.id;
      child.admissionTicket = this.transfer(control, child.id, null, 'reserved', base.head);
      this.store.commit(control, [parent, child]);
      return this.creationResponse(control, child);
    });
  }
  seal(record, result) {
    record.result = result;
    record.report.association = { assignment: record.id, sender: record.task, recipient: record.recipient, correlation: record.report.correlation, result };
  }
  finish(ticket, actor) {
    return this.store.locked(control => {
      const prior = this.record(control, ticket.split(':')[0]);
      if (prior.finishedTicket === ticket && prior.task === actor) return this.response(actor, 'none', this.command('status', { assignment: prior.id }), { status: 'ALREADY_RELEASED', report: prior.report.association });
      const record = this.current(control, ticket, actor, ['write']);
      {
        const result = { ...inspectResult(this.repo.checkout, record.baseline, record.scope, record.branch), producer: actor, contributors: record.contributors ?? [] };
        if (record.role === 'coordinator') result.verification = runChecks(this.repo.checkout, result, record.checks, record.branch);
        this.seal(record, result);
        record.finishedTicket = ticket;
        record.outcome = record.role === 'coordinator' ? 'verified' : 'awaiting-verification';
        if (record.parent) {
          const parent = this.record(control, record.parent);
          parent.verifying = record.id;
          this.transfer(control, parent.id, parent.task, 'verify', result.revision);
          this.store.commit(control, [record, parent]);
          return this.response(actor, 'none', this.command('verify', { ticket: `${parent.id}:${control.permission.generation}`, actor: parent.task, decision: 'finish' }), { status: 'TRANSFERRED_TO_VERIFICATION', report: record.report.association });
        }
        control.approved = { checkout: record.checkout, branch: record.branch, head: result.revision };
        this.transfer(control, null);
        this.store.commit(control, [record]);
        return this.response(actor, 'none', 'Emit the genuine native final; the qualified capture adapter must correlate the frozen report.', { status: 'SOURCE_RELEASED', report: record.report.association });
      }
    });
  }
  verify(ticket, actor, decision) {
    return this.store.locked(control => {
      requireThat(['continue', 'finish', 'reject'].includes(decision), 'Verification decision must be continue, finish or reject');
      const parent = this.current(control, ticket, actor, ['verify']);
      const child = this.record(control, parent.verifying);
      requireThat(child.result?.revision === control.permission.checkpoint && child.result.producer === child.task, 'Reserved subject or producer mismatch');
      if (decision === 'reject') {
        requireThat(!child.decision || child.decision === 'rejected', 'Accepted result decision is immutable');
        child.decision = 'rejected'; child.outcome = 'rejected';
        this.transfer(control, parent.id, parent.creator, 'recovery', child.result.revision);
        this.store.commit(control, [parent, child]);
        return this.permissionResponse(control, parent);
      }
      requireThat(!child.decision || child.decision === 'accepted', 'Recipient already rejected this result; use verification reject and explicit recovery');
      inspectResult(this.repo.checkout, child.baseline, child.scope, child.branch);
      child.verification = runChecks(this.repo.checkout, child.result, child.checks, child.branch);
      const aggregate = { ...inspectResult(this.repo.checkout, parent.baseline, parent.scope, parent.branch), producer: parent.task, contributors: [...(parent.contributors ?? []), child.task] };
      if (decision === 'finish') aggregate.verification = runChecks(this.repo.checkout, aggregate, parent.checks, parent.branch);
      child.decision = 'accepted'; child.outcome = 'verified';
      parent.contributors = aggregate.contributors;
      delete parent.verifying;
      if (decision === 'continue') {
        this.transfer(control, parent.id, actor, 'write', aggregate.revision);
        // Original scope baseline remains for aggregate verification; checkpoint advances.
      } else {
        this.seal(parent, aggregate); parent.outcome = 'verified';
        control.approved = { checkout: parent.checkout, branch: parent.branch, head: aggregate.revision };
        this.transfer(control, null);
      }
      this.store.commit(control, [parent, child]);
      return this.permissionResponse(control, parent);
    });
  }
  recover(ticket, actor, resolution) {
    return this.store.locked(control => {
      const p = control.permission;
      requireThat(p && `${p.assignment}:${p.generation}` === ticket, 'Recovery ticket is not current');
      const record = this.record(control, p.assignment);
      requireThat(actor === record.creator, 'Recovery belongs to the creating authority');
      requireThat(record.checkout === this.repo.checkout, 'Wrong retained checkout');
      const changed = [];
      if (!record.enabled && p.mode === 'reserved') {
        requireThat(resolution.kind === 'revoke-never-enabled', 'Use exact never-enabled revocation');
        clean(this.repo.checkout, record.branch, record.baseline);
        record.outcome = 'revoked'; record.decision = 'rejected';
      } else {
        requireThat(resolution.kind === 'preserve-and-approve' && resolution.writersStopped === true && resolution.reason, 'Possible writer requires explicit quiescence and source disposition');
        const actual = snapshot(this.repo.checkout);
        requireThat(resolution.revision === actual.head, 'Explicit source disposition must name actual revision');
        requireThat(actual.status === '' && actual.branch === record.branch, 'Preserve and explicitly resolve dirty/untracked source first; no automatic cleanup');
        record.recovery = { ...resolution, observed: actual };
        record.outcome = 'failed'; record.decision = 'rejected';
        if (record.verifying) {
          const child = this.record(control, record.verifying);
          child.outcome = 'failed'; child.decision = 'rejected';
          changed.push(child);
        }
      }
      const actual = clean(this.repo.checkout, record.branch);
      if (record.task && !record.report.association) {
        const childId = record.verifying ?? record.recoveryChild;
        const child = childId ? this.record(control, childId) : null;
        this.seal(record, { kind: 'source-disposition', revision: actual.head, baseline: record.baseline, resolvedBy: actor, reportingTask: record.task, contributors: [...new Set([...(record.contributors ?? []), ...(child?.task ? [child.task] : [])])], outcome: record.outcome });
      }
      if (record.parent) {
        const parent = this.record(control, record.parent);
        parent.recoveryChild = record.id;
        this.transfer(control, parent.id, parent.creator, 'recovery', actual.head);
        this.store.commit(control, [record, parent, ...changed]);
        return this.permissionResponse(control, parent);
      }
      control.approved = { checkout: record.checkout, branch: record.branch, head: actual.head };
      this.transfer(control, null);
      this.store.commit(control, [record, ...changed]);
      return this.response(actor, 'none', this.command('status', { assignment: record.id }), { status: record.outcome, checkpoint: actual.head, nativeTaskObligation: record.creation });
    });
  }
  report(operation, id, actor, input) {
    return this.store.locked(control => reportOperation(this, control, this.record(control, id), operation, actor, input));
  }
  status(id) {
    const control = this.store.control();
    id ??= control.permission?.assignment;
    if (!id) return this.response('director', 'none', 'Prepare the next approved assignment with relay prepare.', { status: 'SOURCE_AVAILABLE', checkpoint: control.approved });
    const record = this.record(control, id);
    if (!record.outcome && record.child && control.permission?.assignment === record.child) {
      const child = this.record(control, record.child);
      return { ...this.permissionResponse(control, child), delegatedBy: record.id, creation: child.creation };
    }
    return { ...this.permissionResponse(control, record), creation: record.creation, outcome: record.outcome, decision: record.decision, report: record.report, archive: record.archive ?? null };
  }
}
