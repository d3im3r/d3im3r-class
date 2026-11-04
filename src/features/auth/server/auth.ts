import {cookies,headers} from 'next/headers';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {db,transaction,syncBetterAuthUser,getPgPool,syncFromPostgres} from '@/features/administration/server/database';
import {hasPermission,type PermissionRequest,ac,roles} from './permissions';
import {getAuth} from './better-auth';
import type {User} from '../types';
export {hasPermission,type PermissionRequest,ac,roles};
export class AppError extends Error{constructor(message:string,public status=400){super(message);}}
export function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function passwordMatches(password:string,stored:string){try{const [salt,key]=stored.split(':');return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64));}catch{return false;}}
export function text(value:unknown,label:string,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw new AppError(`${label}: introduce un valor válido (máximo ${max} caracteres).`);return value.trim();}
export function validatePassword(value:unknown){if(typeof value!=='string'||value.length<10||value.length>256)throw new AppError('La contraseña debe tener entre 10 y 256 caracteres.');return value;}
export function createUser(input:Record<string,unknown>,role:'teacher'|'student'):User{
 const name=text(input.name,'Nombre',100),username=text(input.username,'Usuario',100).toLowerCase();if(!/^[a-z0-9][a-z0-9@._+-]{2,99}$/.test(username))throw new AppError('El usuario debe tener al menos 3 caracteres: letras sin tildes, números, punto, guion o correo.');
 const password=validatePassword(input.password);if(db().prepare('SELECT id FROM users WHERE username=?').get(username))throw new AppError('Ese usuario ya existe.',409);
 const user={id:randomUUID(),name,username,role},hashed=passwordHash(password);
 db().prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id,name,username,hashed,role);
 syncBetterAuthUser(user.id,name,username,hashed,role);
 const pool=getPgPool();
 if(pool){
  pool.query('INSERT INTO users(id,name,username,password,role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,username=EXCLUDED.username,password=EXCLUDED.password,role=EXCLUDED.role',[user.id,name,username,hashed,role]).catch(e=>console.error('PG create user err:',e.message));
 }
 if(role==='student'){
  const subjects=db().prepare('SELECT id FROM subjects').all() as {id:string}[];
  for(const s of subjects){
   db().prepare('INSERT OR IGNORE INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?)').run(user.id,s.id,'Esperando autorización del docente',new Date().toISOString());
   if(pool){
    pool.query('INSERT INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user.id,s.id,'Esperando autorización del docente',new Date().toISOString()]).catch(()=>{});
   }
  }
 }
 return user;
}
export function needsSetup(){return !db().prepare("SELECT id FROM users WHERE role='teacher' LIMIT 1").get();}
export function setup(input:Record<string,unknown>){return transaction(()=>{if(!needsSetup())throw new AppError('La cuenta docente inicial ya fue configurada.',409);return createUser(input,'teacher');});}
const cookieName=process.env.AULA_SESSION_COOKIE??'aula_session';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');

