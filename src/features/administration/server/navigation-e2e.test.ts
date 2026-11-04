import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const folder=mkdtempSync(path.join(tmpdir(),'aula-tab-nav-'));
process.env.AULA_DATA_DIR=folder;

const {db}=await import('./database');
const {setup,login,currentUser,startSession,endSession,requirePermission}=await import('../../auth/server/auth');
const {manage,snapshot}=await import('./manage');
const {userCatalog,userProgress,canReadLesson}=await import('../../learning/server/access');

let teacher:any,student:any;

test('Pestañas: 1. Pestaña Instituciones (lectura, inserción y cambio)',()=>{
 teacher=setup({name:'Profesor Tabs',username:'profe.tabs',password:'ClaveDocente-2026'});
 assert.equal(teacher.role,'admin');

 const snap=snapshot();
 assert.ok(snap.institutions.length>0,'Carga instituciones iniciales');

 manage({
  action:'institution',
  name:'Instituto Tecnológico del Futuro',
  shortName:'ITF',
  city:'Bogotá',
  color:'green'
 },teacher);

 const snapUpdated=snapshot();
 const created=snapUpdated.institutions.find(i=>i.shortName==='ITF');
 assert.ok(created);
 assert.equal(created.city,'Bogotá');
});

test('Pestañas: 2. Pestaña Materias y Temas (jerarquía Institución -> Materia -> Temas)',()=>{
 const itf=snapshot().institutions.find(i=>i.shortName==='ITF')!;

 manage({
  action:'subject',
  institutionId:itf.id,
  name:'Sistemas Embebidos',
  code:'EMB-201',
  description:'Microcontroladores y RTOS',
  icon:'code'
 });

 const subject=snapshot().subjects.find(s=>s.code==='EMB-201')!;
 assert.ok(subject);
 assert.equal(subject.institutionId,itf.id);

 manage({
  action:'topic',
  subjectId:subject.id,
  name:'Arquitectura ARM Cortex-M'
 });
 manage({
  action:'topic',
  subjectId:subject.id,
  name:'Drivers y Periféricos'
 });

 const subjectWithTopics=snapshot().subjects.find(s=>s.id===subject.id)!;
 assert.equal(subjectWithTopics.topics.length,2);
 assert.equal(subjectWithTopics.topics[0].name,'Arquitectura ARM Cortex-M');
});

test('Pestañas: 3. Pestaña Materias (generación de links de inscripción a asignatura /join)',()=>{
 const snap=snapshot();
 const subject=snap.subjects[0];
 assert.ok(subject);

 manage({
  action:'getOrCreateInvite',
  subjectId:subject.id
 });

 const afterInvite=snapshot();
 const invite=afterInvite.invites?.find(i=>i.subjectId===subject.id);
 assert.ok(invite,'Enlace de inscripción disponible');
 assert.ok(invite.token.length>10);
});

test('Pestañas: 4. Pestaña Alumnos y Asignaciones (RBAC, inscripción a asignatura y moderación)',()=>{
 manage({
  action:'student',
  name:'Alumno Enrolado',
  username:'alumno.enrolado',
  password:'Password-2026'
 });
 student=login({username:'alumno.enrolado',password:'Password-2026'});
 assert.equal(student.role,'student');

 const snap=snapshot();
 const subject=snap.subjects[0];
 const lesson=snap.lessons.find(l=>l.subjectId===subject.id)!;
 const reqId='req-tab-test';
 db().prepare('INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES (?,?,?,?,?)').run(
  reqId,
  subject.id,
  student.id,
  'pending',
  new Date().toISOString()
 );

 assert.equal(canReadLesson(student,lesson.id),false,'Pendiente de aprobación');
 const snapPending=snapshot();
 const foundReq=snapPending.joinRequests?.find(r=>r.id===reqId);
 assert.ok(foundReq);

 manage({
  action:'approveJoinRequest',
  requestId:reqId
 });

 assert.equal(canReadLesson(student,lesson.id),true,'Inscrito y aprobado para la materia y sus clases');

 manage({
  action:'banStudent',
  userId:student.id,
  subjectId:subject.id,
  reason:'Sanción disciplinaria'
 });

 assert.equal(canReadLesson(student,lesson.id),false,'Bloqueado por baneo en materia');
 const catalog=userCatalog(student);
 assert.ok(!catalog.lessons.some(l=>l.id===lesson.id),'Oculto del catálogo interactivo');

 manage({
  action:'unbanStudent',
  userId:student.id,
  subjectId:subject.id
 });
 assert.equal(canReadLesson(student,lesson.id),true,'Acceso restaurado tras desbanear');
});

test('Pestañas: 5. Pestañas de Aprendizaje del Alumno (Catálogo, Progreso y Restricciones)',()=>{
 const catalog=userCatalog(student);
 assert.ok(catalog.subjects.length>0);
 assert.ok(catalog.lessons.length>0);

 for(const l of catalog.lessons){
  assert.equal(l.source,'','Fuente .tex oculta para el alumno');
  assert.equal(l.pdf,'','Descarga de PDF bloqueada para el alumno');
 }

 const targetLesson=catalog.lessons[0];
 const targetFrame=targetLesson.frames[0];
 assert.ok(targetFrame);

 db().prepare('INSERT INTO progress(user_id,lesson_id,frame_id) VALUES (?,?,?)').run(
  student.id,
  targetLesson.id,
  targetFrame.id
 );

 const progress=userProgress(student);
 assert.deepEqual(progress[targetLesson.id],[targetFrame.id]);
});

after(()=>{
 db().close();
 rmSync(folder,{recursive:true,force:true});
});
