import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {Catalog,Lesson,Block} from '@/features/catalog/model/types';
const directory=process.env.AULA_DATA_DIR??(process.env.VERCEL==='1'||process.env.AWS_LAMBDA_FUNCTION_NAME?path.join(tmpdir(),'aula-data'):path.join(process.cwd(),'.data'));
let connection:DatabaseSync|undefined;
let pgPool:Pool|undefined;

export function getPgPool():Pool|undefined{
 if(!process.env.DATABASE_URL)return undefined;
 if(!pgPool){
  pgPool=new Pool({
   connectionString:process.env.DATABASE_URL,
   ssl:{rejectUnauthorized:false},
   max:10,
   idleTimeoutMillis:30000,
  });
 }
 return pgPool;
}

let lastSyncTime=0;
export async function syncFromPostgres(force=false){
 const pool=getPgPool();
 if(!pool)return;
 const now=Date.now();
 if(!force&&now-lastSyncTime<2000)return;
 try{
  const res=await pool.query(`
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
      'subject_bans', COALESCE((SELECT json_agg(b) FROM subject_bans b), '[]'::json),
      'progress', COALESCE((SELECT json_agg(p) FROM progress p), '[]'::json)
    ) as state;
  `);
  const state=res.rows[0]?.state;
  if(!state)return;
  const sql=db();
  sql.exec('BEGIN IMMEDIATE');
  try{
   if(Array.isArray(state.users)){
    if(state.users.length===0){
     sql.prepare('DELETE FROM users').run();
     sql.prepare('DELETE FROM user').run();
     sql.prepare('DELETE FROM account').run();
     sql.prepare('DELETE FROM sessions').run();
     sql.prepare('DELETE FROM session').run();
    }else{
     const userIds=new Set(state.users.map((u:any)=>u.id));
     const localUsers=sql.prepare('SELECT id FROM users').all() as {id:string}[];
     for(const lu of localUsers){
      if(!userIds.has(lu.id)){
       sql.prepare('DELETE FROM users WHERE id=?').run(lu.id);
       sql.prepare('DELETE FROM user WHERE id=?').run(lu.id);
       sql.prepare('DELETE FROM account WHERE userId=?').run(lu.id);
      }
     }
     for(const u of state.users){
      sql.prepare('INSERT INTO users(id,name,username,password,role) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,password=excluded.password,role=excluded.role').run(u.id,u.name,u.username,u.password,u.role);
     }
    }
   }
   if(Array.isArray(state.sessions)){
    for(const s of state.sessions){
     sql.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,expires=excluded.expires').run(s.token,s.user_id,Number(s.expires));
    }
   }
   if(Array.isArray(state.user)){
    for(const usr of state.user){
     sql.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt,username,displayUsername,role,banned,banReason,banExpires) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,emailVerified=excluded.emailVerified,updatedAt=excluded.updatedAt,username=excluded.username,displayUsername=excluded.displayUsername,role=excluded.role,banned=excluded.banned').run(usr.id,usr.name,usr.email,usr.emailVerified?1:0,usr.image,usr.createdAt,usr.updatedAt,usr.username,usr.displayUsername,usr.role,usr.banned?1:0,usr.banReason,usr.banExpires);
    }
   }
   if(Array.isArray(state.session)){
    for(const ses of state.session){
     sql.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId,impersonatedBy) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expiresAt=excluded.expiresAt,token=excluded.token,updatedAt=excluded.updatedAt').run(ses.id,ses.expiresAt,ses.token,ses.createdAt,ses.updatedAt,ses.ipAddress,ses.userAgent,ses.userId,ses.impersonatedBy);
    }
   }
   if(Array.isArray(state.enrollments)){
    for(const e of state.enrollments){
     sql.prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)').run(e.user_id,e.subject_id);
    }
   }
   if(Array.isArray(state.subject_bans)){
    for(const b of state.subject_bans){
     sql.prepare('INSERT INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?) ON CONFLICT(user_id,subject_id) DO UPDATE SET reason=excluded.reason,banned_at=excluded.banned_at').run(b.user_id,b.subject_id,b.reason,b.banned_at);
    }
   }
   if(Array.isArray(state.progress)){
    for(const p of state.progress){
     sql.prepare('INSERT OR IGNORE INTO progress(user_id,lesson_id,frame_id) VALUES (?,?,?)').run(p.user_id,p.lesson_id,p.frame_id);
    }
   }
   sql.exec('COMMIT');
   lastSyncTime=Date.now();
  }catch(err){
   sql.exec('ROLLBACK');
   console.error('Failed to apply sync state to SQLite:', err);
  }
 }catch(err){
  console.error('Failed to sync from Postgres:', err);
 }
}
export function db(){
 if(connection)return connection;
 mkdirSync(directory,{recursive:true,mode:0o700});connection=new DatabaseSync(path.join(directory,'aula.sqlite'));
 connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('teacher','student')));
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
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 if(!connection.prepare("SELECT key FROM metadata WHERE key='seed-v1'").get())seed(connection);
 return connection;
}
export function syncBetterAuthUser(id:string,name:string,username:string,password:string,role:'teacher'|'student'){
 const sql=db(),now=new Date().toISOString(),email=username.includes('@')?username:`${username}@aula.local`;
 sql.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,role,banned) VALUES (?,?,?,1,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,updatedAt=excluded.updatedAt,username=excluded.username,displayUsername=excluded.displayUsername,role=excluded.role').run(id,name,email,now,now,username,username,role);
 const existingAcc=sql.prepare("SELECT id FROM account WHERE userId=? AND providerId='credential'").get(id) as {id:string}|undefined;
 if(existingAcc)sql.prepare('UPDATE account SET password=?,updatedAt=? WHERE id=?').run(password,now,existingAcc.id);
 else sql.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)").run(randomUUID(),id,id,password,now,now);

 const pool=getPgPool();
 if(pool){
  pool.query(`
   INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",username,"displayUsername",role,banned)
   VALUES ($1,$2,$3,true,$4,$4,$5,$5,$6,false)
   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,"updatedAt"=EXCLUDED."updatedAt",username=EXCLUDED.username,"displayUsername"=EXCLUDED."displayUsername",role=EXCLUDED.role
  `,[id,name,email,now,username,role]).then(()=>{
   return pool.query(`
    INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
    VALUES ($1,$2,'credential',$2,$3,$4,$4)
    ON CONFLICT(id) DO UPDATE SET password=EXCLUDED.password,"updatedAt"=EXCLUDED."updatedAt"
   `,[randomUUID(),id,password,now]);
  }).catch(e=>console.error('PG sync user err:',e.message));
 }
}
function seed(sql:DatabaseSync){
 const catalog=JSON.parse(readFileSync(path.join(process.cwd(),'content/generated.json'),'utf8')) as Catalog;
 sql.exec('BEGIN IMMEDIATE');try{
 if(sql.prepare("SELECT key FROM metadata WHERE key='seed-v1'").get()){sql.exec('COMMIT');return;}

 for(const i of catalog.institutions)sql.prepare('INSERT OR IGNORE INTO institutions VALUES (?,?)').run(i.id,JSON.stringify(i));
 for(const s of catalog.subjects)sql.prepare('INSERT OR IGNORE INTO subjects VALUES (?,?,?)').run(s.id,s.institutionId,JSON.stringify(s));
 for(const original of catalog.lessons){const l=structuredClone(original);sql.prepare('INSERT OR IGNORE INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,?,1,1,?)').run(l.id,l.subjectId,'published',JSON.stringify(l));
  function resource(url:string,name?:string){const relative=url.replace(/^\//,'');const file=path.join(process.cwd(),'content/materials',relative);if(!existsSync(file))return url;
   const key=createHash('sha256').update(relative).digest('hex').slice(0,24);const mime=url.endsWith('.svg')?'image/svg+xml':url.endsWith('.pdf')?'application/pdf':url.endsWith('.tex')?'text/plain; charset=utf-8':url.endsWith('.png')?'image/png':'image/jpeg';
   sql.prepare('INSERT OR REPLACE INTO resources VALUES (?,?,?,?,?)').run(l.id,key,name??path.basename(url),file,mime);return `/api/materials/${l.id}/${key}`;
  }
  function walk(blocks:Block[]){for(const b of blocks){if(b.asset)b.asset=resource(b.asset);if(b.children)walk(b.children);if(b.items)for(const list of b.items)walk(list);}}
  l.pdf=resource(l.pdf);l.source=resource(`/resources/${l.id}.tex`,path.basename(l.source));for(const f of l.frames)walk(f.blocks);
  sql.prepare('UPDATE lessons SET data=? WHERE id=?').run(JSON.stringify(l),l.id);
 }
 sql.prepare('INSERT INTO metadata VALUES (?,?)').run('seed-v1',new Date().toISOString());sql.exec('COMMIT');
 }catch(error){sql.exec('ROLLBACK');throw error;}
}
export const dataDirectory=()=>directory;
export function transaction<T>(fn:()=>T):T{const sql=db();sql.exec('BEGIN IMMEDIATE');try{
const result=fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}
export function lessonRecord(id:string){return db().prepare('SELECT * FROM lessons WHERE id=?').get(id) as {id:string;subject_id:string;status:string;revision:number;reviewed:number;data:string}|undefined;}
export function readLesson(id:string){const row=lessonRecord(id);return row?JSON.parse(row.data) as Lesson:undefined;}
