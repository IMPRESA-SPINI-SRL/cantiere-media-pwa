import { LIMITS, SITE_STATUSES, STORE_NAMES } from './config.js?v=1.1.0';
import {
  countMediaForSite,
  deleteMediaCascade,
  deleteRecord,
  getAllByIndex,
  getAllRecords,
  getMediaIdsForSite,
  getRecord,
  putRecord,
} from './db.js?v=1.1.0';
import { canManageSites } from './permissions.js?v=1.1.0';
import { createId, normalizeText, sleep } from './utils.js?v=1.1.0';

async function requireAdministrator(actor) {
  const storedActor = actor?.id
    ? await getRecord(STORE_NAMES.USERS, actor.id)
    : null;
  if (!canManageSites(storedActor)) {
    throw new Error('Operazione riservata agli amministratori.');
  }
  return storedActor;
}

function validateSiteInput(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Il nome del cantiere e obbligatorio.');
  const status = input.status ?? SITE_STATUSES.ACTIVE;
  if (![SITE_STATUSES.ACTIVE, SITE_STATUSES.COMPLETED].includes(status)) {
    throw new Error('Stato del cantiere non valido.');
  }
  return {
    name,
    nameNormalized: normalizeText(name),
    client: String(input.client ?? '').trim(),
    address: String(input.address ?? '').trim(),
    status,
  };
}

async function ensureUniqueName(nameNormalized, ignoredId = null) {
  const sites = await getAllByIndex(
    STORE_NAMES.SITES,
    'nameNormalized',
    IDBKeyRange.only(nameNormalized),
  );
  if (sites.some((site) => site.id !== ignoredId)) {
    throw new Error('Esiste gia un cantiere con questo nome.');
  }
}

export async function listSites({ includeDeleting = false } = {}) {
  const sites = await getAllRecords(STORE_NAMES.SITES);
  const rank = {
    [SITE_STATUSES.ACTIVE]: 0,
    [SITE_STATUSES.COMPLETED]: 1,
    [SITE_STATUSES.DELETING]: 2,
  };
  return sites
    .filter((site) => includeDeleting || site.status !== SITE_STATUSES.DELETING)
    .sort((left, right) => (
      (rank[left.status] ?? 9) - (rank[right.status] ?? 9)
      || left.name.localeCompare(right.name, 'it-IT')
    ));
}

export async function getSite(siteId) {
  return getRecord(STORE_NAMES.SITES, siteId);
}

export async function createSite(actor, input) {
  await requireAdministrator(actor);
  const data = validateSiteInput(input);
  await ensureUniqueName(data.nameNormalized);
  const timestamp = Date.now();
  const site = {
    id: createId('site'),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await putRecord(STORE_NAMES.SITES, site);
  return site;
}

export async function updateSite(actor, siteId, input) {
  await requireAdministrator(actor);
  const existing = await getSite(siteId);
  if (!existing) throw new Error('Cantiere non trovato.');
  if (existing.status === SITE_STATUSES.DELETING) {
    throw new Error('Il cantiere e in eliminazione.');
  }
  const data = validateSiteInput({ ...existing, ...input });
  await ensureUniqueName(data.nameNormalized, siteId);
  const updated = {
    ...existing,
    ...data,
    updatedAt: Date.now(),
  };
  await putRecord(STORE_NAMES.SITES, updated);
  return updated;
}

export async function getSiteMediaCount(siteId) {
  return countMediaForSite(siteId);
}

export async function deleteSiteInBatches(
  actor,
  siteId,
  onProgress = () => {},
  { expectedUpdatedAt = null } = {},
) {
  const storedActor = await requireAdministrator(actor);
  const existing = await getSite(siteId);
  if (!existing) return { deletedMedia: 0 };
  if (expectedUpdatedAt != null && existing.updatedAt !== expectedUpdatedAt) {
    throw new Error('Il cantiere e stato modificato. Ripetere la conferma di eliminazione.');
  }

  if (existing.status !== SITE_STATUSES.DELETING) {
    await putRecord(STORE_NAMES.SITES, {
      ...existing,
      previousStatus: existing.status,
      status: SITE_STATUSES.DELETING,
      deletionStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  let deletedMedia = 0;
  while (true) {
    await requireAdministrator(storedActor);
    const ids = await getMediaIdsForSite(siteId, LIMITS.SITE_DELETE_BATCH_SIZE);
    if (!ids.length) break;
    await deleteMediaCascade(ids);
    deletedMedia += ids.length;
    onProgress({ deletedMedia });
    await sleep(0);
  }

  await deleteRecord(STORE_NAMES.SITES, siteId);
  return { deletedMedia };
}

export async function resumePendingSiteDeletions(actor, onProgress = () => {}) {
  const storedActor = await requireAdministrator(actor);
  const pending = await getAllByIndex(
    STORE_NAMES.SITES,
    'status',
    IDBKeyRange.only(SITE_STATUSES.DELETING),
  );
  for (const site of pending) {
    await deleteSiteInBatches(storedActor, site.id, (progress) => onProgress({ site, ...progress }));
  }
}
