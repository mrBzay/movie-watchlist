'use server';

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { promisify } from 'util';

import {
  createSession,
  deleteSession,
  deleteUserSessions,
  findUserByEmail,
  getSessionWithUser,
  getUserById,
  updateUserOmdbKey,
} from './db';

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE = 'watchlist_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function getCookieStore() {
  try {
    return cookies();
  } catch (error) {
    console.error('Failed to access cookies()', error);
    throw new Error('Unable to access request cookies');
  }
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    const error = new Error('Password must be at least 8 characters long');
    error.status = 400;
    throw error;
  }

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const stored = Buffer.from(hashHex, 'hex');

  const derived = await scrypt(password, salt, stored.length);

  if (derived.length !== stored.length) return false;

  return timingSafeEqual(derived, stored);
}

function generateSessionToken() {
  return randomBytes(48).toString('hex');
}

function getExpiryDate() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export async function createUserSession(userId) {
  const token = generateSessionToken();
  const expiresAt = getExpiryDate();
  await createSession(userId, token, expiresAt);

  const store = getCookieStore();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });

  return { token, expiresAt };
}

export async function destroyCurrentSession() {
  const store = getCookieStore();
  const existing = store.get(SESSION_COOKIE);
  if (existing?.value) {
    await deleteSession(existing.value);
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentSession() {
  const store = getCookieStore();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionWithUser(token);
}

export async function requireCurrentUser() {
  const session = await getCurrentSession();
  if (!session?.user) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  return session.user;
}

export async function loginWithCredentials(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error('Email is required');
    error.status = 400;
    throw error;
  }
  if (!password) {
    const error = new Error('Password is required');
    error.status = 400;
    throw error;
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user?.passwordHash) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  await createUserSession(user.id);

  const { passwordHash: _ignored, ...safeUser } = user;
  return safeUser;
}

export async function logoutUser() {
  await destroyCurrentSession();
}

export async function setUserOmdbKey(userId, omdbKey) {
  const updated = await updateUserOmdbKey(userId, omdbKey);
  return updated;
}

export async function getUserFromSession() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== 'admin') {
    const error = new Error('Admin role required');
    error.status = 403;
    throw error;
  }
  return user;
}

export async function invalidateUserSessions(userId) {
  await deleteUserSessions(userId);
}

export async function getUserByIdSafe(userId) {
  return getUserById(userId);
}
