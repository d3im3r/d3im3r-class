import { cookies, headers } from 'next/headers';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import {
  query,
  queryOne,
  execute,
  syncBetterAuthUser,
} from '@/features/administration/server/database';
import { hasPermission, type PermissionRequest, ac, roles } from './permissions';
import { getAuth } from './better-auth';
import type { User } from '../types';
export { hasPermission, type PermissionRequest, ac, roles };

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function passwordMatches(password: string, stored: string) {
  try {
    const [salt, key] = stored.split(':');
    return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64));
  } catch {
    return false;
  }
}

export function text(value: unknown, label: string, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(`${label}: introduce un valor válido (máximo ${max} caracteres).`);
  return value.trim();
}

export function validatePassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 256)
    throw new AppError('La contraseña debe tener entre 6 y 256 caracteres.');
  return value;
}

export async function createUser(
  input: Record<string, unknown>,
  role: 'admin' | 'teacher' | 'student'
): Promise<User> {
  const name = text(input.name, 'Nombre', 100),
    username = text(input.username, 'Usuario', 100).toLowerCase();
  if (!/^[a-z0-9][a-z0-9@._+-]{2,99}$/.test(username))
    throw new AppError(
      'El usuario debe tener al menos 3 caracteres: letras sin tildes, números, punto, guion o correo.'
    );
  const password = validatePassword(input.password);

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE username = $1', [
    username,
  ]);
  if (existing) throw new AppError('Ese usuario ya existe.', 409);

  const user = { id: randomUUID(), name, username, role },
    hashed = passwordHash(password);

  await execute(
    'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5)',
    [user.id, name, username, hashed, role]
  );
  await syncBetterAuthUser(user.id, name, username, hashed, role);
  return user;
}

export async function needsSetup(): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE role IN ('admin', 'teacher') LIMIT 1"
  );
  return !row;
}

export async function setup(input: Record<string, unknown>): Promise<User> {
  const needed = await needsSetup();
  if (!needed) {
    throw new AppError('La cuenta administrativa inicial ya fue configurada.', 409);
  }
  return createUser(input, 'admin');
}

export async function resetPassword(userId: string, newPasswordRaw: unknown) {
  const password = validatePassword(newPasswordRaw);
  const user = await queryOne<User>(
    'SELECT id, name, username, role FROM users WHERE id = $1',
    [userId]
  );
  if (!user) throw new AppError('Usuario no encontrado.', 404);

  const hashed = passwordHash(password),
    now = new Date().toISOString();

  await execute('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
  await execute('UPDATE account SET password = $1, "updatedAt" = $2 WHERE "userId" = $3', [
    hashed,
    now,
    userId,
  ]);
  await execute('DELETE FROM login_attempts WHERE username = $1', [user.username]);

  return { ok: true, userId: user.id, username: user.username };
}

const cookieName = process.env.AULA_SESSION_COOKIE ?? 'aula_session';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function currentUser(): Promise<User | null> {
  let jar: any;
  try {
    jar = await cookies();
  } catch {}
  const token = jar?.get(cookieName)?.value;

  if (token) {
    const hashed = digest(token),
      nowIso = new Date().toISOString();

    const baRow = await queryOne<{
      id: string;
      name: string;
      username: string;
      role: 'admin' | 'teacher' | 'student';
      banned: boolean | number;
    }>(
      'SELECT u.id, u.name, u.username, u.role, u.banned FROM "session" s JOIN "user" u ON u.id = s."userId" WHERE s.token = $1 AND s."expiresAt" > $2',
      [hashed, nowIso]
    );

    if (baRow) {
      if (baRow.banned) return null;
      return { id: baRow.id, name: baRow.name, username: baRow.username, role: baRow.role };
    }

    const row = await queryOne<User & { password: string }>(
      'SELECT u.id, u.name, u.username, u.role, u.password FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires > $2',
      [hashed, Date.now()]
    );

    if (row) {
      await syncBetterAuthUser(row.id, row.name, row.username, row.password, row.role);
      const expiresIso = new Date(Date.now() + 7 * 86400000).toISOString();
      await execute(
        'INSERT INTO "session"(id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT(token) DO NOTHING',
        [randomUUID(), expiresIso, hashed, nowIso, row.id]
      );
      return { id: row.id, name: row.name, username: row.username, role: row.role };
    }
  }

  try {
    const baSession = await getAuth().api.getSession({ headers: await headers() });
    if (baSession?.user) {
      const u = baSession.user as {
        id: string;
        name: string;
        username?: string | null;
        email: string;
        role?: string | null;
        banned?: boolean | null;
      };
      if (u.banned) return null;
      const role = (u.role === 'admin' ? 'admin' : u.role === 'teacher' ? 'teacher' : 'student') as
        | 'admin'
        | 'teacher'
        | 'student';

      const existing = await queryOne<User>('SELECT id, name, username, role FROM users WHERE id = $1', [
        u.id,
      ]);

      if (!existing) {
        const uname =
          u.username ??
          u.email
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9._+-]/g, '');
        await execute(
          'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
          [u.id, u.name, uname, 'google-oauth', role]
        );
      }
      return {
        id: u.id,
        name: u.name,
        username: u.username ?? u.email.replace(/@aula\.local$/, ''),
        role,
      };
    }
  } catch {
    // ignore when headers context is unavailable
  }
  return null;
}

