import { Pool, type PoolClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Catalog, Lesson, Block } from '@/features/catalog/model/types';
import type { User } from '@/features/auth/types';

export const MATERIALS_BUCKET = 'materials';
export const LOGOS_BUCKET = 'logos';

let globalPool: Pool | undefined;
let globalSupabase: SupabaseClient | undefined;
let overrideClient: any = null;

export function setDatabaseOverride(client: any) {
  overrideClient = client;
}

export function resetDatabaseOverride() {
  overrideClient = null;
}

export function getPgPool(): Pool {
  if (overrideClient) return overrideClient as any;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurada en las variables de entorno.');
  }

  const g = globalThis as unknown as { __pgPool?: Pool };
  if (!g.__pgPool) {
    g.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  globalPool = g.__pgPool;
  return globalPool;
}

export function getSupabase(): SupabaseClient | null {
  if (globalSupabase) return globalSupabase;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!url || !key) {
    return null;
  }

  globalSupabase = createClient(url, key, {
    auth: { persistSession: false },
  });
  return globalSupabase;
}

export async function uploadToStorage(
  bucket: string,
  filePath: string,
  data: Buffer | Uint8Array | string,
  mimeType: string
): Promise<string> {
  const cleanPath = filePath.replace(/^\/+/, '');
  const supabase = getSupabase();
  if (!supabase) {
    return `/api/${bucket}/${cleanPath}`;
  }
  const buffer =
    typeof data === 'string'
      ? Buffer.from(data, 'utf8')
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);

  const { error } = await supabase.storage.from(bucket).upload(cleanPath, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (error) {
    console.error(`[Supabase Storage Upload Error] bucket=${bucket} path=${cleanPath}:`, error);
    throw new Error(`Error al subir archivo a almacenamiento: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
  return publicUrl;
}

export async function downloadFromStorage(
  bucket: string,
  filePath: string
): Promise<{ data: Buffer | null; error: Error | null; mime?: string }> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { data: null, error: null };
    }
    const cleanPath = filePath.replace(/^\/+/, '');
    const { data, error } = await supabase.storage.from(bucket).download(cleanPath);
    if (error || !data) {
      return { data: null, error: error ? new Error(error.message) : new Error('No data') };
    }
    const arrayBuffer = await data.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), error: null, mime: data.type };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

export async function deleteFromStorage(bucket: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const clean = paths.map((p) => p.replace(/^\/+/, ''));
    await supabase.storage.from(bucket).remove(clean);
  } catch (err) {
    console.error(`[Supabase Storage Delete Error] bucket=${bucket}:`, err);
  }
}

export function getStoragePublicUrl(bucket: string, filePath: string): string {
  const cleanPath = filePath.replace(/^\/+/, '');
  const supabase = getSupabase();
  if (!supabase) {
    return `/api/${bucket}/${cleanPath}`;
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
  return publicUrl;
}

let schemaEnsuredPromise: Promise<void> | null = null;

export async function ensureDatabaseSchema(client?: PoolClient | Pool): Promise<void> {
  if (overrideClient) return;

  if (!schemaEnsuredPromise) {
    schemaEnsuredPromise = (async () => {
      const executor = client ?? getPgPool();
      await executor.query(`
        CREATE TABLE IF NOT EXISTS subject_groups (
          id TEXT PRIMARY KEY,
          subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_members (
          group_id TEXT REFERENCES subject_groups(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
          PRIMARY KEY (group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS group_lesson_releases (
          group_id TEXT REFERENCES subject_groups(id) ON DELETE CASCADE,
          lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'inherit',
          publish_at TEXT,
          PRIMARY KEY (group_id, lesson_id)
        );

        ALTER TABLE subject_invites ADD COLUMN IF NOT EXISTS topic_id TEXT;
        ALTER TABLE subject_invites ADD COLUMN IF NOT EXISTS group_id TEXT;

        ALTER TABLE subject_join_requests ADD COLUMN IF NOT EXISTS topic_id TEXT;
        ALTER TABLE subject_join_requests ADD COLUMN IF NOT EXISTS group_id TEXT;

        CREATE TABLE IF NOT EXISTS topic_enrollments (
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
          topic_id TEXT NOT NULL,
          PRIMARY KEY (user_id, subject_id, topic_id)
        );

        CREATE TABLE IF NOT EXISTS institution_members (
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          institution_id TEXT REFERENCES institutions(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, institution_id)
        );

        CREATE TABLE IF NOT EXISTS subject_bans (
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
          reason TEXT,
          banned_at TEXT NOT NULL,
          PRIMARY KEY (user_id, subject_id)
        );
      `);
    })().catch((err) => {
      schemaEnsuredPromise = null;
      console.error('[ensureDatabaseSchema Error]:', err);
      throw err;
    });
  }

  return schemaEnsuredPromise;
}

export async function query<T = any>(
  sql: string,
  params: any[] = [],
  client?: PoolClient | Pool
): Promise<T[]> {
  if (!overrideClient) {
    await ensureDatabaseSchema(client);
  }
  const executor = client ?? (overrideClient || getPgPool());
  const res = await executor.query(sql, params);
  return (res.rows ?? []) as T[];
}

export async function queryOne<T = any>(
  sql: string,
  params: any[] = [],
  client?: PoolClient | Pool
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: any[] = [],
  client?: PoolClient | Pool
): Promise<number> {
  if (!overrideClient) {
    await ensureDatabaseSchema(client);
  }
  const executor = client ?? (overrideClient || getPgPool());
  const res = await executor.query(sql, params);
  return res.rowCount ?? 0;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (overrideClient?.transaction) {
    return overrideClient.transaction(fn);
  }
  if (!overrideClient) {
    await ensureDatabaseSchema();
  }
  const pool = overrideClient || getPgPool();
  if (typeof pool.connect !== 'function') {
    // Single client or test adapter
    await pool.query('BEGIN');
    try {
      const res = await fn(pool as any);
      await pool.query('COMMIT');
      return res;
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function lessonRecord(
  id: string,
  client?: PoolClient | Pool
): Promise<{
  id: string;
  subject_id: string;
  status: string;
  revision: number;
  reviewed: number;
  data: string | any;
} | null> {
  return queryOne(
    'SELECT id, subject_id, status, revision, reviewed, data FROM lessons WHERE id = $1',
    [id],
    client
  );
}

export async function readLesson(id: string, client?: PoolClient | Pool): Promise<Lesson | null> {
  const row = await lessonRecord(id, client);
  if (!row) return null;
  if (typeof row.data === 'string') {
    try {
      return JSON.parse(row.data) as Lesson;
    } catch {
      return null;
    }
  }
  return row.data as Lesson;
}

export async function userAccessibleSubjectIds(
  user: User,
  client?: PoolClient | Pool
): Promise<Set<string> | null> {
  if (user.role === 'admin') return null;

  const [enrolled, instSubs] = await Promise.all([
    query<{ subject_id: string }>(
      'SELECT subject_id FROM enrollments WHERE user_id = $1',
      [user.id],
      client
    ),
    query<{ subject_id: string }>(
      `SELECT s.id as subject_id 
       FROM subjects s 
       JOIN institution_members im ON im.institution_id = s.institution_id 
       WHERE im.user_id = $1`,
      [user.id],
      client
    ),
  ]);

  const set = new Set<string>();
  for (const r of enrolled) set.add(r.subject_id);
  for (const r of instSubs) set.add(r.subject_id);
  return set;
}

export async function userAccessibleInstitutionIds(
  user: User,
  client?: PoolClient | Pool
): Promise<Set<string> | null> {
  if (user.role === 'admin') return null;

  const [direct, viaSubjects] = await Promise.all([
    query<{ institution_id: string }>(
      'SELECT institution_id FROM institution_members WHERE user_id = $1',
      [user.id],
      client
    ),
    query<{ institution_id: string }>(
      `SELECT DISTINCT s.institution_id 
       FROM subjects s 
       JOIN enrollments e ON e.subject_id = s.id 
       WHERE e.user_id = $1`,
      [user.id],
      client
    ),
  ]);

  const set = new Set<string>();
  for (const r of direct) set.add(r.institution_id);
  for (const r of viaSubjects) set.add(r.institution_id);
  return set;
}

export async function syncBetterAuthUser(
  id: string,
  name: string,
  username: string,
  password: string,
  role: 'admin' | 'teacher' | 'student',
  client?: PoolClient | Pool
) {
  const now = new Date().toISOString();
  const email = username.includes('@') ? username : `${username}@aula.local`;

  // 1. users table
  await execute(
    `INSERT INTO users(id, name, username, password, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(id) DO UPDATE SET 
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       role = EXCLUDED.role`,
    [id, name, username, password, role],
    client
  );

  // 2. Unificar duplicados antiguos de "user" si existieran con otro id
  const oldUser = await queryOne<{ id: string }>(
    'SELECT id FROM "user" WHERE (email = $1 OR username = $2) AND id != $3',
    [email, username, id],
    client
  );
  if (oldUser) {
    await execute('DELETE FROM "session" WHERE "userId" = $1', [oldUser.id], client);
    await execute('DELETE FROM account WHERE "userId" = $1', [oldUser.id], client);
    await execute('DELETE FROM "user" WHERE id = $1', [oldUser.id], client);
  }

  // 3. "user" table
  await execute(
    `INSERT INTO "user"(id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername", role, banned)
     VALUES ($1, $2, $3, true, $4, $4, $5, $5, $6, false)
     ON CONFLICT(id) DO UPDATE SET 
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       "updatedAt" = EXCLUDED."updatedAt",
       username = EXCLUDED.username,
       "displayUsername" = EXCLUDED."displayUsername",
       role = EXCLUDED.role`,
    [id, name, email, now, username, role],
    client
  );

  // 4. account table
  const existingAcc = await queryOne<{ id: string }>(
    'SELECT id FROM account WHERE "userId" = $1 AND "providerId" = $2',
    [id, 'credential'],
    client
  );

  if (existingAcc) {
    await execute(
      'UPDATE account SET password = $1, "updatedAt" = $2 WHERE id = $3',
      [password, now, existingAcc.id],
      client
    );
  } else {
    await execute(
      `INSERT INTO account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, $4, $4)
       ON CONFLICT(id) DO UPDATE SET password = EXCLUDED.password, "updatedAt" = EXCLUDED."updatedAt"`,
      [randomUUID(), id, password, now],
      client
    );
  }
}

export async function seedDatabase(client?: PoolClient | Pool): Promise<void> {
  const hasMeta = await queryOne("SELECT key FROM metadata WHERE key = 'seed-v1'", [], client);
  if (hasMeta) return;

  const instCount = await queryOne<{ c: string }>(
    'SELECT COUNT(*) as c FROM institutions',
    [],
    client
  );
  if (Number(instCount?.c ?? 0) > 0) {
    await execute(
      "INSERT INTO metadata(key, value) VALUES ('seed-v1', $1) ON CONFLICT (key) DO NOTHING",
      [new Date().toISOString()],
      client
    );
    return;
  }

  const generatedPath = path.join(process.cwd(), 'content/generated.json');
  if (!existsSync(generatedPath)) return;

  const catalog = JSON.parse(readFileSync(generatedPath, 'utf8')) as Catalog;

  for (const i of catalog.institutions) {
    await execute(
      'INSERT INTO institutions(id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [i.id, JSON.stringify(i)],
      client
    );
  }

  for (const s of catalog.subjects) {
    await execute(
      'INSERT INTO subjects(id, institution_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [s.id, s.institutionId, JSON.stringify(s)],
      client
    );
  }

  for (const original of catalog.lessons) {
    const l = structuredClone(original);
    await execute(
      `INSERT INTO lessons(id, subject_id, status, revision, reviewed, data)
       VALUES ($1, $2, 'published', 1, 1, $3)
       ON CONFLICT (id) DO NOTHING`,
      [l.id, l.subjectId, JSON.stringify(l)],
      client
    );
  }

  const senaPath = path.join(process.cwd(), 'public/assets/teaching/logoSena.png');
  if (existsSync(senaPath)) {
    const bytes = readFileSync(senaPath);
    await execute(
      'INSERT INTO institution_logos(id, mime, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      ['sena', 'image/png', bytes.toString('base64')],
      client
    );
  }

  const poliPath = path.join(process.cwd(), 'public/assets/teaching/LogoPoli.png');
  if (existsSync(poliPath)) {
    const bytes = readFileSync(poliPath);
    await execute(
      'INSERT INTO institution_logos(id, mime, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      ['politecnico', 'image/png', bytes.toString('base64')],
      client
    );
  }

  await execute(
    "INSERT INTO metadata(key, value) VALUES ('seed-v1', $1) ON CONFLICT (key) DO NOTHING",
    [new Date().toISOString()],
    client
  );
}
