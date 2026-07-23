import { LIMITS, ROLES, STORE_NAMES } from './config.js?v=1.7.0';
import {
  deleteSetting,
  getRecord,
  getSetting,
  putInitialUser,
  setSetting,
} from './db.js?v=1.7.0';
import {
  base64ToBytes,
  bytesToBase64,
  createId,
  normalizeText,
} from './utils.js?v=1.7.0';

let currentUser = null;
const SESSION_SETTING_KEY = 'auth-session';

export class AuthError extends Error {
  constructor(message, code = 'AUTH_ERROR', details = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

export function validatePin(pin) {
  return new RegExp(`^\\d{${LIMITS.PIN_MIN_LENGTH},${LIMITS.PIN_MAX_LENGTH}}$`).test(String(pin));
}

export function toPublicUser(user) {
  if (!user) return null;
  const publicUser = { ...user };
  delete publicUser.pinSalt;
  delete publicUser.pinHash;
  delete publicUser.pinIterations;
  delete publicUser.pinVersion;
  return publicUser;
}

async function derivePinHash(pin, salt, iterations) {
  if (!globalThis.crypto?.subtle) {
    throw new AuthError('Web Crypto non disponibile. Aprire l\'app tramite HTTPS.', 'CRYPTO_UNAVAILABLE');
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createPinCredentials(pin) {
  if (!validatePin(pin)) {
    throw new AuthError(
      `Il PIN deve contenere da ${LIMITS.PIN_MIN_LENGTH} a ${LIMITS.PIN_MAX_LENGTH} cifre.`,
      'INVALID_PIN',
    );
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new AuthError('Generatore crittografico non disponibile. Aprire l\'app tramite HTTPS.', 'CRYPTO_UNAVAILABLE');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = LIMITS.PIN_PBKDF2_ITERATIONS;
  const hash = await derivePinHash(String(pin), salt, iterations);
  return {
    pinSalt: bytesToBase64(salt),
    pinHash: bytesToBase64(hash),
    pinIterations: iterations,
    pinVersion: 1,
  };
}

export async function verifyPin(pin, user) {
  if (!validatePin(pin) || !user?.pinSalt || !user?.pinHash) return false;
  const actual = await derivePinHash(
    String(pin),
    base64ToBytes(user.pinSalt),
    user.pinIterations ?? LIMITS.PIN_PBKDF2_ITERATIONS,
  );
  return timingSafeEqual(actual, base64ToBytes(user.pinHash));
}

export function isRestorableSession(session, user) {
  return Boolean(
    session?.userId
    && user?.id === session.userId
    && user.active !== false
  );
}

async function persistSession(userId) {
  await setSetting(SESSION_SETTING_KEY, {
    userId,
    authenticatedAt: Date.now(),
  });
}

export async function restoreSession() {
  const session = await getSetting(SESSION_SETTING_KEY, null);
  if (!session?.userId) return null;

  const user = await getRecord(STORE_NAMES.USERS, session.userId);
  if (!isRestorableSession(session, user)) {
    await deleteSetting(SESSION_SETTING_KEY);
    currentUser = null;
    return null;
  }

  currentUser = toPublicUser(user);
  return currentUser;
}

export async function bootstrapAdministrator(name, pin) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    throw new AuthError('Inserire il nome dell\'amministratore.', 'INVALID_NAME');
  }
  const credentials = await createPinCredentials(pin);
  const timestamp = Date.now();
  const user = {
    id: createId('usr'),
    name: String(name).trim(),
    nameNormalized: normalizedName,
    role: ROLES.ADMIN,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...credentials,
  };
  await putInitialUser(user);
  currentUser = toPublicUser(user);
  await persistSession(user.id);
  return currentUser;
}

function throttleKey(userId) {
  return `auth-throttle:${userId}`;
}

async function readThrottle(userId) {
  return getSetting(throttleKey(userId), {
    failures: 0,
    lastFailureAt: 0,
    lockUntil: 0,
  });
}

async function registerFailure(userId, previous) {
  const now = Date.now();
  const stale = now - (previous.lastFailureAt ?? 0) > 10 * 60 * 1000;
  const failures = (stale ? 0 : previous.failures ?? 0) + 1;
  const lockUntil = failures >= LIMITS.AUTH_MAX_FAILURES
    ? now + LIMITS.AUTH_LOCK_MS
    : 0;
  await setSetting(throttleKey(userId), {
    failures: lockUntil ? 0 : failures,
    lastFailureAt: now,
    lockUntil,
  });
  return lockUntil;
}

export async function login(userId, pin) {
  const user = await getRecord(STORE_NAMES.USERS, userId);
  if (!user || user.active === false) {
    throw new AuthError('Utente non disponibile.', 'USER_UNAVAILABLE');
  }

  const throttle = await readThrottle(userId);
  const now = Date.now();
  if ((throttle.lockUntil ?? 0) > now) {
    throw new AuthError('Troppi tentativi. Riprovare tra poco.', 'LOCKED', {
      retryAfterMs: throttle.lockUntil - now,
    });
  }

  const verified = await verifyPin(pin, user);
  if (!verified) {
    const lockUntil = await registerFailure(userId, throttle);
    throw new AuthError(
      lockUntil ? 'Troppi tentativi errati. Accesso temporaneamente bloccato.' : 'PIN non corretto.',
      lockUntil ? 'LOCKED' : 'INVALID_PIN',
      { retryAfterMs: Math.max(0, lockUntil - Date.now()) },
    );
  }

  await deleteSetting(throttleKey(userId));
  currentUser = toPublicUser(user);
  await persistSession(user.id);
  return currentUser;
}

export async function logout() {
  await deleteSetting(SESSION_SETTING_KEY);
  currentUser = null;
}

export function getCurrentUser() {
  return currentUser;
}

export function updateCurrentUserSnapshot(user) {
  if (currentUser?.id === user?.id) currentUser = toPublicUser(user);
  return currentUser;
}

export async function clearLoginThrottle(userId) {
  if (!userId) return;
  await deleteSetting(throttleKey(userId));
}

export function requireCurrentUser() {
  if (!currentUser) {
    throw new AuthError('Sessione non valida.', 'NO_SESSION');
  }
  return currentUser;
}
