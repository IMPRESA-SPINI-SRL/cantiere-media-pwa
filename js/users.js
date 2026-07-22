import { ROLES, STORE_NAMES } from './config.js?v=1.2.0';
import {
  clearLoginThrottle,
  createPinCredentials,
  toPublicUser,
} from './auth.js?v=1.2.0';
import { getAllByIndex, getAllRecords, getRecord, putRecord } from './db.js?v=1.2.0';
import { canManageUsers } from './permissions.js?v=1.2.0';
import { createId, normalizeText } from './utils.js?v=1.2.0';

async function requireAdministrator(actor) {
  const storedActor = actor?.id
    ? await getRecord(STORE_NAMES.USERS, actor.id)
    : null;
  if (!canManageUsers(storedActor)) {
    throw new Error('Operazione riservata agli amministratori.');
  }
  return storedActor;
}

function validateRole(role) {
  if (![ROLES.ADMIN, ROLES.USER].includes(role)) {
    throw new Error('Ruolo non valido.');
  }
}

async function ensureUniqueName(nameNormalized, ignoredId = null) {
  const users = await getAllByIndex(
    STORE_NAMES.USERS,
    'nameNormalized',
    IDBKeyRange.only(nameNormalized),
  );
  if (users.some((user) => user.id !== ignoredId)) {
    throw new Error('Esiste gia un utente con questo nome.');
  }
}

async function ensureAdminContinuity(targetId, nextRole, nextActive) {
  const users = await getAllByIndex(
    STORE_NAMES.USERS,
    'role',
    IDBKeyRange.only(ROLES.ADMIN),
  );
  const target = users.find((user) => user.id === targetId);
  if (!target || target.role !== ROLES.ADMIN || target.active === false) return;
  if (nextRole === ROLES.ADMIN && nextActive !== false) return;

  const otherActiveAdmins = users.filter((user) => (
    user.id !== targetId
    && user.role === ROLES.ADMIN
    && user.active !== false
  ));
  if (!otherActiveAdmins.length) {
    throw new Error('Deve rimanere almeno un amministratore attivo.');
  }
}

export async function listUsers({ activeOnly = false } = {}) {
  const users = await getAllRecords(STORE_NAMES.USERS);
  return users
    .filter((user) => !activeOnly || user.active !== false)
    .map((user) => toPublicUser(user))
    .sort((left, right) => left.name.localeCompare(right.name, 'it-IT'));
}

export async function getUser(userId) {
  return getRecord(STORE_NAMES.USERS, userId);
}

export async function createUser(actor, { name, pin, role = ROLES.USER }) {
  await requireAdministrator(actor);
  validateRole(role);
  const nameNormalized = normalizeText(name);
  if (!nameNormalized) throw new Error('Il nome utente e obbligatorio.');

  await ensureUniqueName(nameNormalized);

  const timestamp = Date.now();
  const record = {
    id: createId('usr'),
    name: String(name).trim(),
    nameNormalized,
    role,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(await createPinCredentials(pin)),
  };
  await putRecord(STORE_NAMES.USERS, record);
  return toPublicUser(record);
}

export async function updateUser(actor, userId, changes) {
  const storedActor = await requireAdministrator(actor);
  const existing = await getUser(userId);
  if (!existing) throw new Error('Utente non trovato.');

  const role = changes.role ?? existing.role;
  const active = changes.active ?? existing.active;
  if (userId === storedActor.id && (role !== existing.role || active === false)) {
    throw new Error('Non puoi cambiare il tuo ruolo o disattivare la sessione corrente.');
  }
  validateRole(role);
  await ensureAdminContinuity(userId, role, active);

  const name = changes.name == null ? existing.name : String(changes.name).trim();
  const nameNormalized = normalizeText(name);
  if (!nameNormalized) throw new Error('Il nome utente e obbligatorio.');

  await ensureUniqueName(nameNormalized, userId);

  const updated = {
    ...existing,
    name,
    nameNormalized,
    role,
    active,
    updatedAt: Date.now(),
  };
  if (changes.pin) {
    Object.assign(updated, await createPinCredentials(changes.pin));
  }
  await putRecord(STORE_NAMES.USERS, updated);
  if (changes.pin) await clearLoginThrottle(userId).catch(() => {});
  return toPublicUser(updated);
}
