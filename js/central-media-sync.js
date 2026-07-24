import { ALL_SITES_ID } from './config.js?v=1.8.1';
import {
  getSetting,
  removeRemoteMediaBatch,
  setSetting,
  upsertRemoteMediaBatch,
} from './db.js?v=1.8.1';
import { listRemoteMediaChanges } from './media-api.js?v=1.8.1';

const CHECKPOINT_PREFIX = 'central-media-checkpoint-v1::';
const inFlight = new Map();

function normalizeScope(siteId) {
  return siteId || ALL_SITES_ID;
}

function checkpointKey(siteId) {
  return `${CHECKPOINT_PREFIX}${normalizeScope(siteId)}`;
}

async function runCentralMediaSynchronization(siteId, { reset = false } = {}) {
  const scope = normalizeScope(siteId);
  if (!navigator.onLine) {
    return { online: false, scope, added: 0, removed: 0, changed: false };
  }

  const key = checkpointKey(scope);
  let since = reset ? '' : await getSetting(key, '');
  let cursor = '';
  let checkpoint = since;
  let added = 0;
  let removed = 0;
  let pages = 0;

  do {
    const result = await listRemoteMediaChanges({
      siteId: scope,
      since,
      cursor,
      limit: 200,
    });
    const items = Array.isArray(result.items) ? result.items : [];
    const completed = items.filter((item) => item.status === 'completed');
    const tombstones = items.filter((item) => item.status === 'deleted' || item.status === 'missing');

    if (completed.length) added += (await upsertRemoteMediaBatch(completed)).length;
    if (tombstones.length) removed += (await removeRemoteMediaBatch(tombstones)).length;

    cursor = result.nextCursor || '';
    checkpoint = result.checkpoint || checkpoint;
    pages += 1;
    if (pages > 1000) throw new Error('Sincronizzazione archivio troppo estesa.');
  } while (cursor);

  if (checkpoint) await setSetting(key, checkpoint);
  return {
    online: true,
    scope,
    added,
    removed,
    changed: added > 0 || removed > 0,
    checkpoint,
  };
}

export function synchronizeCentralMedia(siteId, options = {}) {
  const scope = normalizeScope(siteId);
  if (inFlight.has(scope)) return inFlight.get(scope);
  const operation = runCentralMediaSynchronization(scope, options)
    .catch(async (error) => {
      if (!options.reset && ['INVALID_CHECKPOINT', 'INVALID_CURSOR'].includes(error?.code)) {
        return runCentralMediaSynchronization(scope, { reset: true });
      }
      throw error;
    })
    .finally(() => inFlight.delete(scope));
  inFlight.set(scope, operation);
  return operation;
}

export function centralMediaSynchronizationRunning(siteId) {
  return inFlight.has(normalizeScope(siteId));
}
