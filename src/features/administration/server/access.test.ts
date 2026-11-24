import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './test-db';
import { query, queryOne, execute, readLesson } from './database';
import {
  setup,
  login,
  passwordMatches,
  sameOrigin,
  hasPermission,
  roles,
} from '../../auth/server/auth';
import { getAuth } from '../../auth/server/better-auth';
import { manage, snapshot } from './manage';
import { importLesson } from './import-lesson';
import {
  canReadLesson,
  canReadResource,
  studentLesson,
  userCatalog,
} from '../../learning/server/access';

const testDb = await createTestDatabase();

let teacher: Awaited<ReturnType<typeof setup>>;
let student: Awaited<ReturnType<typeof setup>>;

test('crea una sola cuenta inicial y guarda contraseñas derivadas', async () => {
  teacher = await setup({
    name: 'Docente de prueba',
    username: 'docente.test',
    password: 'Prueba-privada-2026',
  });
  assert.equal(teacher.role, 'admin');
  await assert.rejects(
    async () =>
      await setup({ name: 'Otro', username: 'otro.test', password: 'Prueba-privada-2026' })
  );
  const row = (await queryOne<{ password: string }>('SELECT password FROM users WHERE id=$1', [
    teacher.id,
  ]))!;
  assert.notEqual(row.password, 'Prueba-privada-2026');
  assert.ok(passwordMatches('Prueba-privada-2026', row.password));
});

test('valida credenciales y no permite elegir el rol al entrar', async () => {
  await assert.rejects(
    async () => await login({ username: 'docente.test', password: 'incorrecta' })
  );
  const user = await login({
    username: 'docente.test',
    password: 'Prueba-privada-2026',
    role: 'student',
  });
  assert.equal(user.role, 'admin');
});

test('alumno sin asignaciones recibe catálogo vacío', async () => {
  await manage({
    action: 'student',
    name: 'Alumno de prueba',
    username: 'alumno.test',
    password: 'Prueba-alumno-2026',
  });
  student = await login({ username: 'alumno.test', password: 'Prueba-alumno-2026' });
  assert.equal(student.role, 'student');
  assert.deepEqual(await userCatalog(student), { institutions: [], subjects: [], lessons: [] });
  assert.equal(await canReadLesson(student, 'flexbox'), false);
});

test('asignar una materia no expone las demás', async () => {
  await manage({ action: 'assign', userId: student.id, subjectIds: ['diseno-web-1'] });
  const catalog = await userCatalog(student);
  assert.deepEqual(
    catalog.subjects.map((s) => s.id),
    ['diseno-web-1']
  );
  assert.deepEqual(
    catalog.lessons.map((l) => l.id),
    ['flexbox']
  );
  assert.equal(await canReadLesson(student, 'fundamentos-ros2'), false);
  assert.equal(await canReadLesson(student, 'flexbox'), true);
});

test('el profesor puede banear y desbanear a un alumno en una materia', async () => {
  await manage({
    action: 'banStudent',
    userId: student.id,
    subjectId: 'diseno-web-1',
    reason: 'Falta a las normas de clase',
  });
  assert.equal(await canReadLesson(student, 'flexbox'), false);
  assert.deepEqual(await userCatalog(student), { institutions: [], subjects: [], lessons: [] });
  await manage({ action: 'unbanStudent', userId: student.id, subjectId: 'diseno-web-1' });
  assert.equal(await canReadLesson(student, 'flexbox'), true);
  assert.equal((await userCatalog(student)).lessons.length, 1);
});

test('un borrador no aparece ni permite descargar materiales', async () => {
  await manage({ action: 'unpublish', lessonId: 'flexbox' });
  assert.equal(await canReadLesson(student, 'flexbox'), false);
  assert.equal((await userCatalog(student)).lessons.length, 0);
  assert.equal(await canReadLesson(teacher, 'flexbox'), true);
});

