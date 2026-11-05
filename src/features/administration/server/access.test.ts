import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const folder=mkdtempSync(path.join(tmpdir(),'aula-access-'));process.env.AULA_DATA_DIR=folder;
const {db,readLesson}=await import('./database');const {setup,login,passwordMatches,sameOrigin,hasPermission,roles}=await import('../../auth/server/auth');const {getAuth}=await import('../../auth/server/better-auth');const {manage,snapshot}=await import('./manage');const {importLesson}=await import('./import-lesson');const {canReadLesson,canReadResource,studentLesson,userCatalog}=await import('../../learning/server/access');
let teacher:ReturnType<typeof setup>,student:ReturnType<typeof setup>;
test('crea una sola cuenta inicial y guarda contraseñas derivadas',()=>{teacher=setup({name:'Docente de prueba',username:'docente.test',password:'Prueba-privada-2026'});assert.equal(teacher.role,'admin');assert.throws(()=>setup({name:'Otro',username:'otro.test',password:'Prueba-privada-2026'}));const row=db().prepare('SELECT password FROM users WHERE id=?').get(teacher.id)!;assert.notEqual(row.password,'Prueba-privada-2026');assert.ok(passwordMatches('Prueba-privada-2026',row.password as string));});
test('valida credenciales y no permite elegir el rol al entrar',()=>{assert.throws(()=>login({username:'docente.test',password:'incorrecta'}));const user=login({username:'docente.test',password:'Prueba-privada-2026',role:'student'});assert.equal(user.role,'admin');});
test('alumno sin asignaciones recibe catálogo vacío',()=>{manage({action:'student',name:'Alumno de prueba',username:'alumno.test',password:'Prueba-alumno-2026'});student=login({username:'alumno.test',password:'Prueba-alumno-2026'});assert.equal(student.role,'student');assert.deepEqual(userCatalog(student),{institutions:[],subjects:[],lessons:[]});assert.equal(canReadLesson(student,'flexbox'),false);});
test('asignar una materia no expone las demás',()=>{manage({action:'assign',userId:student.id,subjectIds:['diseno-web-1']});const catalog=userCatalog(student);assert.deepEqual(catalog.subjects.map(s=>s.id),['diseno-web-1']);assert.deepEqual(catalog.lessons.map(l=>l.id),['flexbox']);assert.equal(canReadLesson(student,'fundamentos-ros2'),false);assert.equal(canReadLesson(student,'flexbox'),true);});
test('el profesor puede banear y desbanear a un alumno en una materia',()=>{
 manage({action:'banStudent',userId:student.id,subjectId:'diseno-web-1',reason:'Falta a las normas de clase'});
 assert.equal(canReadLesson(student,'flexbox'),false);
 assert.deepEqual(userCatalog(student),{institutions:[],subjects:[],lessons:[]});
 manage({action:'unbanStudent',userId:student.id,subjectId:'diseno-web-1'});
 assert.equal(canReadLesson(student,'flexbox'),true);
 assert.equal(userCatalog(student).lessons.length,1);
});
test('un borrador no aparece ni permite descargar materiales',()=>{manage({action:'unpublish',lessonId:'flexbox'});assert.equal(canReadLesson(student,'flexbox'),false);assert.equal(userCatalog(student).lessons.length,0);assert.equal(canReadLesson(teacher,'flexbox'),true);});
test('una versión nueva exige revisión antes de publicar',()=>{db().prepare('UPDATE lessons SET revision=2,reviewed=0 WHERE id=?').run('flexbox');assert.throws(()=>manage({action:'publish',lessonId:'flexbox'}));assert.throws(()=>manage({action:'review',lessonId:'flexbox',acknowledged:false}));manage({action:'review',lessonId:'flexbox',acknowledged:true});manage({action:'publish',lessonId:'flexbox'});assert.equal(canReadLesson(student,'flexbox'),true);});
test('revocar una materia retira el acceso inmediatamente',()=>{manage({action:'assign',userId:student.id,subjectIds:[]});assert.equal(canReadLesson(student,'flexbox'),false);assert.equal(userCatalog(student).subjects.length,0);});
test('no permite asignar materias inexistentes ni deja cambios parciales',()=>{assert.throws(()=>manage({action:'assign',userId:student.id,subjectIds:['diseno-web-1','materia-inexistente']}));assert.equal(userCatalog(student).subjects.length,0);});
test('acepta el Host público del servidor y rechaza solicitudes desde otro origen',()=>{assert.doesNotThrow(()=>sameOrigin(new Request('http://localhost:3102/api/auth/login',{headers:{host:'127.0.0.1:3102',origin:'http://127.0.0.1:3102'}})));assert.throws(()=>sameOrigin(new Request('http://localhost:3102/api/admin',{headers:{host:'127.0.0.1:3102',origin:'https://otro-sitio.example'}})));});
after(()=>{db().close();rmSync(folder,{recursive:true,force:true});});