export async function requireUser(role?: 'admin' | 'teacher' | 'student') {
  const user = await currentUser();
  if (!user) throw new AppError('Inicia sesión para continuar.', 401);
  if (role) {
    if (role === 'teacher' && user.role !== 'teacher' && user.role !== 'admin')
      throw new AppError('No tienes permiso para realizar esta acción.', 403);
    if (role !== 'teacher' && user.role !== role)
      throw new AppError('No tienes permiso para realizar esta acción.', 403);
  }
  return user;
}

export async function requirePermission(permissions: PermissionRequest): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AppError('Inicia sesión para continuar.', 401);
  if (!hasPermission(user, permissions))
    throw new AppError('No tienes permiso para realizar esta acción.', 403);
  return user;
}

export async function startSession(user: User) {
  let jar: any;
  try {
    jar = await cookies();
  } catch {}
  const old = jar?.get(cookieName)?.value;
  if (old) {
    const oldHash = digest(old);
    await execute('DELETE FROM sessions WHERE token = $1', [oldHash]);
    await execute('DELETE FROM "session" WHERE token = $1', [oldHash]);
  }
  const token = randomBytes(32).toString('hex'),
    hashed = digest(token),
    now = Date.now(),
    expires = now + 7 * 86400000,
    nowIso = new Date(now).toISOString(),
    expiresIso = new Date(expires).toISOString();
  const sessionId = randomUUID();

  const dbUser =
    (await queryOne<{ id: string; password: string }>(
      'SELECT id, password FROM users WHERE id = $1',
      [user.id]
    )) ||
    (await queryOne<{ id: string; password: string }>(
      'SELECT id, password FROM users WHERE username = $1',
      [user.username]
    ));

  await syncBetterAuthUser(
    user.id,
    user.name,
    user.username,
    dbUser?.password || 'managed-credentials',
    user.role
  );

  await execute('DELETE FROM sessions WHERE expires < $1', [now]);
  await execute('DELETE FROM "session" WHERE "expiresAt" < $1', [nowIso]);

  await execute(
    'INSERT INTO sessions(token, user_id, expires) VALUES ($1, $2, $3) ON CONFLICT(token) DO UPDATE SET user_id = EXCLUDED.user_id, expires = EXCLUDED.expires',
    [hashed, user.id, expires]
  );
  await execute(
    'INSERT INTO "session"(id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT(token) DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt", "userId" = EXCLUDED."userId"',
    [sessionId, expiresIso, hashed, nowIso, user.id]
  );

  const isSecure =
    process.env.AULA_SECURE_COOKIES === '1' ||
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1';
  jar?.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 7 * 86400,
  });
  return { token, cookieName };
}

export async function endSession() {
  let jar: any;
  try {
    jar = await cookies();
  } catch {}
  const token = jar?.get(cookieName)?.value;
  if (token) {
    const hashed = digest(token);
    await execute('DELETE FROM sessions WHERE token = $1', [hashed]);
    await execute('DELETE FROM "session" WHERE token = $1', [hashed]);
  }
  try {
    jar?.delete(cookieName);
    jar?.delete('better-auth.session_token');
    jar?.delete('__Secure-better-auth.session_token');
  } catch {}
}

