/**
 * Accounts and sessions: scrypt password hashing, random session tokens in an
 * HttpOnly cookie, and role-based route guards.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../shared/types.ts';
import type { UserView } from '../shared/api.ts';
import { newId, q } from './db.ts';

export const SESSION_COOKIE = 'sb_session';
const SESSION_DAYS = 30;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  is_demo: number;
  is_simulated: number;
  created_at: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function toUserView(u: UserRow): UserView {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    createdAt: u.created_at,
    isDemo: !!u.is_demo,
  };
}

export function createUser(opts: {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  isDemo?: boolean;
  isSimulated?: boolean;
  createdAt?: number;
}): UserRow {
  const id = newId('u_');
  const row: UserRow = {
    id,
    username: opts.username.trim(),
    display_name: opts.displayName.trim(),
    password_hash: hashPassword(opts.password),
    role: opts.role,
    is_demo: opts.isDemo ? 1 : 0,
    is_simulated: opts.isSimulated ? 1 : 0,
    created_at: opts.createdAt ?? Date.now(),
  };
  q.run(
    'INSERT INTO users (id, username, display_name, password_hash, role, is_demo, is_simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.username,
    row.display_name,
    row.password_hash,
    row.role,
    row.is_demo,
    row.is_simulated,
    row.created_at,
  );
  return row;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return q.get<UserRow>('SELECT * FROM users WHERE username = ?', username.trim());
}

export function getUser(id: string): UserRow | undefined {
  return q.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  q.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, now, now + SESSION_DAYS * 86400000);
  return token;
}

export function destroySession(token: string) {
  q.run('DELETE FROM sessions WHERE token = ?', token);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: SESSION_DAYS * 86400000,
    path: '/',
  });
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const row = q.get<UserRow & { expires_at: number }>(
      'SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
      token,
    );
    if (row && row.expires_at > Date.now()) req.user = row;
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  next();
}

export function requireInstructor(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  if (req.user.role !== 'instructor') {
    res.status(403).json({ error: 'Instructor access only.' });
    return;
  }
  next();
}