test('una versión nueva exige revisión antes de publicar', async () => {
  await execute('UPDATE lessons SET revision=2,reviewed=0 WHERE id=$1', ['flexbox']);
  await assert.rejects(async () => await manage({ action: 'publish', lessonId: 'flexbox' }));
  await assert.rejects(
    async () => await manage({ action: 'review', lessonId: 'flexbox', acknowledged: false })
  );
  await manage({ action: 'review', lessonId: 'flexbox', acknowledged: true });
  await manage({ action: 'publish', lessonId: 'flexbox' });
  assert.equal(await canReadLesson(student, 'flexbox'), true);
});

test('revocar una materia retira el acceso inmediatamente', async () => {
  await manage({ action: 'assign', userId: student.id, subjectIds: [] });
  assert.equal(await canReadLesson(student, 'flexbox'), false);
  assert.equal((await userCatalog(student)).subjects.length, 0);
});

test('no permite asignar materias inexistentes ni deja cambios parciales', async () => {
  await assert.rejects(
    async () =>
      await manage({
        action: 'assign',
        userId: student.id,
        subjectIds: ['diseno-web-1', 'materia-inexistente'],
      })
  );
  assert.equal((await userCatalog(student)).subjects.length, 0);
});

test('acepta el Host público del servidor y rechaza solicitudes desde otro origen', () => {
  assert.doesNotThrow(() =>
    sameOrigin(
      new Request('http://localhost:3102/api/auth/login', {
        headers: { host: '127.0.0.1:3102', origin: 'http://127.0.0.1:3102' },
      })
    )
  );
  assert.throws(() =>
    sameOrigin(
      new Request('http://localhost:3102/api/admin', {
        headers: { host: '127.0.0.1:3102', origin: 'https://otro-sitio.example' },
      })
    )
  );
});

test('el catálogo del alumno excluye fuentes TikZ también en bloques anidados', async () => {
  const original = (await userCatalog(teacher)).lessons.find((l) => l.id === 'flexbox')!;
  const lesson = {
    ...original,
    source: '/api/materials/flexbox/fuente',
    diagnostics: ['CODIGO_PRIVADO'],
    frames: [
      {
        ...original.frames[0],
        blocks: [
          {
            type: 'callout' as const,
            content: 'CODIGO_PRIVADO',
            children: [
              { type: 'diagram' as const, content: 'CODIGO_PRIVADO', asset: '/diagrama.svg' },
            ],
          },
          {
            type: 'list' as const,
            content: '',
            items: [[{ type: 'diagram' as const, content: 'CODIGO_PRIVADO' }]],
          },
          { type: 'code' as const, content: 'print("ejemplo didáctico")' },
        ],
      },
    ],
  };
  const visible = studentLesson(lesson);
  assert.equal(visible.source, '');
  assert.deepEqual(visible.diagnostics, []);
  assert.ok(!JSON.stringify(visible).includes('CODIGO_PRIVADO'));
  assert.equal(visible.frames[0].blocks[0].children?.[0].asset, '/diagrama.svg');
  assert.equal(visible.frames[0].blocks[2].content, 'print("ejemplo didáctico")');
  assert.match(JSON.stringify(lesson), /CODIGO_PRIVADO/);
  await manage({ action: 'assign', userId: student.id, subjectIds: ['diseno-web-1'] });
  assert.equal((await userCatalog(student)).lessons[0].source, '');
  assert.ok((await userCatalog(teacher)).lessons[0].source);
});

