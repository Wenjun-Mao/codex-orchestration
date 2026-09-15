import { requireThat } from './store.mjs';
import { clean, git, same } from './source.mjs';

export const taskSettled = record => record.archive?.status === 'archived'
  || record.creation.disposition?.kind === 'not-created';

export function disposeUncreated(relay, id, actor, resolution) {
  return relay.store.locked(control => {
    const record = relay.record(control, id);
    requireThat(actor === record.creator, 'Creation disposal belongs to the creating actor');
    requireThat(record.checkout === relay.repo.checkout, 'Wrong retained checkout');
    requireThat(resolution?.actionId === record.creation.id && resolution.neverInvoked === true
      && typeof resolution.reason === 'string' && resolution.reason.trim(),
    'Exact creation action, explicit neverInvoked confirmation and reason required');
    const disposition = { kind: 'not-created', actor, ...resolution };
    // Accept only the public fields; callers cannot override the disposition kind.
    requireThat(Object.keys(resolution).every(key => ['actionId', 'neverInvoked', 'reason'].includes(key)), 'Unknown disposal field');
    requireThat(control.permission?.assignment !== id && record.outcome === 'revoked'
      && !record.enabled && !record.task && !record.creation.provisional
      && record.creation.status === 'awaiting-observation' && !record.archive,
    'Disposal requires revoked, never-enabled creation with no native observation or archive');
    if (record.creation.disposition) {
      requireThat(same(record.creation.disposition, disposition), 'Creation disposition conflicts with recorded value');
    } else {
      record.creation.disposition = disposition;
      relay.store.commit(control, [record]);
    }
    return relay.reportingResponse(record);
  });
}

export function adoptBaseline(relay, actor, resolution) {
  return relay.store.locked(control => {
    requireThat(typeof actor === 'string' && actor.trim(), 'Explicit adopting actor required');
    requireThat(control.approved && !control.permission, 'Baseline adoption requires an approved idle source');
    requireThat(resolution?.writersStopped === true && typeof resolution.reason === 'string' && resolution.reason.trim()
      && /^[a-f0-9]{40,64}$/.test(resolution.previousRevision ?? '')
      && /^[a-f0-9]{40,64}$/.test(resolution.revision ?? '') && typeof resolution.branch === 'string',
    'Explicit previous/current revisions, branch, stopped writers and reason required');
    requireThat(Object.keys(resolution).every(key => ['previousRevision', 'revision', 'branch', 'writersStopped', 'reason'].includes(key)), 'Unknown adoption field');
    requireThat(control.approved.checkout === relay.repo.checkout && control.approved.branch === resolution.branch,
      'Adoption must retain the approved checkout and branch');
    const actual = clean(relay.repo.checkout, resolution.branch, resolution.revision);
    const adoption = { actor, ...resolution };
    if (control.approved.head === resolution.revision && same(control.lastAdoption, adoption)) {
      return relay.response(actor, 'none', 'Prepare the next approved assignment.', { status: 'ALREADY_ADOPTED', checkpoint: control.approved });
    }
    requireThat(control.approved.head === resolution.previousRevision, 'Previous approved revision changed; inspect status');
    git(relay.repo.checkout, 'merge-base', '--is-ancestor', resolution.previousRevision, actual.head);
    control.approved = { ...control.approved, head: actual.head };
    control.lastAdoption = adoption;
    relay.store.commit(control);
    return relay.response(actor, 'none', 'Prepare the next approved assignment.', { status: 'BASELINE_ADOPTED', checkpoint: control.approved });
  });
}