export async function currentUser():Promise<User|null>{
 await syncFromPostgres();
 let jar:any;
 try{jar=await cookies();}catch{}
 const token=jar?.get(cookieName)?.value;
 if(token){
  const hashed=digest(token),nowIso=new Date().toISOString();
  const baRow=db().prepare('SELECT u.id,u.name,u.username,u.role,u.banned FROM session s JOIN user u ON u.id=s.userId WHERE s.token=? AND s.expiresAt>?').get(hashed,nowIso) as {id:string;name:string;username:string;role:'teacher'|'student';banned:number}|undefined;
  if(baRow){
   if(baRow.banned)return null;
   return {id:baRow.id,name:baRow.name,username:baRow.username,role:baRow.role};
  }
  const row=db().prepare('SELECT u.id,u.name,u.username,u.role,u.password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hashed,Date.now()) as (User&{password:string})|undefined;
  if(row){
   syncBetterAuthUser(row.id,row.name,row.username,row.password,row.role);
   const expiresIso=new Date(Date.now()+7*86400000).toISOString();
   db().prepare('INSERT OR IGNORE INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)').run(randomUUID(),expiresIso,hashed,nowIso,nowIso,row.id);
   return {id:row.id,name:row.name,username:row.username,role:row.role};
  }
 }
 try{
  const baSession=await getAuth().api.getSession({headers:await headers()});
  if(baSession?.user){
   const u=baSession.user as {id:string;name:string;username?:string|null;email:string;role?:string|null;banned?:boolean|null};
   if(u.banned)return null;
   const role=(u.role==='teacher'?'teacher':'student') as 'teacher'|'student';
   const existing=db().prepare('SELECT id,name,username,role FROM users WHERE id=?').get(u.id) as User|undefined;
   if(!existing){
    const uname=u.username??u.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._+-]/g,'');
    db().prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?)').run(u.id,u.name,uname,'google-oauth',role);
    if(role==='student'){
     const subjects=db().prepare('SELECT id FROM subjects').all() as {id:string}[];
     for(const s of subjects){
      db().prepare('INSERT OR IGNORE INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?)').run(u.id,s.id,'Esperando autorización del docente',new Date().toISOString());
     }
    }
   }
   return {
    id:u.id,
    name:u.name,
    username:u.username??u.email.replace(/@aula\.local$/,''),
    role,
   };
  }
 }catch{
  // ignore when headers context is unavailable
 }
 return null;
}

export async function requireUser(role?:'teacher'|'student'){
 const user=await currentUser();
 if(!user)throw new AppError('Inicia sesión para continuar.',401);
 if(role&&user.role!==role)throw new AppError('No tienes permiso para realizar esta acción.',403);
 return user;
}

export async function requirePermission(permissions:PermissionRequest):Promise<User>{
 const user=await currentUser();
 if(!user)throw new AppError('Inicia sesión para continuar.',401);
 if(!hasPermission(user,permissions))throw new AppError('No tienes permiso para realizar esta acción.',403);
 return user;
}

export async function startSession(user:User){
 let jar:any;
 try{jar=await cookies();}catch{}
 const old=jar?.get(cookieName)?.value;
 if(old){
  const oldHash=digest(old);
  db().prepare('DELETE FROM sessions WHERE token=?').run(oldHash);
  db().prepare('DELETE FROM session WHERE token=?').run(oldHash);
 }
 const token=randomBytes(32).toString('hex'),hashed=digest(token),now=Date.now(),expires=now+7*86400000,nowIso=new Date(now).toISOString(),expiresIso=new Date(expires).toISOString();
 const dbUser=db().prepare('SELECT password FROM users WHERE id=?').get(user.id) as {password:string}|undefined;
 if(dbUser)syncBetterAuthUser(user.id,user.name,user.username,dbUser.password,user.role);
 db().prepare('DELETE FROM sessions WHERE expires<?').run(now);
 db().prepare('DELETE FROM session WHERE expiresAt<?').run(nowIso);
 db().prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashed,user.id,expires);
 db().prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)').run(randomUUID(),expiresIso,hashed,nowIso,nowIso,user.id);
 const pool=getPgPool();
 if(pool){
  if(old){
   const oldHash=digest(old);
   pool.query('DELETE FROM sessions WHERE token=$1',[oldHash]).catch(()=>{});
   pool.query('DELETE FROM "session" WHERE token=$1',[oldHash]).catch(()=>{});
  }
  pool.query('DELETE FROM sessions WHERE expires < $1',[now]).catch(()=>{});
  pool.query('DELETE FROM "session" WHERE "expiresAt" < $1',[nowIso]).catch(()=>{});
  pool.query('INSERT INTO sessions(token,user_id,expires) VALUES ($1,$2,$3) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,expires=EXCLUDED.expires',[hashed,user.id,expires]).catch(e=>console.error('PG session err:',e.message));
  pool.query('INSERT INTO "session"(id,"expiresAt",token,"createdAt","updatedAt","userId") VALUES ($1,$2,$3,$4,$4,$5) ON CONFLICT(id) DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt",token=EXCLUDED.token,"updatedAt"=EXCLUDED."updatedAt"',[randomUUID(),expiresIso,hashed,nowIso,user.id]).catch(e=>console.error('PG session err:',e.message));
 }
 jar?.set(cookieName,token,{httpOnly:true,sameSite:'lax',secure:process.env.AULA_SECURE_COOKIES==='1',path:'/',maxAge:7*86400});
 return {token,cookieName};
}