test('el catálogo del alumno excluye fuentes TikZ también en bloques anidados',()=>{
 const original=userCatalog(teacher).lessons.find(l=>l.id==='flexbox')!;
 const lesson={...original,source:'/api/materials/flexbox/fuente',diagnostics:['CODIGO_PRIVADO'],frames:[{...original.frames[0],blocks:[{type:'callout' as const,content:'CODIGO_PRIVADO',children:[{type:'diagram' as const,content:'CODIGO_PRIVADO',asset:'/diagrama.svg'}]},{type:'list' as const,content:'',items:[[{type:'diagram' as const,content:'CODIGO_PRIVADO'}]]},{type:'code' as const,content:'print("ejemplo didáctico")'}]}]};
 const visible=studentLesson(lesson);assert.equal(visible.source,'');assert.deepEqual(visible.diagnostics,[]);assert.ok(!JSON.stringify(visible).includes('CODIGO_PRIVADO'));assert.equal(visible.frames[0].blocks[0].children?.[0].asset,'/diagrama.svg');assert.equal(visible.frames[0].blocks[2].content,'print("ejemplo didáctico")');assert.match(JSON.stringify(lesson),/CODIGO_PRIVADO/);
 manage({action:'assign',userId:student.id,subjectIds:['diseno-web-1']});assert.equal(userCatalog(student).lessons[0].source,'');assert.ok(userCatalog(teacher).lessons[0].source);
});
test('bloquea fuentes y descargas de materiales para el alumno',()=>{
 for(const resource of [{mime:'text/plain; charset=utf-8',name:'clase.tex'},{mime:'application/zip',name:'fuentes.zip'},{mime:'image/svg+xml',name:'fuente.tex'},{mime:'application/pdf',name:'clase.pdf'}])assert.equal(canReadResource(student,'flexbox',resource),false);
 assert.equal(canReadResource(student,'flexbox',{mime:'image/svg+xml',name:'diagrama.svg'}),true);
 assert.equal(canReadResource(student,'flexbox',{mime:'image/png',name:'logo.png'}),true);
 assert.equal(canReadResource(teacher,'flexbox',{mime:'application/pdf',name:'clase.pdf'}),true);
 assert.equal(canReadResource(teacher,'flexbox',{mime:'text/plain; charset=utf-8',name:'clase.tex'}),true);
});
test('reutiliza recursos en caché al actualizar una clase y solo cambia lo modificado',async()=>{
 const subject=userCatalog(teacher).subjects.find(s=>s.id==='diseno-web-1')!;
 const topicId=subject.topics[0].id;
 const png1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const png2=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
 const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
 const tex1='\\documentclass{beamer}\n\\begin{document}\n\\section{Uno}\n\\begin{frame}{A}\n\\smartimage{fija.png}\n\\smartimage{cambia.png}\n\\end{frame}\n\\end{document}';
 const form1=new FormData();
 form1.set('subjectId',subject.id);form1.set('topicId',topicId);form1.set('title','Clase Caché');form1.set('subtitle','v1');
 form1.set('source',new File([tex1],'clase.tex',{type:'text/plain'}));
 form1.set('pdf',new File([pdfBytes],'clase.pdf',{type:'application/pdf'}));
 form1.append('images',new File([png1],'fija.png',{type:'image/png'}));
 form1.append('images',new File([png1],'cambia.png',{type:'image/png'}));
 const first=await importLesson(form1);
 const lesson1=readLesson(first.id)!;
 const fixedUrl1=lesson1.frames[0].blocks[0].asset,changedUrl1=lesson1.frames[0].blocks[1].asset,pdfUrl1=lesson1.pdf;
 const tex2='\\documentclass{beamer}\n\\begin{document}\n\\section{Uno}\n\\begin{frame}{A actualizado}\n\\smartimage{fija.png}\n\\smartimage{cambia.png}\n\\end{frame}\n\\end{document}';
 const form2=new FormData();
 form2.set('lessonId',first.id);form2.set('subjectId',subject.id);form2.set('topicId',topicId);form2.set('title','Clase Caché');form2.set('subtitle','v2');
 form2.set('source',new File([tex2],'clase.tex',{type:'text/plain'}));
 form2.append('images',new File([png2],'cambia.png',{type:'image/png'}));
 await importLesson(form2);
 const lesson2=readLesson(first.id)!;
 assert.equal(lesson2.pdf,pdfUrl1);
 assert.equal(lesson2.frames[0].blocks[0].asset,fixedUrl1);
 assert.notEqual(lesson2.frames[0].blocks[1].asset,changedUrl1);
 assert.notEqual(lesson2.source,lesson1.source);
});
test('permite crear materias sin descripción e importar clases con formulario simplificado',async()=>{
 const instId=userCatalog(teacher).institutions[0].id;
 assert.doesNotThrow(()=>manage({action:'subject',institutionId:instId,name:'Materia Rápida',code:'MR-01',icon:'code',description:''}));
 const createdSubject=userCatalog(teacher).subjects.find(s=>s.code==='MR-01')!;
 assert.equal(createdSubject.description,'');
 assert.equal(createdSubject.topics.length,0);
 const tex='\\documentclass{beamer}\n\\begin{document}\n\\SectionSlide{Automatización Industrial}{Controladores y sensores}\n\\begin{frame}{Introducción}\nContenido\n\\end{frame}\n\\end{document}';
 const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
 const form=new FormData();
 form.set('subjectId',createdSubject.id);
 form.set('source',new File([tex],'automatizacion.tex',{type:'text/plain'}));
 form.append('images',new File([pdfBytes],'automatizacion.pdf',{type:'application/pdf'}));
 const imported=await importLesson(form);
 const lesson=readLesson(imported.id)!;
 assert.equal(lesson.title,'Automatización Industrial');
 assert.equal(lesson.subtitle,'Controladores y sensores');
 assert.equal(lesson.topicId,'general');
 assert.ok(lesson.pdf.startsWith(`/api/materials/${imported.id}/`));
 const updatedSubject=userCatalog(teacher).subjects.find(s=>s.id===createdSubject.id)!;
 assert.equal(updatedSubject.topics.length,1);
 assert.equal(updatedSubject.topics[0].id,'general');
});
test('valida permisos granulares y sincronización con Better Auth (ac, roles, user y account)',()=>{
 const auth=getAuth();
 assert.ok(auth.options.plugins?.length);
 const baTeacher=db().prepare('SELECT id,username,role,banned FROM user WHERE id=?').get(teacher.id) as {id:string;username:string;role:string;banned:number}|undefined;
 const baStudent=db().prepare('SELECT id,username,role,banned FROM user WHERE id=?').get(student.id) as {id:string;username:string;role:string;banned:number}|undefined;
 const baAccount=db().prepare("SELECT userId,providerId FROM account WHERE userId=? AND providerId='credential'").get(teacher.id) as {userId:string;providerId:string}|undefined;
 assert.equal(baTeacher?.role,'admin');
 assert.equal(baStudent?.role,'student');
 assert.equal(baAccount?.providerId,'credential');
 assert.equal(hasPermission(teacher,{campus:['manage','import','rebuild','publish','students','teachers','logo']}),true);
 assert.equal(hasPermission(teacher,{tools:['use','inspectSource'],lesson:['readDraft','downloadSource']}),true);
 assert.equal(hasPermission(student,{campus:['manage']}),false);
 assert.equal(hasPermission(student,{tools:['use']}),false);
 assert.equal(hasPermission(student,{lesson:['readDraft']}),false);
 assert.equal(hasPermission(student,{lesson:['downloadSource']}),false);
 assert.equal(hasPermission(student,{catalog:['readAssigned'],lesson:['readPublished'],progress:['read','write']}),true);
 assert.equal(hasPermission(student,{lesson:['downloadMaterial']}),false);
 assert.ok(roles.admin.authorize({campus:['manage']}).success);
 assert.ok(roles.teacher.authorize({campus:['manage']}).success);
 assert.equal(roles.student.authorize({campus:['manage']}).success,false);

 manage({action:'teacher',name:'Profesor Secundario',username:'profe2.test',password:'ClaveDocente-2026'},teacher);
 const profe2=login({username:'profe2.test',password:'ClaveDocente-2026'});
 assert.equal(profe2.role,'teacher');
 assert.equal(hasPermission(profe2,{campus:['teachers']}),false);
 assert.equal(hasPermission(profe2,{user:['resetPasswordStudent']}),true);
 assert.equal(hasPermission(teacher,{user:['createTeacher','resetPasswordTeacher']}),true);
});