test('bloquea fuentes y descargas de materiales para el alumno', async () => {
  for (const resource of [
    { mime: 'text/plain; charset=utf-8', name: 'clase.tex' },
    { mime: 'application/zip', name: 'fuentes.zip' },
    { mime: 'image/svg+xml', name: 'fuente.tex' },
    { mime: 'application/pdf', name: 'clase.pdf' },
  ])
    assert.equal(await canReadResource(student, 'flexbox', resource), false);
  assert.equal(
    await canReadResource(student, 'flexbox', { mime: 'image/svg+xml', name: 'diagrama.svg' }),
    true
  );
  assert.equal(
    await canReadResource(student, 'flexbox', { mime: 'image/png', name: 'logo.png' }),
    true
  );
  assert.equal(
    await canReadResource(teacher, 'flexbox', { mime: 'application/pdf', name: 'clase.pdf' }),
    true
  );
  assert.equal(
    await canReadResource(teacher, 'flexbox', {
      mime: 'text/plain; charset=utf-8',
      name: 'clase.tex',
    }),
    true
  );
});

test('reutiliza recursos en caché al actualizar una clase y solo cambia lo modificado', async () => {
  const subject = (await userCatalog(teacher)).subjects.find((s) => s.id === 'diseno-web-1')!;
  const topicId = subject.topics[0].id;
  const png1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const png2 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64'
  );
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const tex1 =
    '\\documentclass{beamer}\n\\begin{document}\n\\section{Uno}\n\\begin{frame}{A}\n\\smartimage{fija.png}\n\\smartimage{cambia.png}\n\\end{frame}\n\\end{document}';
  const form1 = new FormData();
  form1.set('subjectId', subject.id);
  form1.set('topicId', topicId);
  form1.set('title', 'Clase Caché');
  form1.set('subtitle', 'v1');
  form1.set('source', new File([tex1], 'clase.tex', { type: 'text/plain' }));
  form1.set('pdf', new File([pdfBytes], 'clase.pdf', { type: 'application/pdf' }));
  form1.append('images', new File([png1], 'fija.png', { type: 'image/png' }));
  form1.append('images', new File([png1], 'cambia.png', { type: 'image/png' }));
  const first = await importLesson(form1);
  const lesson1 = (await readLesson(first.id))!;
  const fixedUrl1 = lesson1.frames[0].blocks[0].asset,
    changedUrl1 = lesson1.frames[0].blocks[1].asset,
    pdfUrl1 = lesson1.pdf;
  const tex2 =
    '\\documentclass{beamer}\n\\begin{document}\n\\section{Uno}\n\\begin{frame}{A actualizado}\n\\smartimage{fija.png}\n\\smartimage{cambia.png}\n\\end{frame}\n\\end{document}';
  const form2 = new FormData();
  form2.set('lessonId', first.id);
  form2.set('subjectId', subject.id);
  form2.set('topicId', topicId);
  form2.set('title', 'Clase Caché');
  form2.set('subtitle', 'v2');
  form2.set('source', new File([tex2], 'clase.tex', { type: 'text/plain' }));
  form2.append('images', new File([png2], 'cambia.png', { type: 'image/png' }));
  await importLesson(form2);
  const lesson2 = (await readLesson(first.id))!;
  assert.equal(lesson2.pdf, pdfUrl1);
  assert.equal(lesson2.frames[0].blocks[0].asset, fixedUrl1);
  assert.notEqual(lesson2.frames[0].blocks[1].asset, changedUrl1);
  assert.notEqual(lesson2.source, lesson1.source);
});

test('permite crear materias sin descripción e importar clases con formulario simplificado', async () => {
  const instId = (await userCatalog(teacher)).institutions[0].id;
  await manage({
    action: 'subject',
    institutionId: instId,
    name: 'Materia Rápida',
    code: 'MR-01',
    icon: 'code',
    description: '',
  });
  const createdSubject = (await userCatalog(teacher)).subjects.find((s) => s.code === 'MR-01')!;
  assert.equal(createdSubject.description, '');
  assert.equal(createdSubject.topics.length, 0);
  const tex =
    '\\documentclass{beamer}\n\\begin{document}\n\\SectionSlide{Automatización Industrial}{Controladores y sensores}\n\\begin{frame}{Introducción}\nContenido\n\\end{frame}\n\\end{document}';
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const form = new FormData();
  form.set('subjectId', createdSubject.id);
  form.set('source', new File([tex], 'automatizacion.tex', { type: 'text/plain' }));
  form.append('images', new File([pdfBytes], 'automatizacion.pdf', { type: 'application/pdf' }));
  const imported = await importLesson(form);
  const lesson = (await readLesson(imported.id))!;
  assert.equal(lesson.title, 'Automatización Industrial');
  assert.equal(lesson.subtitle, 'Controladores y sensores');
  assert.equal(lesson.topicId, 'general');
  assert.ok(lesson.pdf.startsWith(`/api/materials/${imported.id}/`));
  const updatedSubject = (await userCatalog(teacher)).subjects.find(
    (s) => s.id === createdSubject.id
  )!;
  assert.equal(updatedSubject.topics.length, 1);
  assert.equal(updatedSubject.topics[0].id, 'general');
});

