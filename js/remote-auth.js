import { API_BASE_URL, ROLES, STORE_NAMES } from './config.js?v=1.5.0';
import {
  deleteSetting,
  getAllRecords,
  getRecord,
  getSetting,
  putRecord,
  setSetting,
} from './db.js?v=1.5.0';
import { normalizeText } from './utils.js?v=1.5.0';
import { toPublicUser } from './auth.js?v=1.5.0';

const SESSION_KEY = 'central-auth-session';
const CACHED_USERS_KEY = 'central-auth-users';
const LEGACY_SESSION_KEY = 'auth-session';
const DEVICE_ID_KEY = 'cantiere-media-device-id';
const LAST_USERNAME_KEY = 'cantiere-media-last-username';
const REQUEST_TIMEOUT_MS = 20000;
const PIN_PATTERN = /^\d{6}$/;

export class CentralAuthError extends Error {
  constructor(message, code = 'CENTRAL_AUTH_ERROR', details = {}) {
    super(message);
    this.name = 'CentralAuthError';
    this.code = code;
    this.details = details;
  }
}

function endpoint(path) {
  return `${API_BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function isSessionExpired(session, now = Date.now()) {
  const expiry = Date.parse(session?.expiresAt ?? '');
  return !Number.isFinite(expiry) || expiry <= now;
}

function isConnectivityError(error) {
  return error?.name === 'TypeError'
    || error?.name === 'AbortError'
    || error?.code === 'NETWORK_ERROR';
}

async function apiRequest(path, {
  method = 'GET',
  body,
  token,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(endpoint(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.ok === false) {
      throw new CentralAuthError(
        payload?.error ?? 'Il servizio di accesso non ha risposto correttamente.',
        payload?.code ?? `HTTP_${response.status}`,
        { status: response.status, payload },
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof CentralAuthError) throw error;
    if (error?.name === 'AbortError') {
      throw new CentralAuthError('Il servizio non risponde. Controlla la connessione.', 'NETWORK_ERROR');
    }
    throw new CentralAuthError('Impossibile raggiungere il servizio. Controlla la connessione.', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

function createRandomDeviceId() {
  if (globalThis.crypto?.randomUUID) return `web-${crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `web-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId() {
  let value = localStorage.getItem(DEVICE_ID_KEY);
  if (!value || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    value = createRandomDeviceId().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
    localStorage.setItem(DEVICE_ID_KEY, value);
  }
  return value;
}

export function getDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Dispositivo';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const mode = standalone ? 'app' : 'browser';
  return `${platform} - ${mode}`.slice(0, 120);
}

export function getDevicePlatform() {
  const userAgent = navigator.userAgent || '';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  return (navigator.userAgentData?.platform || navigator.platform || 'web').toLowerCase().slice(0, 60);
}

function sessionPayload(extra = {}) {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    platform: getDevicePlatform(),
    ...extra,
  };
}

function remoteUserToLocalBase(remoteUser) {
  return {
    name: remoteUser.displayName,
    nameNormalized: normalizeText(remoteUser.displayName),
    role: remoteUser.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USER,
    active: remoteUser.status === 'active',
    centralUserId: remoteUser.id,
    username: remoteUser.username,
    centralStatus: remoteUser.status,
    pinConfiguredCentral: remoteUser.pinConfigured === true,
  };
}

export async function ensureLocalUser(remoteUser) {
  if (!remoteUser?.id || !remoteUser?.username || !remoteUser?.displayName) {
    throw new CentralAuthError('Profilo utente ricevuto non valido.', 'INVALID_REMOTE_USER');
  }

  const users = await getAllRecords(STORE_NAMES.USERS);
  const normalizedName = normalizeText(remoteUser.displayName);
  let existing = users.find((user) => user.centralUserId === remoteUser.id)
    ?? users.find((user) => String(user.username || '').toLowerCase() === remoteUser.username.toLowerCase())
    ?? users.find((user) => user.nameNormalized === normalizedName);

  const timestamp = Date.now();
  if (existing) {
    existing = {
      ...existing,
      ...remoteUserToLocalBase(remoteUser),
      updatedAt: timestamp,
    };
  } else {
    existing = {
      id: remoteUser.id,
      ...remoteUserToLocalBase(remoteUser),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  await putRecord(STORE_NAMES.USERS, existing);
  return toPublicUser(existing);
}

async function saveSession(result, localUser) {
  const session = {
    token: result.token,
    expiresAt: result.expiresAt,
    centralUser: result.user,
    centralUserId: result.user.id,
    localUserId: localUser.id,
    authenticatedAt: Date.now(),
  };
  await setSetting(SESSION_KEY, session);
  await deleteSetting(LEGACY_SESSION_KEY).catch(() => {});
  localStorage.setItem(LAST_USERNAME_KEY, result.user.username);
  return localUser;
}

export async function listCentralUsers({ allowCache = true } = {}) {
  try {
    const result = await apiRequest('/api/auth/users');
    const users = Array.isArray(result?.users) ? result.users : [];
    await setSetting(CACHED_USERS_KEY, users);
    return { users, source: 'network' };
  } catch (error) {
    if (!allowCache || !isConnectivityError(error)) throw error;
    const cached = await getSetting(CACHED_USERS_KEY, []);
    return { users: Array.isArray(cached) ? cached : [], source: 'cache' };
  }
}

export function getLastUsername() {
  return localStorage.getItem(LAST_USERNAME_KEY) || '';
}

export async function activateCentralUser({ username, activationCode, pin }) {
  if (!PIN_PATTERN.test(String(pin || ''))) {
    throw new CentralAuthError('Il PIN deve contenere esattamente 6 cifre.', 'INVALID_PIN');
  }
  const result = await apiRequest('/api/auth/activate', {
    method: 'POST',
    body: sessionPayload({
      username: String(username || '').trim().toLowerCase(),
      activationCode: String(activationCode || '').trim(),
      pin: String(pin),
    }),
  });
  const localUser = await ensureLocalUser(result.user);
  return saveSession(result, localUser);
}

export async function loginCentralUser({ username, pin }) {
  if (!PIN_PATTERN.test(String(pin || ''))) {
    throw new CentralAuthError('Il PIN deve contenere esattamente 6 cifre.', 'INVALID_PIN');
  }
  const result = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: sessionPayload({
      username: String(username || '').trim().toLowerCase(),
      pin: String(pin),
    }),
  });
  const localUser = await ensureLocalUser(result.user);
  return saveSession(result, localUser);
}

export async function restoreCentralSession({ verifyOnline = true } = {}) {
  const session = await getSetting(SESSION_KEY, null);
  if (!session?.token || isSessionExpired(session)) {
    await deleteSetting(SESSION_KEY).catch(() => {});
    return null;
  }

  let localUser = session.localUserId
    ? await getRecord(STORE_NAMES.USERS, session.localUserId)
    : null;

  if (!localUser && session.centralUser) {
    localUser = await ensureLocalUser(session.centralUser);
  }

  if (!localUser || localUser.active === false) return null;
  if (!verifyOnline || !navigator.onLine) return toPublicUser(localUser);

  try {
    const result = await apiRequest('/api/auth/me', { token: session.token });
    const updatedLocalUser = await ensureLocalUser(result.user);
    await setSetting(SESSION_KEY, {
      ...session,
      centralUser: result.user,
      centralUserId: result.user.id,
      localUserId: updatedLocalUser.id,
      lastVerifiedAt: Date.now(),
    });
    return updatedLocalUser;
  } catch (error) {
    if (isConnectivityError(error)) return toPublicUser(localUser);
    if (['UNAUTHORIZED', 'SESSION_INVALID', 'HTTP_401'].includes(error.code)) {
      await deleteSetting(SESSION_KEY).catch(() => {});
      return null;
    }
    throw error;
  }
}

export async function verifyCentralSession() {
  return restoreCentralSession({ verifyOnline: true });
}

export async function logoutCentralUser() {
  const session = await getSetting(SESSION_KEY, null);
  if (session?.token && navigator.onLine) {
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        token: session.token,
      });
    } catch (error) {
      if (!isConnectivityError(error)) console.warn('Logout remoto non completato.', error);
    }
  }
  await deleteSetting(SESSION_KEY).catch(() => {});
  await deleteSetting(LEGACY_SESSION_KEY).catch(() => {});
}

export async function hasCentralSession() {
  const session = await getSetting(SESSION_KEY, null);
  return Boolean(session?.token && !isSessionExpired(session));
}

export { PIN_PATTERN, isSessionExpired };