test('garantiza el principio de minimo privilegio (docentes y alumnos solo ven su asignacion)',()=>{
 // 1. Admin crea institución SENA y materia en SENA
 manage({action:'institution',id:'inst-sena',name:'Servicio Nacional de Aprendizaje',shortName:'SENA',city:'Bogotá'},teacher);
 manage({action:'subject',institutionId:'inst-sena',name:'Programación SENA',code:'ADSO-101'},teacher);
 const senaSubjects=userCatalog(teacher).subjects.filter(s=>s.institutionId==='inst-sena');
 assert.equal(senaSubjects.length,1);
 const senaSubjId=senaSubjects[0].id;

 // 2. Admin crea docente de SENA asignado únicamente a SENA
 manage({action:'teacher',name:'Docente SENA',username:'docente.sena',password:'ClaveSena-2026',institutionId:'inst-sena',subjectIds:[senaSubjId]},teacher);
 const teacherSena=login({username:'docente.sena',password:'ClaveSena-2026'});
 assert.equal(teacherSena.role,'teacher');

 // 3. El docente de SENA solo ve SENA en el snapshot docente
 const senaSnap=snapshot(teacherSena);
 assert.deepEqual(senaSnap.institutions.map(i=>i.id),['inst-sena']);
 assert.deepEqual(senaSnap.subjects.map(s=>s.id),[senaSubjId]);

 // 4. El docente de SENA no puede tocar materias de otras instituciones
 assert.throws(()=>manage({action:'subject',institutionId:'politecnico',name:'Invasión'},teacherSena),/No tienes permiso/);
 assert.throws(()=>manage({action:'assign',userId:student.id,subjectIds:['diseno-web-1']},teacherSena),/No tienes permiso/);

 // 5. El docente de SENA matricula un alumno en su materia
 manage({action:'student',name:'Alumno SENA',username:'alumno.sena',password:'ClaveAlumno-2026',subjectIds:[senaSubjId]},teacherSena);
 const studentSena=login({username:'alumno.sena',password:'ClaveAlumno-2026'});
 assert.equal(studentSena.role,'student');

 // 6. El docente de SENA no puede restablecer la clave del alumno de otra institución
 assert.throws(()=>manage({action:'resetPassword',userId:student.id,password:'NuevaClave-123'},teacherSena),/No tienes permiso/);

 // 7. Pero sí puede restablecer la clave de su propio alumno
 assert.doesNotThrow(()=>manage({action:'resetPassword',userId:studentSena.id,password:'NuevaClave-123'},teacherSena));

 // 8. El alumno de SENA solo ve la materia de SENA y su catálogo no tiene otras instituciones
 const studentSenaCat=userCatalog(studentSena);
 assert.deepEqual(studentSenaCat.institutions.map(i=>i.id),['inst-sena']);
 assert.deepEqual(studentSenaCat.subjects.map(s=>s.id),[senaSubjId]);
});