test('valida permisos granulares y sincronización con Better Auth (ac, roles, user y account)', async () => {
  const auth = getAuth();
  assert.ok(auth.options.plugins?.length);
  const baTeacher = await queryOne<{ id: string; username: string; role: string; banned: boolean }>(
    'SELECT id,username,role,banned FROM "user" WHERE id=$1',
    [teacher.id]
  );
  const baStudent = await queryOne<{ id: string; username: string; role: string; banned: boolean }>(
    'SELECT id,username,role,banned FROM "user" WHERE id=$1',
    [student.id]
  );
  const baAccount = await queryOne<{ userId: string; providerId: string }>(
    'SELECT "userId","providerId" FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
    [teacher.id]
  );
  assert.equal(baTeacher?.role, 'admin');
  assert.equal(baStudent?.role, 'student');
  assert.equal(baAccount?.providerId, 'credential');
  assert.equal(
    hasPermission(teacher, {
      campus: ['manage', 'import', 'rebuild', 'publish', 'students', 'teachers', 'logo'],
    }),
    true
  );
  assert.equal(
    hasPermission(teacher, {
      tools: ['use', 'inspectSource'],
      lesson: ['readDraft', 'downloadSource'],
    }),
    true
  );
  assert.equal(hasPermission(student, { campus: ['manage'] }), false);
  assert.equal(hasPermission(student, { tools: ['use'] }), false);
  assert.equal(hasPermission(student, { lesson: ['readDraft'] }), false);
  assert.equal(hasPermission(student, { lesson: ['downloadSource'] }), false);
  assert.equal(
    hasPermission(student, {
      catalog: ['readAssigned'],
      lesson: ['readPublished'],
      progress: ['read', 'write'],
    }),
    true
  );
  assert.equal(hasPermission(student, { lesson: ['downloadMaterial'] }), false);
  assert.ok(roles.admin.authorize({ campus: ['manage'] }).success);
  assert.ok(roles.teacher.authorize({ campus: ['manage'] }).success);
  assert.equal(roles.student.authorize({ campus: ['manage'] }).success, false);

  await manage(
    {
      action: 'teacher',
      name: 'Profesor Secundario',
      username: 'profe2.test',
      password: 'ClaveDocente-2026',
    },
    teacher
  );
  const profe2 = await login({ username: 'profe2.test', password: 'ClaveDocente-2026' });
  assert.equal(profe2.role, 'teacher');
  assert.equal(hasPermission(profe2, { campus: ['teachers'] }), false);
  assert.equal(hasPermission(profe2, { user: ['resetPasswordStudent'] }), true);
  assert.equal(hasPermission(teacher, { user: ['createTeacher', 'resetPasswordTeacher'] }), true);
});

