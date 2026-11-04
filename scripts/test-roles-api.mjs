import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base=process.env.AULA_TEST_URL??'http://127.0.0.1:3102';
let checks=0;
async function request(route,{cookie,method='GET',body,expected=200}={}){const headers={Origin:new URL(base).origin};if(cookie)headers.Cookie=cookie;if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const response=await fetch(base+route,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,`${method} ${route}: ${await (response.status!==expected?response.clone().text():Promise.resolve(''))}`);checks++;return response;}
const credentials={username:'docente.qa',password:'Aula-Docente-Prueba-2026'};
await request('/api/admin',{expected:401});
const setup=await request('/api/auth/setup',{method:'POST',body:{name:'Docente de prueba',...credentials}});const teacher=setup.headers.get('set-cookie').split(';')[0];
await request('/api/auth/setup',{method:'POST',body:{name:'Otro',username:'otro.qa',password:'Otro-Docente-2026'},expected:409});
await request('/api/admin',{cookie:teacher});await request('/',{cookie:teacher});
const mutate=async body=>(await request('/api/admin',{cookie:teacher,method:'POST',body})).json();
let data=await mutate({action:'institution',name:'Campus de pruebas',shortName:'QA',city:'Medellín',color:'blue'});const institution=data.institutions.find(i=>i.shortName==='QA');
data=await mutate({action:'subject',institutionId:institution.id,name:'Programación aplicada',code:'QA-PROG',description:'Ejercicios y conceptos para aprender haciendo.',icon:'code'});const subject=data.subjects.find(s=>s.code==='QA-PROG');
data=await mutate({action:'topic',subjectId:subject.id,name:'Primeros programas'});const topic=data.subjects.find(s=>s.id===subject.id).topics[0];
data=await mutate({action:'student',name:'Alumno de prueba',username:'alumno.qa',password:'Aula-Alumno-Prueba-2026',role:'teacher'});const student=data.users.find(u=>u.username==='alumno.qa');assert.equal(student.role,'student');
const login=await request('/api/auth/login',{method:'POST',body:{username:'alumno.qa',password:'Aula-Alumno-Prueba-2026',role:'teacher'}});const learner=login.headers.get('set-cookie').split(';')[0];
await request('/',{cookie:learner});let catalog=await (await request('/api/catalog',{cookie:learner})).json();assert.equal(catalog.subjects.length,0);
await request('/api/admin',{cookie:learner,expected:403});await request('/api/admin',{cookie:learner,method:'POST',body:{action:'institution',name:'No autorizado'},expected:403});await request('/api/admin/import',{cookie:learner,method:'POST',body:new FormData(),expected:403});
await mutate({action:'assign',userId:student.id,subjectIds:[subject.id]});
const source=String.raw`\documentclass{beamer}
\begin{document}
\section{Primeros programas}
\begin{frame}[fragile]{Tu primer programa}
Un programa es una secuencia de instrucciones.
\Idea{Escribe, ejecuta y observa el resultado.}
\begin{pythoncode}
print("Hola, Aula")
\end{pythoncode}
\end{frame}
\begin{frame}{Del problema a la solución}
\begin{tikzpicture}[node distance=2cm]
\node[draw] (a) {Idea};
\node[draw,right=of a] (b) {Programa};
\draw[->] (a) -- (b);
\end{tikzpicture}
\smartimage{ejemplo.png}
\end{frame}
\end{document}`;
const upload=new FormData();upload.set('subjectId',subject.id);upload.set('topicId',topic.id);upload.set('title','Introducción a la programación');upload.set('subtitle','Clase 1 · Primeros pasos');upload.set('source',new File([source],'clase.tex',{type:'text/plain'}));upload.set('pdf',new File([await readFile('content/materials/resources/web1-7.pdf')],'clase.pdf',{type:'application/pdf'}));upload.set('images',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')],'ejemplo.png',{type:'image/png'}));
const imported=await (await request('/api/admin/import',{cookie:teacher,method:'POST',body:upload})).json();assert.equal(imported.frames,2);assert.deepEqual(imported.diagnostics,[]);
const teacherCatalog=await (await request('/api/catalog',{cookie:teacher})).json();const lesson=teacherCatalog.lessons.find(l=>l.id===imported.id);assert.equal(lesson.status,'draft');
await request(lesson.pdf,{cookie:teacher});await request(lesson.pdf,{cookie:learner,expected:404});await request(lesson.pdf,{expected:401});
catalog=await (await request('/api/catalog',{cookie:learner})).json();assert.equal(catalog.lessons.length,0);
await request('/api/admin',{cookie:teacher,method:'POST',body:{action:'publish',lessonId:lesson.id},expected:400});
await mutate({action:'review',lessonId:lesson.id,acknowledged:true});await mutate({action:'publish',lessonId:lesson.id});
catalog=await (await request('/api/catalog',{cookie:learner})).json();assert.equal(catalog.lessons.length,1);assert.equal(catalog.subjects[0].id,subject.id);await request(lesson.pdf,{cookie:learner});await request(lesson.frames[1].blocks.find(b=>b.type==='diagram').asset,{cookie:learner});
await request('/api/progress',{cookie:learner,method:'POST',body:{lessonId:lesson.id,frameId:'frame-1',completed:true}});const progress=await (await request('/api/progress',{cookie:learner})).json();assert.deepEqual(progress[lesson.id],['frame-1']);
await request('/api/progress',{cookie:learner,method:'POST',body:{lessonId:'fundamentos-ros2',frameId:'frame-1',completed:true},expected:403});
await mutate({action:'assign',userId:student.id,subjectIds:[]});await request(lesson.pdf,{cookie:learner,expected:404});await mutate({action:'assign',userId:student.id,subjectIds:[subject.id]});
await request('/resources/web1-7.pdf',{expected:404});await request('/resources/flexbox.tex',{expected:404});
await request('/api/auth/logout',{cookie:teacher,method:'POST'});await request('/api/admin',{cookie:teacher,expected:401});
await writeFile('/tmp/aula-role-review-result.json',JSON.stringify({subjectId:subject.id,lessonId:lesson.id,checks},null,2));console.log(`${checks} verificaciones HTTP correctas: roles, importación real con TikZ, borradores, publicación, recursos privados, progreso y revocación.`);
