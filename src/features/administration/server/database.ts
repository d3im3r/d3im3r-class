import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Catalog,Lesson,Block} from '@/features/catalog/model/types';
const directory=process.env.AULA_DATA_DIR??(process.env.VERCEL==='1'||process.env.AWS_LAMBDA_FUNCTION_NAME?path.join(tmpdir(),'aula-data'):path.join(process.cwd(),'.data'));
let connection:DatabaseSync|undefined;
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