test('garantiza el principio de minimo privilegio (docentes y alumnos solo ven su asignacion)', async () => {
  // 1. Admin crea institución SENA y materia en SENA
  await manage(
    {
      action: 'institution',
      id: 'inst-sena',
      name: 'Servicio Nacional de Aprendizaje',
      shortName: 'SENA',
      city: 'Bogotá',
    },
    teacher
  );
  await manage(
    { action: 'subject', institutionId: 'inst-sena', name: 'Programación SENA', code: 'ADSO-101' },
    teacher
  );
  const senaSubjects = (await userCatalog(teacher)).subjects.filter(
    (s) => s.institutionId === 'inst-sena'
  );
  assert.equal(senaSubjects.length, 1);
  const senaSubjId = senaSubjects[0].id;

  // 2. Admin crea docente de SENA asignado únicamente a SENA
  await manage(
    {
      action: 'teacher',
      name: 'Docente SENA',
      username: 'docente.sena',
      password: 'ClaveSena-2026',
      institutionId: 'inst-sena',
      subjectIds: [senaSubjId],
    },
    teacher
  );
  const teacherSena = await login({ username: 'docente.sena', password: 'ClaveSena-2026' });
  assert.equal(teacherSena.role, 'teacher');

  // 3. El docente de SENA solo ve SENA en el snapshot docente
  const senaSnap = await snapshot(teacherSena);
  assert.deepEqual(
    senaSnap.institutions.map((i) => i.id),
    ['inst-sena']
  );
  assert.deepEqual(
    senaSnap.subjects.map((s) => s.id),
    [senaSubjId]
  );

  // 4. El docente de SENA no puede tocar materias de otras instituciones
  await assert.rejects(
    async () =>
      await manage(
        { action: 'subject', institutionId: 'politecnico', name: 'Invasión' },
        teacherSena
      ),
    /No tienes permiso/
  );
  await assert.rejects(
    async () =>
      await manage(
        { action: 'assign', userId: student.id, subjectIds: ['diseno-web-1'] },
        teacherSena
      ),
    /No tienes permiso/
  );

  // 5. El docente de SENA matricula un alumno en su materia
  await manage(
    {
      action: 'student',
      name: 'Alumno SENA',
      username: 'alumno.sena',
      password: 'ClaveAlumno-2026',
      subjectIds: [senaSubjId],
    },
    teacherSena
  );
  const studentSena = await login({ username: 'alumno.sena', password: 'ClaveAlumno-2026' });
  assert.equal(studentSena.role, 'student');

  // 6. El docente de SENA no puede restablecer la clave del alumno de otra institución
  await assert.rejects(
    async () =>
      await manage(
        { action: 'resetPassword', userId: student.id, password: 'NuevaClave-123' },
        teacherSena
      ),
    /No tienes permiso/
  );

  // 7. Pero sí puede restablecer la clave de su propio alumno
  await manage(
    { action: 'resetPassword', userId: studentSena.id, password: 'NuevaClave-123' },
    teacherSena
  );

  // 8. El alumno de SENA solo ve la materia de SENA y su catálogo no tiene otras instituciones
  const studentSenaCat = await userCatalog(studentSena);
  assert.deepEqual(
    studentSenaCat.institutions.map((i) => i.id),
    ['inst-sena']
  );
  assert.deepEqual(
    studentSenaCat.subjects.map((s) => s.id),
    [senaSubjId]
  );
});

test('permite eliminar clases con limpieza en cascada respetando permisos', async () => {
  const createdSubj = (await userCatalog(teacher)).subjects[0];
  const lessonId = 'clase-test-eliminar';
  const lData = {
    id: lessonId,
    subjectId: createdSubj.id,
    topicId: 't1',
    title: 'Clase a borrar',
    subtitle: '',
    frames: [],
  };
  await execute(
    'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,$3,1,1,$4)',
    [lessonId, createdSubj.id, 'published', JSON.stringify(lData)]
  );
  await execute('INSERT INTO progress(user_id,lesson_id,frame_id) VALUES ($1,$2,$3)', [
    student.id,
    lessonId,
    'f1',
  ]);
  await execute('INSERT INTO resources(lesson_id,key,name,path,mime) VALUES ($1,$2,$3,$4,$5)', [
    lessonId,
    'k1',
    'res.png',
    '/dummy/res.png',
    'image/png',
  ]);

  const teacherSena = await login({ username: 'docente.sena', password: 'ClaveSena-2026' });
  await assert.rejects(
    async () => await manage({ action: 'deleteLesson', lessonId }, teacherSena),
    /No tienes permiso/
  );

  await manage({ action: 'deleteLesson', lessonId }, teacher);
  assert.equal(await readLesson(lessonId), null);
  assert.equal(await queryOne('SELECT 1 FROM progress WHERE lesson_id=$1', [lessonId]), null);
  assert.equal(await queryOne('SELECT 1 FROM resources WHERE lesson_id=$1', [lessonId]), null);
});

