import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Catalog } from '@/features/catalog/model/types';
import { setDatabaseOverride, resetDatabaseOverride } from './database';

export async function createTestDatabase() {
  const pglite = new PGlite();
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS "user"(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,"emailVerified" BOOLEAN NOT NULL DEFAULT true,image TEXT,"createdAt" TIMESTAMPTZ NOT NULL,"updatedAt" TIMESTAMPTZ NOT NULL,username TEXT UNIQUE,"displayUsername" TEXT,role TEXT NOT NULL DEFAULT 'student',banned BOOLEAN DEFAULT false,"banReason" TEXT,"banExpires" TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS "session"(id TEXT PRIMARY KEY,"expiresAt" TIMESTAMPTZ NOT NULL,token TEXT UNIQUE NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL,"updatedAt" TIMESTAMPTZ NOT NULL,"ipAddress" TEXT,"userAgent" TEXT,"userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,"impersonatedBy" TEXT);
    CREATE TABLE IF NOT EXISTS account(id TEXT PRIMARY KEY,"accountId" TEXT NOT NULL,"providerId" TEXT NOT NULL,"userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,"accessToken" TEXT,"refreshToken" TEXT,"idToken" TEXT,"accessTokenExpiresAt" TIMESTAMPTZ,"refreshTokenExpiresAt" TIMESTAMPTZ,scope TEXT,password TEXT,"createdAt" TIMESTAMPTZ NOT NULL,"updatedAt" TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS verification(id TEXT PRIMARY KEY,identifier TEXT NOT NULL,value TEXT NOT NULL,"expiresAt" TIMESTAMPTZ NOT NULL,"createdAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,subject_id TEXT REFERENCES subjects(id),status TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,reviewed INTEGER NOT NULL DEFAULT 0,data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollments(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,PRIMARY KEY(user_id,subject_id));
    CREATE TABLE IF NOT EXISTS topic_enrollments(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,topic_id TEXT NOT NULL,PRIMARY KEY(user_id,subject_id,topic_id));
    CREATE TABLE IF NOT EXISTS subject_bans(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,reason TEXT,banned_at TEXT NOT NULL,PRIMARY KEY(user_id,subject_id));
    CREATE TABLE IF NOT EXISTS subject_invites(token TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,topic_id TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subject_join_requests(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,topic_id TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,UNIQUE(subject_id,user_id));
    CREATE TABLE IF NOT EXISTS class_invites(token TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS class_join_requests(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,UNIQUE(lesson_id,user_id));
    CREATE TABLE IF NOT EXISTS resources(lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,key TEXT,name TEXT,path TEXT NOT NULL,mime TEXT NOT NULL,PRIMARY KEY(lesson_id,key));
    CREATE TABLE IF NOT EXISTS progress(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,frame_id TEXT NOT NULL,PRIMARY KEY(user_id,lesson_id,frame_id));
    CREATE TABLE IF NOT EXISTS login_attempts(username TEXT PRIMARY KEY,count INTEGER NOT NULL,until BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS institution_logos(id TEXT PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,mime TEXT NOT NULL,data TEXT NOT NULL,path TEXT);
    CREATE TABLE IF NOT EXISTS institution_members(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, institution_id TEXT REFERENCES institutions(id) ON DELETE CASCADE, PRIMARY KEY(user_id, institution_id));
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);

  const generatedPath = path.join(process.cwd(), 'content/generated.json');
  if (existsSync(generatedPath)) {
    const catalog = JSON.parse(readFileSync(generatedPath, 'utf8')) as Catalog;
    for (const i of catalog.institutions) {
      await pglite.query('INSERT INTO institutions(id, data) VALUES ($1, $2)', [
        i.id,
        JSON.stringify(i),
      ]);
    }
    for (const s of catalog.subjects) {
      await pglite.query('INSERT INTO subjects(id, institution_id, data) VALUES ($1, $2, $3)', [
        s.id,
        s.institutionId,
        JSON.stringify(s),
      ]);
    }
    for (const l of catalog.lessons) {
      await pglite.query(
        'INSERT INTO lessons(id, subject_id, status, revision, reviewed, data) VALUES ($1, $2, $3, 1, 1, $4)',
        [l.id, l.subjectId, 'published', JSON.stringify(l)]
      );
    }
  }

  const adapter = {
    connect: async () => ({
      query: async (sql: any, params: any[] = []) => {
        const text = typeof sql === 'string' ? sql : sql?.text || '';
        const values = Array.isArray(sql?.values) ? sql.values : params;
        const res = await pglite.query(text, values);
        return {
          rows: res.rows,
          rowCount: res.affectedRows ?? res.rows.length,
        };
      },
      release: () => {},
    }),
    on: () => adapter,
    query: async (sql: any, params: any[] = []) => {
      const text = typeof sql === 'string' ? sql : sql?.text || '';
      const values = Array.isArray(sql?.values) ? sql.values : params;
      const res = await pglite.query(text, values);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    },
    exec: (sql: string) => pglite.exec(sql),
    close: () => {
      resetDatabaseOverride();
      return pglite.close();
    },
  };

  setDatabaseOverride(adapter);
  return { pglite, adapter };
}
