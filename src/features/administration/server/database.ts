import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Catalog, Lesson, Block } from '@/features/catalog/model/types';
import type { User } from '@/features/auth/types';
const directory =
  process.env.AULA_DATA_DIR ??
  (process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(tmpdir(), 'aula-data')
    : path.join(process.cwd(), '.data'));
let connection: DatabaseSync | undefined;
let pgPool: Pool | undefined;

const pendingPg: Promise<unknown>[] = [];

export function queuePg(promise: Promise<unknown>) {
  pendingPg.push(
    promise.catch((err) => {
      console.error('[PostgreSQL Error]:', err?.message ?? err);
    })
  );
}

export async function flushPg(): Promise<void> {
  if (pendingPg.length === 0) return;
  const current = [...pendingPg];
  pendingPg.length = 0;
  await Promise.allSettled(current);
}

export function getPgPool(): Pool | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  if (!pgPool) {
    const rawPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    const origQuery = rawPool.query.bind(rawPool);
    (rawPool as any).query = function (...args: any[]) {
      const result = (origQuery as any)(...args);
      if (result && typeof result.then === 'function') {
        queuePg(result);
      }
      return result;
    };
    pgPool = rawPool;
  }
  return pgPool;
}

let lastSyncTime = 0;
export async function syncFromPostgres(force = false) {
  const pool = getPgPool();
  if (!pool) return;
  const now = Date.now();
  if (!force && now - lastSyncTime < 2000) return;
  try {
    const res = await pool.query(`
    SELECT json_build_object(
      'users', COALESCE((SELECT json_agg(u) FROM users u), '[]'::json),
      'sessions', COALESCE((SELECT json_agg(s) FROM sessions s), '[]'::json),
      'user', COALESCE((SELECT json_agg(usr) FROM "user" usr), '[]'::json),
      'session', COALESCE((SELECT json_agg(ses) FROM "session" ses), '[]'::json),
      'account', COALESCE((SELECT json_agg(acc) FROM "account" acc), '[]'::json),
      'institutions', COALESCE((SELECT json_agg(i) FROM institutions i), '[]'::json),
      'subjects', COALESCE((SELECT json_agg(sub) FROM subjects sub), '[]'::json),
      'lessons', COALESCE((SELECT json_agg(l) FROM lessons l), '[]'::json),
      'enrollments', COALESCE((SELECT json_agg(e) FROM enrollments e), '[]'::json),
      'institution_members', COALESCE((SELECT json_agg(im) FROM institution_members im), '[]'::json),
      'subject_bans', COALESCE((SELECT json_agg(b) FROM subject_bans b), '[]'::json),
      'progress', COALESCE((SELECT json_agg(p) FROM progress p), '[]'::json),
      'resources', COALESCE((SELECT json_agg(r) FROM resources r), '[]'::json)
    ) as state;
  `);
    const state = res.rows[0]?.state;
    if (!state) return;
    const sql = db();
    sql.exec('BEGIN IMMEDIATE');
    try {
      if (Array.isArray(state.users)) {
        for (const u of state.users) {
          sql
            .prepare(
              'INSERT INTO users(id,name,username,password,role) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,password=excluded.password,role=excluded.role'
            )
            .run(u.id, u.name, u.username, u.password, u.role);
        }
      }
      if (Array.isArray(state.user)) {
        for (const usr of state.user) {
          sql
            .prepare(
              'INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt,username,displayUsername,role,banned,banReason,banExpires) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,emailVerified=excluded.emailVerified,image=excluded.image,updatedAt=excluded.updatedAt,username=excluded.username,displayUsername=excluded.displayUsername,role=excluded.role,banned=excluded.banned,banReason=excluded.banReason,banExpires=excluded.banExpires'
            )
            .run(
              usr.id,
              usr.name,
              usr.email,
              usr.emailVerified ? 1 : 0,
              usr.image,
              usr.createdAt,
              usr.updatedAt,
              usr.username,
              usr.displayUsername,
              usr.role,
              usr.banned ? 1 : 0,
              usr.banReason,
              usr.banExpires
            );
        }
      }
      if (Array.isArray(state.account)) {
        for (const acc of state.account) {
          sql
            .prepare(
              'INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,accessTokenExpiresAt,refreshTokenExpiresAt,scope,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET password=excluded.password,updatedAt=excluded.updatedAt'
            )
            .run(
              acc.id,
              acc.accountId,
              acc.providerId,
              acc.userId,
              acc.accessToken,
              acc.refreshToken,
              acc.idToken,
              acc.accessTokenExpiresAt,
              acc.refreshTokenExpiresAt,
              acc.scope,
              acc.password,
              acc.createdAt,
              acc.updatedAt
            );
        }
      }
      sql.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      sql.prepare('DELETE FROM session WHERE expiresAt < ?').run(new Date().toISOString());
      if (Array.isArray(state.sessions)) {
        for (const s of state.sessions) {
          sql
            .prepare(
              'INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,expires=excluded.expires'
            )
            .run(s.token, s.user_id, Number(s.expires));
        }
      }
      if (Array.isArray(state.session)) {
        for (const ses of state.session) {
          sql
            .prepare(
              'INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId,impersonatedBy) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET expiresAt=excluded.expiresAt,updatedAt=excluded.updatedAt,userId=excluded.userId,ipAddress=excluded.ipAddress,userAgent=excluded.userAgent'
            )
            .run(
              ses.id,
              ses.expiresAt,
              ses.token,
              ses.createdAt,
              ses.updatedAt,
              ses.ipAddress,
              ses.userAgent,
              ses.userId,
              ses.impersonatedBy
            );
        }
      }
      if (Array.isArray(state.institutions)) {
        const pgInstIds = state.institutions.map((i: any) => i.id);
        if (pgInstIds.length > 0) {
          const placeholders = pgInstIds.map(() => '?').join(',');
          sql
            .prepare(`DELETE FROM institutions WHERE id NOT IN (${placeholders})`)
            .run(...pgInstIds);
        } else {
          sql.prepare('DELETE FROM institutions').run();
        }
        for (const inst of state.institutions) {
          const dataStr = typeof inst.data === 'string' ? inst.data : JSON.stringify(inst.data);
          sql
            .prepare(
              'INSERT INTO institutions(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'
            )
            .run(inst.id, dataStr);
        }
      }
      if (Array.isArray(state.subjects)) {
        const pgSubIds = state.subjects.map((s: any) => s.id);
        if (pgSubIds.length > 0) {
          const placeholders = pgSubIds.map(() => '?').join(',');
          sql.prepare(`DELETE FROM subjects WHERE id NOT IN (${placeholders})`).run(...pgSubIds);
        } else {
          sql.prepare('DELETE FROM subjects').run();
        }
        for (const sub of state.subjects) {
          const dataStr = typeof sub.data === 'string' ? sub.data : JSON.stringify(sub.data);
          sql
            .prepare(
              'INSERT INTO subjects(id,institution_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET institution_id=excluded.institution_id,data=excluded.data'
            )
            .run(sub.id, sub.institution_id, dataStr);
        }
      }
      if (Array.isArray(state.lessons)) {
        const pgLessonIds = state.lessons.map((l: any) => l.id);
        if (pgLessonIds.length > 0) {
          const placeholders = pgLessonIds.map(() => '?').join(',');
          sql.prepare(`DELETE FROM lessons WHERE id NOT IN (${placeholders})`).run(...pgLessonIds);
        } else {
          sql.prepare('DELETE FROM lessons').run();
        }
        for (const les of state.lessons) {
          const dataStr = typeof les.data === 'string' ? les.data : JSON.stringify(les.data);
          sql
            .prepare(
              'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id,status=excluded.status,revision=excluded.revision,reviewed=excluded.reviewed,data=excluded.data'
            )
            .run(les.id, les.subject_id, les.status, les.revision, les.reviewed, dataStr);
        }
      }
      if (Array.isArray(state.enrollments)) {
        sql.prepare('DELETE FROM enrollments').run();
        for (const e of state.enrollments) {
          sql
            .prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)')
            .run(e.user_id, e.subject_id);
        }
      }
      if (Array.isArray(state.institution_members)) {
        sql.prepare('DELETE FROM institution_members').run();
        for (const im of state.institution_members) {
          sql
            .prepare(
              'INSERT OR IGNORE INTO institution_members(user_id,institution_id) VALUES (?,?)'
            )
            .run(im.user_id, im.institution_id);
        }
      }
      if (Array.isArray(state.subject_bans)) {
        for (const b of state.subject_bans) {
          sql
            .prepare(
              'INSERT INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?) ON CONFLICT(user_id,subject_id) DO UPDATE SET reason=excluded.reason,banned_at=excluded.banned_at'
            )
            .run(b.user_id, b.subject_id, b.reason, b.banned_at);
        }
      }
      if (Array.isArray(state.progress)) {
        for (const p of state.progress) {
          sql
            .prepare('INSERT OR IGNORE INTO progress(user_id,lesson_id,frame_id) VALUES (?,?,?)')
            .run(p.user_id, p.lesson_id, p.frame_id);
        }
      }
      if (Array.isArray(state.resources)) {
        for (const r of state.resources) {
          sql
            .prepare(
              'INSERT OR REPLACE INTO resources(lesson_id,key,name,path,mime) VALUES (?,?,?,?,?)'
            )
            .run(r.lesson_id, r.key, r.name, r.path, r.mime);
        }
      }
      sql.exec('COMMIT');
      lastSyncTime = Date.now();
    } catch (err) {
      sql.exec('ROLLBACK');
      console.error('Failed to apply sync state to SQLite:', err);
    }
  } catch (err) {
    console.error('Failed to sync from Postgres:', err);
  }
}
export function db() {
  if (connection) return connection;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(path.join(directory, 'aula.sqlite'));
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,emailVerified INTEGER NOT NULL DEFAULT 1,image TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,username TEXT UNIQUE,displayUsername TEXT,role TEXT NOT NULL DEFAULT 'student',banned INTEGER DEFAULT 0,banReason TEXT,banExpires TEXT);
 CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY,expiresAt TEXT NOT NULL,token TEXT UNIQUE NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,ipAddress TEXT,userAgent TEXT,userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,impersonatedBy TEXT);
 CREATE TABLE IF NOT EXISTS account(id TEXT PRIMARY KEY,accountId TEXT NOT NULL,providerId TEXT NOT NULL,userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,accessToken TEXT,refreshToken TEXT,idToken TEXT,accessTokenExpiresAt TEXT,refreshTokenExpiresAt TEXT,scope TEXT,password TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification(id TEXT PRIMARY KEY,identifier TEXT NOT NULL,value TEXT NOT NULL,expiresAt TEXT NOT NULL,createdAt TEXT,updatedAt TEXT);
 CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,subject_id TEXT REFERENCES subjects(id),status TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,reviewed INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS enrollments(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,PRIMARY KEY(user_id,subject_id));
 CREATE TABLE IF NOT EXISTS subject_bans(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,reason TEXT,banned_at TEXT NOT NULL,PRIMARY KEY(user_id,subject_id));
 CREATE TABLE IF NOT EXISTS subject_invites(token TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subject_join_requests(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,UNIQUE(subject_id,user_id));
 CREATE TABLE IF NOT EXISTS class_invites(token TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS class_join_requests(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,UNIQUE(lesson_id,user_id));
 CREATE TABLE IF NOT EXISTS resources(lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,key TEXT,name TEXT,path TEXT NOT NULL,mime TEXT NOT NULL,PRIMARY KEY(lesson_id,key));
 CREATE TABLE IF NOT EXISTS progress(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,frame_id TEXT NOT NULL,PRIMARY KEY(user_id,lesson_id,frame_id));
 CREATE TABLE IF NOT EXISTS login_attempts(username TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS institution_logos(id TEXT PRIMARY KEY REFERENCES institutions(id),path TEXT NOT NULL,mime TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS institution_members(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, institution_id TEXT REFERENCES institutions(id) ON DELETE CASCADE, PRIMARY KEY(user_id, institution_id));
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  if (!connection.prepare("SELECT key FROM metadata WHERE key='seed-v1'").get()) seed(connection);
  return connection;
}
export function syncBetterAuthUser(
  id: string,
  name: string,
  username: string,
  password: string,
  role: 'admin' | 'teacher' | 'student'
) {
  const sql = db(),
    now = new Date().toISOString(),
    email = username.includes('@') ? username : `${username}@aula.local`;
  sql
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,role,banned) VALUES (?,?,?,1,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,updatedAt=excluded.updatedAt,username=excluded.username,displayUsername=excluded.displayUsername,role=excluded.role'
    )
    .run(id, name, email, now, now, username, username, role);
  const existingAcc = sql
    .prepare("SELECT id FROM account WHERE userId=? AND providerId='credential'")
    .get(id) as { id: string } | undefined;
  if (existingAcc)
    sql
      .prepare('UPDATE account SET password=?,updatedAt=? WHERE id=?')
      .run(password, now, existingAcc.id);
  else
    sql
      .prepare(
        "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)"
      )
      .run(randomUUID(), id, id, password, now, now);

  const pool = getPgPool();
  if (pool) {
    queuePg(
      pool
        .query(
          'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",username,"displayUsername",role,banned) VALUES ($1,$2,$3,true,$4,$4,$5,$5,$6,false) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,"updatedAt"=EXCLUDED."updatedAt",username=EXCLUDED.username,"displayUsername"=EXCLUDED."displayUsername",role=EXCLUDED.role',
          [id, name, email, now, username, role]
        )
        .then(() =>
          pool.query(
            'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,$3,$4,$4) ON CONFLICT(id) DO UPDATE SET password=EXCLUDED.password,"updatedAt"=EXCLUDED."updatedAt"',
            [randomUUID(), id, password, now]
          )
        )
    );
  }
}
function seed(sql: DatabaseSync) {
  const catalog = JSON.parse(
    readFileSync(path.join(process.cwd(), 'content/generated.json'), 'utf8')
  ) as Catalog;
  sql.exec('BEGIN IMMEDIATE');
  try {
    if (sql.prepare("SELECT key FROM metadata WHERE key='seed-v1'").get()) {
      sql.exec('COMMIT');
      return;
    }

    for (const i of catalog.institutions)
      sql.prepare('INSERT OR IGNORE INTO institutions VALUES (?,?)').run(i.id, JSON.stringify(i));
    for (const s of catalog.subjects)
      sql
        .prepare('INSERT OR IGNORE INTO subjects VALUES (?,?,?)')
        .run(s.id, s.institutionId, JSON.stringify(s));
    for (const original of catalog.lessons) {
      const l = structuredClone(original);
      sql
        .prepare(
          'INSERT OR IGNORE INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,?,1,1,?)'
        )
        .run(l.id, l.subjectId, 'published', JSON.stringify(l));
      function resource(url: string, name?: string) {
        const relative = url.replace(/^\//, '');
        const file = path.join(process.cwd(), 'content/materials', relative);
        if (!existsSync(file)) return url;
        const key = createHash('sha256').update(relative).digest('hex').slice(0, 24);
        const mime = url.endsWith('.svg')
          ? 'image/svg+xml'
          : url.endsWith('.pdf')
            ? 'application/pdf'
            : url.endsWith('.tex')
              ? 'text/plain; charset=utf-8'
              : url.endsWith('.png')
                ? 'image/png'
                : 'image/jpeg';
        sql
          .prepare('INSERT OR REPLACE INTO resources VALUES (?,?,?,?,?)')
          .run(l.id, key, name ?? path.basename(url), file, mime);
        return `/api/materials/${l.id}/${key}`;
      }
      function walk(blocks: Block[]) {
        for (const b of blocks) {
          if (b.asset) b.asset = resource(b.asset);
          if (b.children) walk(b.children);
          if (b.items) for (const list of b.items) walk(list);
        }
      }
      l.pdf = resource(l.pdf);
      l.source = resource(`/resources/${l.id}.tex`, path.basename(l.source));
      for (const f of l.frames) walk(f.blocks);
      sql.prepare('UPDATE lessons SET data=? WHERE id=?').run(JSON.stringify(l), l.id);
    }
    sql.prepare('INSERT INTO metadata VALUES (?,?)').run('seed-v1', new Date().toISOString());
    sql.exec('COMMIT');
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
}
export const dataDirectory = () => directory;
export function transaction<T>(fn: () => T): T {
  const sql = db();
  sql.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    sql.exec('COMMIT');
    return result;
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
}
export function lessonRecord(id: string) {
  return db().prepare('SELECT * FROM lessons WHERE id=?').get(id) as
    | {
        id: string;
        subject_id: string;
        status: string;
        revision: number;
        reviewed: number;
        data: string;
      }
    | undefined;
}
export function readLesson(id: string) {
  const row = lessonRecord(id);
  return row ? (JSON.parse(row.data) as Lesson) : undefined;
}

export function userAccessibleSubjectIds(user: User): Set<string> | null {
  if (user.role === 'admin') return null;
  const sql = db();
  const enrolled = sql
    .prepare('SELECT subject_id FROM enrollments WHERE user_id=?')
    .all(user.id) as { subject_id: string }[];
  const instSubs = sql
    .prepare(
      `
   SELECT s.id as subject_id 
   FROM subjects s 
   JOIN institution_members im ON im.institution_id=s.institution_id 
   WHERE im.user_id=?
 `
    )
    .all(user.id) as { subject_id: string }[];
  const set = new Set<string>();
  for (const r of enrolled) set.add(r.subject_id);
  for (const r of instSubs) set.add(r.subject_id);
  return set;
}

export function userAccessibleInstitutionIds(user: User): Set<string> | null {
  if (user.role === 'admin') return null;
  const sql = db();
  const direct = sql
    .prepare('SELECT institution_id FROM institution_members WHERE user_id=?')
    .all(user.id) as { institution_id: string }[];
  const viaSubjects = sql
    .prepare(
      `
   SELECT DISTINCT s.institution_id 
   FROM subjects s 
   JOIN enrollments e ON e.subject_id=s.id 
   WHERE e.user_id=?
 `
    )
    .all(user.id) as { institution_id: string }[];
  const set = new Set<string>();
  for (const r of direct) set.add(r.institution_id);
  for (const r of viaSubjects) set.add(r.institution_id);
  return set;
}