test('permite eliminar temas con limpieza en cascada respetando permisos', async () => {
  const teacherSena = await login({ username: 'docente.sena', password: 'ClaveSena-2026' });
  const inst = (await queryOne<{ institution_id: string }>(
    'SELECT institution_id FROM institution_members WHERE user_id=$1 LIMIT 1',
    [teacherSena.id]
  ))!.institution_id;

  await manage(
    { action: 'subject', institutionId: inst, name: 'Materia Pruebas Temas', code: 'PRUTOP1' },
    teacherSena
  );
  const allSubs = await query<{ id: string; data: any }>('SELECT id, data FROM subjects');
  const sub = allSubs.find(
    (s) => (typeof s.data === 'string' ? JSON.parse(s.data) : s.data).code === 'PRUTOP1'
  )!;
  const subId = sub.id;

  await manage({ action: 'topic', subjectId: subId, name: 'Tema Para Borrar' }, teacherSena);
  const updatedSubRow = (await queryOne<{ data: any }>('SELECT data FROM subjects WHERE id=$1', [
    subId,
  ]))!;
  const updatedSub =
    typeof updatedSubRow.data === 'string' ? JSON.parse(updatedSubRow.data) : updatedSubRow.data;
  const topicId = updatedSub.topics[0].id;

  // Insertar una clase bajo ese tema
  const lessonId = 'clase-tema-eliminar';
  await execute(
    'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,$3,1,1,$4)',
    [
      lessonId,
      subId,
      'published',
      JSON.stringify({
        id: lessonId,
        subjectId: subId,
        topicId,
        title: 'Clase de prueba tema',
        frames: [{ id: 'f1', title: 'F1', blocks: [] }],
      }),
    ]
  );

  // Otro docente que no imparte esta materia no puede borrar el tema
  const otherTeacher = { ...teacherSena, id: 'otro-profe-id' };
  await assert.rejects(
    async () => await manage({ action: 'deleteTopic', subjectId: subId, topicId }, otherTeacher),
    /No tienes permiso/
  );

  // El docente a cargo sí puede borrar el tema
  await manage({ action: 'deleteTopic', subjectId: subId, topicId }, teacherSena);
  const subAfterRow = (await queryOne<{ data: any }>('SELECT data FROM subjects WHERE id=$1', [
    subId,
  ]))!;
  const subAfter =
    typeof subAfterRow.data === 'string' ? JSON.parse(subAfterRow.data) : subAfterRow.data;
  assert.equal(subAfter.topics.length, 0);
  assert.equal(await readLesson(lessonId), null);
});

test('permite eliminar materias solo a administradores con limpieza completa', async () => {
  const teacherSena = await login({ username: 'docente.sena', password: 'ClaveSena-2026' });
  const inst = (await queryOne<{ id: string }>('SELECT id FROM institutions LIMIT 1'))!.id;

  await manage(
    { action: 'subject', institutionId: inst, name: 'Materia a Borrar Admin', code: 'DELADM1' },
    teacher
  );
  const allSubs = await query<{ id: string; data: any }>('SELECT id, data FROM subjects');
  const sub = allSubs.find(
    (s) => (typeof s.data === 'string' ? JSON.parse(s.data) : s.data).code === 'DELADM1'
  )!;
  const subId = sub.id;

  // Docente intenta borrar materia -> prohibido
  await assert.rejects(
    async () => await manage({ action: 'deleteSubject', subjectId: subId }, teacherSena),
    /Solo los administradores pueden eliminar materias/
  );

  // Admin (teacher tiene rol admin) sí puede borrar la materia
  await manage({ action: 'deleteSubject', subjectId: subId }, teacher);
  assert.equal(await queryOne('SELECT 1 FROM subjects WHERE id=$1', [subId]), null);
});