export async function endSession(){
 let jar:any;
 try{jar=await cookies();}catch{}
 const token=jar?.get(cookieName)?.value;
 if(token){
  const hashed=digest(token);
  db().prepare('DELETE FROM sessions WHERE token=?').run(hashed);
  db().prepare('DELETE FROM session WHERE token=?').run(hashed);
  const pool=getPgPool();
  if(pool){
   pool.query('DELETE FROM sessions WHERE token=$1',[hashed]).catch(()=>{});
   pool.query('DELETE FROM "session" WHERE token=$1',[hashed]).catch(()=>{});
  }
 }
 jar?.delete(cookieName);
}

export function login(input:Record<string,unknown>){const username=text(input.username,'Usuario',100).toLowerCase(),password=typeof input.password==='string'&&input.password.length<=256?input.password:'';const attempt=db().prepare('SELECT count,until FROM login_attempts WHERE username=?').get(username) as {count:number;until:number}|undefined;
 if(attempt&&attempt.until>Date.now()&&attempt.count>=5)throw new AppError('Demasiados intentos. Intenta nuevamente en 15 minutos.',429);
 const row=db().prepare('SELECT * FROM users WHERE username=?').get(username) as (User&{password:string})|undefined;
 const valid=passwordMatches(password,row?.password??('0'.repeat(32)+':'+'0'.repeat(128)));
 if(!row||!valid){db().prepare('INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(username) DO UPDATE SET count=excluded.count,until=excluded.until').run(username,attempt&&attempt.until>Date.now()?attempt.count+1:1,attempt&&attempt.until>Date.now()?attempt.until:Date.now()+900000);throw new AppError('Usuario o contraseña incorrectos.',401);}
 db().prepare('DELETE FROM login_attempts WHERE username=?').run(username);
 syncBetterAuthUser(row.id,row.name,row.username,row.password,row.role);
 const {password:_,...user}=row;return user;
}

export async function loginDevGoogle(input:Record<string,unknown>):Promise<User>{
 const email=typeof input.email==='string'&&input.email.includes('@')?input.email.trim().toLowerCase():'alumno.google@gmail.com';
 const name=typeof input.name==='string'&&input.name.trim()?input.name.trim():'Alumno Google';
 const username=email.split('@')[0].toLowerCase().replace(/[^a-z0-9._+-]/g,'');
 let user=db().prepare('SELECT id,name,username,role FROM users WHERE username=?').get(username) as User|undefined;
 if(!user){
  user={id:randomUUID(),name,username,role:'student'};
  db().prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id,name,username,'google-oauth','student');
  const subjects=db().prepare('SELECT id FROM subjects').all() as {id:string}[];
  for(const s of subjects){
   db().prepare('INSERT OR IGNORE INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?)').run(user.id,s.id,'Esperando autorización del docente',new Date().toISOString());
  }
 }
 syncBetterAuthUser(user.id,user.name,user.username,'google-oauth',user.role);
 await startSession(user);
 return user;
}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(!origin)return;
 try{
  const url=new URL(origin);
  const forwardedHost=request.headers.get('x-forwarded-host');
  const host=forwardedHost??request.headers.get('host')??new URL(request.url).host;
  if(!['http:','https:'].includes(url.protocol)||(url.host!==host&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1'))throw new Error();
 }catch{
  throw new AppError('Origen de solicitud no permitido.',403);
 }
}
export function errorResponse(error:unknown){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status});console.error('Aula:',error instanceof Error?error.message:'Error interno');return Response.json({error:'No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.'},{status:500});}
