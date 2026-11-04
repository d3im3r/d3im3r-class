import {randomUUID} from 'node:crypto';
import {db,transaction,lessonRecord,userAccessibleSubjectIds,userAccessibleInstitutionIds,getPgPool} from './database';
import {AppError,text,createUser,resetPassword} from '@/features/auth/server/auth';
import type {Subject,Institution,Lesson} from '@/features/catalog/model/types';
import type {User} from '@/features/auth/types';
const object=(row:Record<string,unknown>|undefined)=>row?JSON.parse(row.data as string):null;
export function snapshot(actor?:User){
 const allowed=actor?userAccessibleSubjectIds(actor):null;
 const isUnrestricted=allowed===null;

 let institutions=db().prepare('SELECT data FROM institutions').all().map(r=>object(r) as Institution);
 let subjects=db().prepare('SELECT data FROM subjects').all().map(r=>object(r) as Subject);
 
 if(!isUnrestricted&&actor){
  const memberInstIds=new Set((db().prepare('SELECT institution_id FROM institution_members WHERE user_id=?').all(actor.id) as {institution_id:string}[]).map(r=>r.institution_id));
  subjects=subjects.filter(s=>allowed.has(s.id)||memberInstIds.has(s.institutionId));
  const instIds=new Set([...subjects.map(s=>s.institutionId),...memberInstIds]);
  institutions=institutions.filter(i=>instIds.has(i.id));
 }

 const subjectIdSet=new Set(subjects.map(s=>s.id));

 let lessons=db().prepare('SELECT * FROM lessons').all().map(r=>{const l=object(r) as Lesson;return {id:l.id,title:l.title,subtitle:l.subtitle,subjectId:l.subjectId,topicId:l.topicId,status:r.status,revision:r.revision,reviewed:r.reviewed,frames:l.frames.length,diagnostics:l.diagnostics};});
 if(!isUnrestricted){
  lessons=lessons.filter(l=>subjectIdSet.has(l.subjectId));
 }

 let enrollments=db().prepare('SELECT user_id AS userId,subject_id AS subjectId FROM enrollments').all() as {userId:string;subjectId:string}[];
 if(!isUnrestricted){
  enrollments=enrollments.filter(e=>subjectIdSet.has(e.subjectId));
 }

 let bans=db().prepare('SELECT user_id AS userId,subject_id AS subjectId,reason,banned_at AS bannedAt FROM subject_bans').all() as {userId:string;subjectId:string;reason?:string;bannedAt:string}[];
 if(!isUnrestricted){
  bans=bans.filter(b=>subjectIdSet.has(b.subjectId));
 }

 let invites=db().prepare('SELECT subject_id AS subjectId,token FROM subject_invites').all() as {subjectId:string;token:string}[];
 if(!isUnrestricted){
  invites=invites.filter(i=>subjectIdSet.has(i.subjectId));
 }

 let joinRequests=db().prepare("SELECT r.id,r.subject_id AS subjectId,r.user_id AS userId,r.status,r.created_at AS createdAt,u.name AS userName,u.username,s.institution_id AS institutionId FROM subject_join_requests r JOIN users u ON u.id=r.user_id JOIN subjects s ON s.id=r.subject_id WHERE r.status='pending' ORDER BY r.created_at DESC").all() as {id:string;subjectId:string;userId:string;status:string;createdAt:string;userName:string;username:string;institutionId:string}[];
 if(!isUnrestricted){
  joinRequests=joinRequests.filter(r=>subjectIdSet.has(r.subjectId));
 }

 let users=db().prepare('SELECT id,name,username,role FROM users ORDER BY name').all() as {id:string;name:string;username:string;role:string}[];
 if(!isUnrestricted&&actor){
  const allowedUserIds=new Set<string>();
  allowedUserIds.add(actor.id);
  for(const e of enrollments)allowedUserIds.add(e.userId);
  for(const r of joinRequests)allowedUserIds.add(r.userId);
  users=users.filter(u=>allowedUserIds.has(u.id));
 }

 let institutionMembers=db().prepare('SELECT user_id AS userId,institution_id AS institutionId FROM institution_members').all() as {userId:string;institutionId:string}[];
 if(!isUnrestricted&&actor){
  institutionMembers=institutionMembers.filter(im=>im.userId===actor.id);
 }

 return {institutions,subjects,lessons,users,enrollments,bans,invites,joinRequests,institutionMembers};
}
function subject(id:unknown){const key=text(id,'Materia');const s=object(db().prepare('SELECT data FROM subjects WHERE id=?').get(key)) as Subject|null;if(!s)throw new AppError('Materia no encontrada.',404);return s;}
function subjectIds(value:unknown){if(!Array.isArray(value)||value.length>200)throw new AppError('Selecciona las materias.');return [...new Set(value.map(v=>subject(v).id))];}
export function manage(input:Record<string,unknown>,actor?:User){return transaction(()=>{switch(input.action){
 case 'institution':{
  if(actor&&actor.role!=='admin')throw new AppError('Solo los administradores pueden añadir o editar instituciones.',403);
  const id=typeof input.id==='string'&&input.id?input.id:randomUUID();
  const i:Institution={id,name:text(input.name,'Institución',150),shortName:text(input.shortName,'Nombre corto',35),city:text(input.city,'Ciudad',100),color:input.color==='green'?'green':'blue',logo:object(db().prepare('SELECT data FROM institutions WHERE id=?').get(id))?.logo};
  db().prepare('INSERT INTO institutions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(i));
  break;
 }
 case 'teacher':{
  if(actor&&actor.role!=='admin')throw new AppError('Solo los administradores pueden registrar nuevos docentes.',403);
  const institutionId=typeof input.institutionId==='string'&&input.institutionId.trim()?input.institutionId.trim():'';
  const rawSubjectIds=Array.isArray(input.subjectIds)?input.subjectIds:(typeof input.subjectId==='string'&&input.subjectId?[input.subjectId]:[]);
  const user=createUser(input,'teacher');
  let enrolledSubjectIds:string[]=[];
  if(institutionId){
   if(!db().prepare('SELECT id FROM institutions WHERE id=?').get(institutionId))throw new AppError('Institución no encontrada.',404);
   db().prepare('INSERT OR IGNORE INTO institution_members(user_id,institution_id) VALUES (?,?)').run(user.id,institutionId);
   if(rawSubjectIds.length===0){
    const instSubjects=db().prepare('SELECT id FROM subjects WHERE institution_id=?').all(institutionId) as {id:string}[];
    enrolledSubjectIds=instSubjects.map(s=>s.id);
   }
  }
  if(rawSubjectIds.length>0){
   const sIds=subjectIds(rawSubjectIds);
   enrolledSubjectIds=[...new Set([...enrolledSubjectIds,...sIds])];
  }
  for(const sId of enrolledSubjectIds){
   db().prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)').run(user.id,sId);
  }
  const pool=getPgPool();
  if(pool){
   if(institutionId){
    pool.query('INSERT INTO institution_members(user_id,institution_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[user.id,institutionId]).catch(console.error);
   }
   for(const sId of enrolledSubjectIds){
    pool.query('INSERT INTO enrollments(user_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[user.id,sId]).catch(console.error);
   }
  }
  break;
 }
 case 'resetPassword':{
  const userId=text(input.userId,'Usuario');
  const target=db().prepare('SELECT id,name,username,role FROM users WHERE id=?').get(userId) as User|undefined;
  if(!target)throw new AppError('Usuario no encontrado.',404);
  if(target.role==='admin'&&actor?.id!==target.id&&actor?.role!=='admin'){
   throw new AppError('No tienes permiso para restablecer la contraseña de un administrador.',403);
  }
  if(target.role==='teacher'&&actor&&actor.role!=='admin'){
   throw new AppError('Solo los administradores pueden restablecer la contraseña de otro docente.',403);
  }
  if(actor&&actor.role==='teacher'&&target.role==='student'){
   const teacherSubjects=userAccessibleSubjectIds(actor);
   const isStudentInTeacherSubjects=db().prepare(`
     SELECT 1 FROM enrollments WHERE user_id=? AND subject_id IN (${teacherSubjects&&teacherSubjects.size>0?[...teacherSubjects].map(()=>'?').join(','):"''"})
   `).get(target.id,...(teacherSubjects?[...teacherSubjects]:[]));
   if(!isStudentInTeacherSubjects)throw new AppError('No tienes permiso para restablecer la contraseña de alumnos que no pertenecen a tus materias.',403);
  }
  resetPassword(userId,input.password);
  break;
 }
 case 'subject':{
  const institutionId=text(input.institutionId,'Institución');
  if(!db().prepare('SELECT id FROM institutions WHERE id=?').get(institutionId))throw new AppError('Institución no encontrada.');
  if(actor&&actor.role==='teacher'){
   const allowedInsts=userAccessibleInstitutionIds(actor);
   if(!allowedInsts||!allowedInsts.has(institutionId))throw new AppError('No tienes permiso para gestionar materias en esta institución.',403);
   if(input.id){
    const allowedSubs=userAccessibleSubjectIds(actor);
    if(!allowedSubs||!allowedSubs.has(String(input.id)))throw new AppError('No tienes permiso para modificar esta materia.',403);
   }
  }
  const existing=input.id?subject(input.id):null;
  const description=typeof input.description==='string'?input.description.trim().slice(0,600):'';
  const s:Subject={id:existing?.id??randomUUID(),institutionId,name:text(input.name,'Materia',120),code:text(input.code,'Código',40),description,icon:input.icon==='robot'?'robot':'code',topics:existing?.topics??[]};
  if(existing&&existing.institutionId!==institutionId)throw new AppError('La institución de una materia existente no se puede cambiar.');
  db().prepare('INSERT INTO subjects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.id,institutionId,JSON.stringify(s));
  if(actor&&actor.role==='teacher'){
   db().prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)').run(actor.id,s.id);
  }
  break;
 }
 case 'topic':{
  const subjectId=String(input.subjectId);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(subjectId))throw new AppError('No tienes permiso para modificar temas de esta materia.',403);
  }
  const s=subject(subjectId),name=text(input.name,'Tema',120);
  const id=typeof input.id==='string'?input.id:'';
  if(id){
   const topic=s.topics.find(t=>t.id===id);
   if(!topic)throw new AppError('Tema no encontrado.');
   topic.name=name;
  }else s.topics.push({id:randomUUID(),name});
  db().prepare('UPDATE subjects SET data=? WHERE id=?').run(JSON.stringify(s),s.id);
  break;
 }
 case 'moveTopic':{
  const subjectId=String(input.subjectId);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(subjectId))throw new AppError('No tienes permiso para modificar temas de esta materia.',403);
  }
  const s=subject(subjectId),index=s.topics.findIndex(t=>t.id===input.topicId),target=index+(input.direction==='up'?-1:1);
  if(index<0||target<0||target>=s.topics.length)throw new AppError('No se puede mover el tema.');
  [s.topics[index],s.topics[target]]=[s.topics[target],s.topics[index]];
  db().prepare('UPDATE subjects SET data=? WHERE id=?').run(JSON.stringify(s),s.id);
  break;
 }
 case 'student':{
  const institutionId=typeof input.institutionId==='string'&&input.institutionId.trim()?input.institutionId.trim():'';
  let rawSubjectIds=Array.isArray(input.subjectIds)?input.subjectIds:(typeof input.subjectId==='string'&&input.subjectId?[input.subjectId]:[]);
  if(rawSubjectIds.length===0&&institutionId){
   const instSubjects=db().prepare('SELECT id FROM subjects WHERE institution_id=?').all(institutionId) as {id:string}[];
   rawSubjectIds=instSubjects.map(s=>s.id);
  }
  const ids=rawSubjectIds.length>0?subjectIds(rawSubjectIds):[];
  if(actor&&actor.role==='teacher'){
   if(ids.length===0)throw new AppError('Debes asignar al alumno al menos a una de tus materias.',400);
   const teacherSubjects=userAccessibleSubjectIds(actor);
   for(const id of ids){
    if(!teacherSubjects||!teacherSubjects.has(id))throw new AppError('No tienes permiso para matricular alumnos en materias que no impartes.',403);
   }
  }
  const user=createUser(input,'student');
  for(const id of ids){
   db().prepare('INSERT OR IGNORE INTO enrollments VALUES (?,?)').run(user.id,id);
   db().prepare('DELETE FROM subject_bans WHERE user_id=? AND subject_id=?').run(user.id,id);
  }
  const pool=getPgPool();
  if(pool){
   for(const sId of ids){
    pool.query('INSERT INTO enrollments(user_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[user.id,sId]).catch(console.error);
   }
  }
  break;
 }
 case 'assign':{
  const userId=text(input.userId,'Alumno');
  if(!db().prepare("SELECT id FROM users WHERE id=? AND role='student'").get(userId))throw new AppError('Alumno no encontrado.');
  const ids=subjectIds(input.subjectIds);
  if(actor&&actor.role==='teacher'){
   const teacherSubjects=userAccessibleSubjectIds(actor);
   if(!teacherSubjects)throw new AppError('No tienes materias asignadas.',403);
   for(const sId of ids){
    if(!teacherSubjects.has(sId))throw new AppError('No tienes permiso para asignar materias que no impartes.',403);
   }
   for(const sId of teacherSubjects){
    if(ids.includes(sId)){
     db().prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)').run(userId,sId);
     db().prepare('DELETE FROM subject_bans WHERE user_id=? AND subject_id=?').run(userId,sId);
    }else{
     db().prepare('DELETE FROM enrollments WHERE user_id=? AND subject_id=?').run(userId,sId);
    }
   }
  }else{
   db().prepare('DELETE FROM enrollments WHERE user_id=?').run(userId);
   for(const id of ids){
    db().prepare('INSERT INTO enrollments VALUES (?,?)').run(userId,id);
    db().prepare('DELETE FROM subject_bans WHERE user_id=? AND subject_id=?').run(userId,id);
   }
  }
  const pool=getPgPool();
  if(pool){
   pool.query('DELETE FROM enrollments WHERE user_id=$1',[userId]).then(()=>{
    const allCurrent=db().prepare('SELECT subject_id FROM enrollments WHERE user_id=?').all(userId) as {subject_id:string}[];
    for(const row of allCurrent){
     pool.query('INSERT INTO enrollments(user_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[userId,row.subject_id]).catch(console.error);
    }
   }).catch(console.error);
  }
  break;
 }
 case 'review':{
  const row=lessonRecord(text(input.lessonId,'Clase'));
  if(!row)throw new AppError('Clase no encontrada.',404);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(row.subject_id))throw new AppError('No tienes permiso para gestionar clases de esta materia.',403);
  }
  const l=JSON.parse(row.data) as Lesson;
  if(!l.frames.length)throw new AppError('La clase no contiene bloques.');
  if(input.acknowledged!==true)throw new AppError('Confirma que revisaste la vista previa y los avisos.');
  db().prepare('UPDATE lessons SET reviewed=revision WHERE id=?').run(row.id);
  break;
 }
 case 'publish':{
  const row=lessonRecord(text(input.lessonId,'Clase'));
  if(!row)throw new AppError('Clase no encontrada.',404);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(row.subject_id))throw new AppError('No tienes permiso para gestionar clases de esta materia.',403);
  }
  if(row.reviewed!==row.revision)throw new AppError('Revisa esta versión de la clase antes de publicarla.');
  db().prepare("UPDATE lessons SET status='published' WHERE id=?").run(row.id);
  break;
 }
 case 'unpublish':{
  const row=lessonRecord(text(input.lessonId,'Clase'));
  if(!row)throw new AppError('Clase no encontrada.',404);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(row.subject_id))throw new AppError('No tienes permiso para gestionar clases de esta materia.',403);
  }
  db().prepare("UPDATE lessons SET status='draft' WHERE id=?").run(row.id);
  break;
 }
 case 'banStudent':{
  const userId=text(input.userId,'Alumno'),subjectId=text(input.subjectId,'Materia');
  if(!db().prepare("SELECT id FROM users WHERE id=? AND role='student'").get(userId))throw new AppError('Alumno no encontrado.');
  subject(subjectId);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(subjectId))throw new AppError('No tienes permiso para moderar alumnos en esta materia.',403);
  }
  const reason=typeof input.reason==='string'?input.reason.trim().slice(0,300):'';
  db().prepare('INSERT OR REPLACE INTO subject_bans(user_id,subject_id,reason,banned_at) VALUES (?,?,?,?)').run(userId,subjectId,reason,new Date().toISOString());
  break;
 }
 case 'unbanStudent':{
  const userId=text(input.userId,'Alumno'),subjectId=text(input.subjectId,'Materia');
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(subjectId))throw new AppError('No tienes permiso para moderar alumnos en esta materia.',403);
  }
  db().prepare('DELETE FROM subject_bans WHERE user_id=? AND subject_id=?').run(userId,subjectId);
  break;
 }
 case 'getOrCreateInvite':{
  const subjectId=text(input.subjectId,'Materia');
  subject(subjectId);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(subjectId))throw new AppError('No tienes permiso para generar enlaces de esta materia.',403);
  }
  const existing=db().prepare('SELECT token FROM subject_invites WHERE subject_id=?').get(subjectId) as {token:string}|undefined;
  if(!existing){
   const token=randomUUID();
   db().prepare('INSERT INTO subject_invites(token,subject_id,created_at) VALUES (?,?,?)').run(token,subjectId,new Date().toISOString());
  }
  break;
 }
 case 'approveJoinRequest':{
  const requestId=text(input.requestId,'Solicitud');
  const req=db().prepare('SELECT id,subject_id,user_id FROM subject_join_requests WHERE id=?').get(requestId) as {id:string;subject_id:string;user_id:string}|undefined;
  if(!req)throw new AppError('Solicitud no encontrada.',404);
  if(actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(req.subject_id))throw new AppError('No tienes permiso para responder solicitudes de esta materia.',403);
  }
  db().prepare('INSERT OR IGNORE INTO enrollments(user_id,subject_id) VALUES (?,?)').run(req.user_id,req.subject_id);
  db().prepare('DELETE FROM subject_bans WHERE user_id=? AND subject_id=?').run(req.user_id,req.subject_id);
  db().prepare("UPDATE subject_join_requests SET status='approved' WHERE id=?").run(req.id);
  break;
 }
 case 'rejectJoinRequest':{
  const requestId=text(input.requestId,'Solicitud');
  const req=db().prepare('SELECT id,subject_id,user_id FROM subject_join_requests WHERE id=?').get(requestId) as {id:string;subject_id:string;user_id:string}|undefined;
  if(req&&actor&&actor.role==='teacher'){
   const allowedSubs=userAccessibleSubjectIds(actor);
   if(!allowedSubs||!allowedSubs.has(req.subject_id))throw new AppError('No tienes permiso para responder solicitudes de esta materia.',403);
  }
  db().prepare("UPDATE subject_join_requests SET status='rejected' WHERE id=?").run(requestId);
  break;
 }
 default:throw new AppError('Acción no válida.');}
 return {ok:true};});}