test('permite a administradores asignar nuevas materias a docentes existentes', async () => {
  const teacherSena = await login({ username: 'docente.sena', password: 'ClaveSena-2026' });
  const inst = (await queryOne<{ id: string }>('SELECT id FROM institutions LIMIT 1'))!.id;

  await manage(
    { action: 'subject', institutionId: inst, name: 'Nueva Materia Docente', code: 'NEWDOC1' },
    teacher
  );
  const allSubs = await query<{ id: string; data: any }>('SELECT id, data FROM subjects');
  const newSub = allSubs.find(
    (s) => (typeof s.data === 'string' ? JSON.parse(s.data) : s.data).code === 'NEWDOC1'
  )!;

  // Docente intenta auto-asignarse materias -> prohibido
  await assert.rejects(
    async () =>
      await manage(
        { action: 'assignTeacher', teacherId: teacherSena.id, subjectIds: [newSub.id] },
        teacherSena
      ),
    /Solo los administradores pueden asignar materias a un docente/
  );

  // Admin le asigna la nueva materia al docente existente
  await manage(
    { action: 'assignTeacher', teacherId: teacherSena.id, subjectIds: [newSub.id] },
    teacher
  );

  const enrollments = await query<{ subject_id: string }>(
    'SELECT subject_id FROM enrollments WHERE user_id=$1',
    [teacherSena.id]
  );
  assert.ok(enrollments.some((e) => e.subject_id === newSub.id));
});

test('permite eliminar alumnos individuales y seleccionados con limpieza en cascada', async () => {
  const adminActor = {
    id: 'admin-del',
    name: 'Admin',
    username: 'admin.del',
    role: 'admin' as const,
  };
  const s1Id = 'student-del-1';
  const s2Id = 'student-del-2';
  const sampleSubj = (await userCatalog(teacher)).subjects[0];

  await execute(
    'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5)',
    [adminActor.id, adminActor.name, adminActor.username, 'hash', adminActor.role]
  );
  await execute(
    'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5)',
    [s1Id, 'Alumno 1', 'alumno1@test.com', 'hash', 'student']
  );
  await execute(
    'INSERT INTO users(id, name, username, password, role) VALUES ($1, $2, $3, $4, $5)',
    [s2Id, 'Alumno 2', 'alumno2@test.com', 'hash', 'student']
  );
  await execute('INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2)', [
    s1Id,
    sampleSubj.id,
  ]);
  await execute('INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2)', [
    s2Id,
    sampleSubj.id,
  ]);

  // Eliminar un alumno individual
  await manage({ action: 'deleteStudent', userId: s1Id }, adminActor);
  const check1 = await queryOne('SELECT id FROM users WHERE id=$1', [s1Id]);
  assert.equal(check1, null);
  const checkEnr1 = await queryOne('SELECT * FROM enrollments WHERE user_id=$1', [s1Id]);
  assert.equal(checkEnr1, null);

  // Eliminar alumnos en lote
  await manage({ action: 'deleteStudents', userIds: [s2Id] }, adminActor);
  const check2 = await queryOne('SELECT id FROM users WHERE id=$1', [s2Id]);
  assert.equal(check2, null);

  // No permite eliminar administradores
  await assert.rejects(
    async () => await manage({ action: 'deleteStudent', userId: adminActor.id }, adminActor),
    /No se puede eliminar a un administrador/
  );
});

after(async () => {
  await testDb.adapter.close();
});