export async function login(input: Record<string, unknown>): Promise<User> {
  const username = text(input.username, 'Usuario', 100).toLowerCase(),
    password =
      typeof input.password === 'string' && input.password.length <= 256 ? input.password : '';

  const attempt = await queryOne<{ count: number; until: string | number }>(
    'SELECT count, until FROM login_attempts WHERE username = $1',
    [username]
  );

  if (attempt && Number(attempt.until) > Date.now() && Number(attempt.count) >= 5)
    throw new AppError('Demasiados intentos. Intenta nuevamente en 15 minutos.', 429);

  let row = await queryOne<User & { password: string }>(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );

  if (!row) {
    const u = await queryOne<{ id: string; name: string; username: string; email: string; role: any }>(
      'SELECT id, name, username, email, role FROM "user" WHERE email = $1 OR username = $2',
      [username, username]
    );
    if (u) {
      const acc = await queryOne<{ password: string }>(
        'SELECT password FROM account WHERE "userId" = $1 AND "providerId" = $2',
        [u.id, 'credential']
      );
      if (acc && acc.password) {
        row = {
          id: u.id,
          name: u.name,
          username: u.username || u.email,
          role: u.role,
          password: acc.password,
        };
        await execute(
          'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password',
          [u.id, u.name, u.username || u.email, acc.password, u.role]
        );
      }
    }
  }

  const valid = passwordMatches(password, row?.password ?? '0'.repeat(32) + ':' + '0'.repeat(128));
  if (!row || !valid) {
    const currentCount = attempt && Number(attempt.until) > Date.now() ? Number(attempt.count) + 1 : 1;
    const currentUntil = attempt && Number(attempt.until) > Date.now() ? Number(attempt.until) : Date.now() + 900000;
    await execute(
      'INSERT INTO login_attempts(username, count, until) VALUES ($1, $2, $3) ON CONFLICT(username) DO UPDATE SET count = EXCLUDED.count, until = EXCLUDED.until',
      [username, currentCount, currentUntil]
    );
    throw new AppError('Usuario o contraseña incorrectos.', 401);
  }

  await execute('DELETE FROM login_attempts WHERE username = $1', [username]);
  await syncBetterAuthUser(row.id, row.name, row.username, row.password, row.role);
  const { password: _, ...user } = row;
  return user;
}

export async function loginDevGoogle(input: Record<string, unknown>): Promise<User> {
  const email =
    typeof input.email === 'string' && input.email.includes('@')
      ? input.email.trim().toLowerCase()
      : 'alumno.google@gmail.com';
  const name =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Alumno Google';
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '');

  let user = await queryOne<User>('SELECT id, name, username, role FROM users WHERE username = $1', [
    username,
  ]);

  if (!user) {
    user = { id: randomUUID(), name, username, role: 'student' };
    await execute(
      'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5)',
      [user.id, name, username, 'google-oauth', 'student']
    );
    const subjects = await query<{ id: string }>('SELECT id FROM subjects');
    for (const s of subjects) {
      await execute(
        'INSERT INTO subject_bans(user_id, subject_id, reason, banned_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, subject_id) DO NOTHING',
        [user.id, s.id, 'Esperando autorización del docente', new Date().toISOString()]
      );
    }
  }

  await syncBetterAuthUser(user.id, user.name, user.username, 'google-oauth', user.role);
  await startSession(user);
  return user;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  try {
    const url = new URL(origin);
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost ?? request.headers.get('host') ?? new URL(request.url).host;
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (url.host !== host && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    )
      throw new Error();
  } catch {
    throw new AppError('Origen de solicitud no permitido.', 403);
  }
}

export function errorResponse(error: unknown) {
  if (
    error instanceof AppError ||
    (typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status: unknown }).status === 'number' &&
      'message' in error)
  ) {
    const appErr = error as { message: string; status: number };
    return Response.json({ error: appErr.message }, { status: appErr.status });
  }
  console.error('Aula:', error instanceof Error ? error.stack || error.message : 'Error interno');
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as any).message === 'string'
        ? (error as any).message
        : 'No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.';
  return Response.json(
    {
      error: message,
    },
    { status: 500 }
  );
}
