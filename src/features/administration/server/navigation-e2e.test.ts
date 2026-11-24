import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const folder = mkdtempSync(path.join(tmpdir(), 'aula-tab-nav-'));
process.env.AULA_DATA_DIR = folder;

const { db } = await import('./database');
const { setup, login, currentUser, startSession, endSession, requirePermission, createUser } =
  await import('../../auth/server/auth');
const { manage, snapshot } = await import('./manage');
const { userCatalog, userProgress, canReadLesson } = await import('../../learning/server/access');

let teacher: any, student: any;

test('Pestañas: 1. Pestaña Instituciones (lectura, inserción y cambio)', () => {
  teacher = setup({ name: 'Profesor Tabs', username: 'profe.tabs', password: 'ClaveDocente-2026' });
  assert.equal(teacher.role, 'admin');

  const snap = snapshot();
  assert.ok(snap.institutions.length > 0, 'Carga instituciones iniciales');

  manage(
    {
      action: 'institution',
      name: 'Instituto Tecnológico del Futuro',
      shortName: 'ITF',
      city: 'Bogotá',
      color: 'green',
    },
    teacher
  );

  const snapUpdated = snapshot();
  const created = snapUpdated.institutions.find((i) => i.shortName === 'ITF');
  assert.ok(created);
  assert.equal(created.city, 'Bogotá');
});

test('Pestañas: 2. Pestaña Materias y Temas (jerarquía Institución -> Materia -> Temas)', () => {
  const itf = snapshot().institutions.find((i) => i.shortName === 'ITF')!;

  manage({
    action: 'subject',
    institutionId: itf.id,
    name: 'Sistemas Embebidos',
    code: 'EMB-201',
    description: 'Microcontroladores y RTOS',
    icon: 'code',
  });

  const subject = snapshot().subjects.find((s) => s.code === 'EMB-201')!;
  assert.ok(subject);
  assert.equal(subject.institutionId, itf.id);

  manage({
    action: 'topic',
    subjectId: subject.id,
    name: 'Arquitectura ARM Cortex-M',
  });
  manage({
    action: 'topic',
    subjectId: subject.id,
    name: 'Drivers y Periféricos',
  });

  const subjectWithTopics = snapshot().subjects.find((s) => s.id === subject.id)!;
  assert.equal(subjectWithTopics.topics.length, 2);
  assert.equal(subjectWithTopics.topics[0].name, 'Arquitectura ARM Cortex-M');
});

test('Pestañas: 3. Pestaña Materias (generación de links de inscripción a asignatura /join)', () => {
  const snap = snapshot();
  const subject = snap.subjects[0];
  assert.ok(subject);

  manage({
    action: 'getOrCreateInvite',
    subjectId: subject.id,
  });

  const afterInvite = snapshot();
  const invite = afterInvite.invites?.find((i) => i.subjectId === subject.id);
  assert.ok(invite, 'Enlace de inscripción disponible');
  assert.ok(invite.token.length > 10);
});

test('Pestañas: 4. Pestaña Alumnos y Asignaciones (RBAC, inscripción a asignatura y moderación)', () => {
  manage({
    action: 'student',
    name: 'Alumno Enrolado',
    username: 'alumno.enrolado',
    password: 'Password-2026',
  });
  student = login({ username: 'alumno.enrolado', password: 'Password-2026' });
  assert.equal(student.role, 'student');

  const snap = snapshot();
  const subject = snap.subjects[0];
  const lesson = snap.lessons.find((l) => l.subjectId === subject.id)!;
  const reqId = 'req-tab-test';
  db()
    .prepare(
      'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES (?,?,?,?,?)'
    )
    .run(reqId, subject.id, student.id, 'pending', new Date().toISOString());

  assert.equal(canReadLesson(student, lesson.id), false, 'Pendiente de aprobación');
  const snapPending = snapshot();
  const foundReq = snapPending.joinRequests?.find((r) => r.id === reqId);
  assert.ok(foundReq);

  manage({
    action: 'approveJoinRequest',
    requestId: reqId,
  });

  assert.equal(
    canReadLesson(student, lesson.id),
    true,
    'Inscrito y aprobado para la materia y sus clases'
  );

  manage({
    action: 'banStudent',
    userId: student.id,
    subjectId: subject.id,
    reason: 'Sanción disciplinaria',
  });

  assert.equal(canReadLesson(student, lesson.id), false, 'Bloqueado por baneo en materia');
  const catalog = userCatalog(student);
  assert.ok(!catalog.lessons.some((l) => l.id === lesson.id), 'Oculto del catálogo interactivo');

  manage({
    action: 'unbanStudent',
    userId: student.id,
    subjectId: subject.id,
  });
  assert.equal(canReadLesson(student, lesson.id), true, 'Acceso restaurado tras desbanear');
});

test('Pestañas: 5. Pestañas de Aprendizaje del Alumno (Catálogo, Progreso y Restricciones)', () => {
  const catalog = userCatalog(student);
  assert.ok(catalog.subjects.length > 0);
  assert.ok(catalog.lessons.length > 0);

  for (const l of catalog.lessons) {
    assert.equal(l.source, '', 'Fuente .tex oculta para el alumno');
    assert.equal(l.pdf, '', 'Descarga de PDF bloqueada para el alumno');
  }

  const targetLesson = catalog.lessons[0];
  const targetFrame = targetLesson.frames[0];
  assert.ok(targetFrame);

  db()
    .prepare('INSERT INTO progress(user_id,lesson_id,frame_id) VALUES (?,?,?)')
    .run(student.id, targetLesson.id, targetFrame.id);

  const progress = userProgress(student);
  assert.deepEqual(progress[targetLesson.id], [targetFrame.id]);
});

test('Acciones masivas: aprobación múltiple de solicitudes y asignación masiva de alumnos a materias', () => {
  // Crear alumnos adicionales para pruebas masivas
  manage({
    action: 'student',
    name: 'Alumno Masivo 1',
    username: 'alumno.masivo1',
    password: 'Password-2026',
  });
  manage({
    action: 'student',
    name: 'Alumno Masivo 2',
    username: 'alumno.masivo2',
    password: 'Password-2026',
  });
  const m1 = login({ username: 'alumno.masivo1', password: 'Password-2026' });
  const m2 = login({ username: 'alumno.masivo2', password: 'Password-2026' });

  const snap = snapshot();
  const sub = snap.subjects[0];
  const lesson = snap.lessons.find((l) => l.subjectId === sub.id)!;

  // Insertar solicitudes pendientes para ambos alumnos
  const req1 = 'req-bulk-1';
  const req2 = 'req-bulk-2';
  db()
    .prepare(
      'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES (?,?,?,?,?)'
    )
    .run(req1, sub.id, m1.id, 'pending', new Date().toISOString());
  db()
    .prepare(
      'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES (?,?,?,?,?)'
    )
    .run(req2, sub.id, m2.id, 'pending', new Date().toISOString());

  assert.equal(canReadLesson(m1, lesson.id), false);
  assert.equal(canReadLesson(m2, lesson.id), false);

  // Probar aprobación masiva de todas las solicitudes
  manage({
    action: 'approveAllJoinRequests',
  });

  assert.equal(canReadLesson(m1, lesson.id), true, 'Alumno 1 aprobado masivamente');
  assert.equal(canReadLesson(m2, lesson.id), true, 'Alumno 2 aprobado masivamente');

  // Probar asignación masiva directa de estudiantes a asignaturas
  manage({
    action: 'bulkAssignStudents',
    userIds: [m1.id, m2.id],
    subjectIds: [sub.id],
    mode: 'add',
  });

  const cat1 = userCatalog(m1);
  const cat2 = userCatalog(m2);
  assert.ok(
    cat1.subjects.some((s) => s.id === sub.id),
    'Materia presente en catálogo de Alumno 1'
  );
  assert.ok(
    cat2.subjects.some((s) => s.id === sub.id),
    'Materia presente en catálogo de Alumno 2'
  );
});

test('Organización de clases: reordenamiento (moveLesson) y publicación programada por fecha (publishAt)', () => {
  const snap = snapshot();
  const sub = snap.subjects[0];
  const topic = sub.topics[0];

  // Crear dos clases en el mismo tema para probar reordenamiento
  const lessonData1 = {
    id: 'lesson-order-1',
    title: 'Clase Alfa',
    subtitle: 'Primera clase',
    institutionId: sub.institutionId,
    subjectId: sub.id,
    topicId: topic.id,
    source: '',
    pdf: '',
    frames: [{ id: 'f1', title: 'F1', section: 'S', line: 1, blocks: [] }],
    diagnostics: [],
    status: 'published',
    order: 0,
  };
  const lessonData2 = {
    id: 'lesson-order-2',
    title: 'Clase Beta',
    subtitle: 'Segunda clase',
    institutionId: sub.institutionId,
    subjectId: sub.id,
    topicId: topic.id,
    source: '',
    pdf: '',
    frames: [{ id: 'f2', title: 'F2', section: 'S', line: 1, blocks: [] }],
    diagnostics: [],
    status: 'published',
    order: 1,
  };

  db()
    .prepare(
      'INSERT OR REPLACE INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,?,1,1,?)'
    )
    .run(lessonData1.id, sub.id, 'published', JSON.stringify(lessonData1));
  db()
    .prepare(
      'INSERT OR REPLACE INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,?,1,1,?)'
    )
    .run(lessonData2.id, sub.id, 'published', JSON.stringify(lessonData2));

  // Verificar orden inicial: Alfa (0) antes que Beta (1)
  let snapLessons = snapshot().lessons.filter((l) => l.topicId === topic.id);
  const idxAlfa = snapLessons.findIndex((l) => l.id === lessonData1.id);
  const idxBeta = snapLessons.findIndex((l) => l.id === lessonData2.id);
  assert.ok(idxAlfa < idxBeta, 'Clase Alfa aparece antes que Clase Beta');

  // Mover Clase Beta hacia arriba (moveLesson direction: 'up')
  manage({
    action: 'moveLesson',
    lessonId: lessonData2.id,
    direction: 'up',
  });

  snapLessons = snapshot().lessons.filter((l) => l.topicId === topic.id);
  const newIdxBeta = snapLessons.findIndex((l) => l.id === lessonData2.id);
  const newIdxAlfa = snapLessons.findIndex((l) => l.id === lessonData1.id);
  assert.ok(
    newIdxBeta < newIdxAlfa,
    'Clase Beta ahora aparece antes que Clase Alfa tras mover arriba'
  );

  // Probar publicación programada por fecha (publishAt futuro)
  const futureIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  manage({
    action: 'setLessonPublishDate',
    lessonId: lessonData1.id,
    publishAt: futureIso,
  });

  const studentUser = login({ username: 'alumno.enrolado', password: 'Password-2026' });
  const adminUser = teacher;

  // Docente/Admin puede leer la clase programada
  assert.equal(
    canReadLesson(adminUser, lessonData1.id),
    true,
    'Docente puede ver clase programada'
  );

  // Alumno NO puede leer el contenido de la clase futura (bloqueada)
  assert.equal(
    canReadLesson(studentUser, lessonData1.id),
    false,
    'Alumno no puede leer clase programada a futuro'
  );

  // En el catálogo del alumno aparece con frames vacíos (bloqueada)
  const studentCat = userCatalog(studentUser);
  const scheduledInCat = studentCat.lessons.find((l) => l.id === lessonData1.id);
  assert.ok(scheduledInCat, 'Clase programada aparece en el syllabus');
  assert.equal(
    scheduledInCat.frames.length,
    0,
    'Bloques vacíos para alumno mientras esté bloqueada'
  );

  // Probar fecha en el pasado (desbloqueada)
  const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
  manage({
    action: 'setLessonPublishDate',
    lessonId: lessonData1.id,
    publishAt: pastIso,
  });

  assert.equal(
    canReadLesson(studentUser, lessonData1.id),
    true,
    'Alumno puede leer clase tras llegar su fecha'
  );
});

test('Separación de alumnos por grupos (Temas como Grupos)', () => {
  const instId = snapshot().institutions[0].id;
  // 1. Crear materia con dos grupos (temas): Grupo A y Grupo B
  manage({
    action: 'subject',
    institutionId: instId,
    name: 'Matemáticas por Grupos',
    code: 'MAT-GRP',
    color: '#3b82f6',
  });
  const matGrupos = snapshot().subjects.find((s) => s.code === 'MAT-GRP')!;
  assert.ok(matGrupos);

  manage({
    action: 'topic',
    subjectId: matGrupos.id,
    name: 'Grupo A',
  });
  manage({
    action: 'topic',
    subjectId: matGrupos.id,
    name: 'Grupo B',
  });

  const matUpdated = snapshot().subjects.find((s) => s.id === matGrupos.id)!;
  const topicA = matUpdated.topics.find((t) => t.name === 'Grupo A')!;
  const topicB = matUpdated.topics.find((t) => t.name === 'Grupo B')!;
  assert.ok(topicA && topicB);

  // 2. Crear clases para cada grupo
  const lessonGroupA = {
    id: 'clase-grupo-a',
    title: 'Clase Álgebra Grupo A',
    subtitle: 'Tema 1',
    subjectId: matGrupos.id,
    topicId: topicA.id,
    status: 'published',
    revision: 1,
    reviewed: 1,
    frames: [{ id: 'f-1', title: 'Frame 1', body: 'Contenido Grupo A' }],
  };
  const lessonGroupB = {
    id: 'clase-grupo-b',
    title: 'Clase Álgebra Grupo B',
    subtitle: 'Tema 1',
    subjectId: matGrupos.id,
    topicId: topicB.id,
    status: 'published',
    revision: 1,
    reviewed: 1,
    frames: [{ id: 'f-2', title: 'Frame 2', body: 'Contenido Grupo B' }],
  };
  manage({ action: 'saveLesson', ...lessonGroupA, publish: true });
  manage({ action: 'saveLesson', ...lessonGroupB, publish: true });

  // 3. Crear alumno para Grupo A y alumno para Grupo B
  const studentA = createUser(
    {
      name: 'Estudiante Grupo A',
      username: 'alumno.grupo.a',
      password: 'Password-2026',
    },
    'student'
  );
  const studentB = createUser(
    {
      name: 'Estudiante Grupo B',
      username: 'alumno.grupo.b',
      password: 'Password-2026',
    },
    'student'
  );

  // 4. Inscribir ambos a la materia, pero restringir temas/grupos
  manage({ action: 'assign', userId: studentA.id, subjectIds: [matGrupos.id] });
  manage({ action: 'assign', userId: studentB.id, subjectIds: [matGrupos.id] });

  manage({
    action: 'setStudentTopics',
    userId: studentA.id,
    subjectId: matGrupos.id,
    topicIds: [topicA.id],
  });
  manage({
    action: 'setStudentTopics',
    userId: studentB.id,
    subjectId: matGrupos.id,
    topicIds: [topicB.id],
  });

  // 5. Verificar canReadLesson
  assert.equal(
    canReadLesson(studentA, lessonGroupA.id),
    true,
    'Alumno A puede leer clase de Grupo A'
  );
  assert.equal(
    canReadLesson(studentA, lessonGroupB.id),
    false,
    'Alumno A NO puede leer clase de Grupo B'
  );

  assert.equal(
    canReadLesson(studentB, lessonGroupA.id),
    false,
    'Alumno B NO puede leer clase de Grupo A'
  );
  assert.equal(
    canReadLesson(studentB, lessonGroupB.id),
    true,
    'Alumno B puede leer clase de Grupo B'
  );

  // 6. Verificar userCatalog (solo debe listar el tema y clases correspondientes a su grupo)
  const catA = userCatalog(studentA);
  const subA = catA.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subA, 'Alumno A ve la materia');
  assert.equal(subA.topics.length, 1, 'Alumno A solo ve 1 tema (Grupo A)');
  assert.equal(subA.topics[0].id, topicA.id);

  const lessonsCatA = catA.lessons.filter((l) => l.subjectId === matGrupos.id);
  assert.equal(lessonsCatA.length, 1, 'Alumno A solo ve 1 clase en el catálogo');
  assert.equal(lessonsCatA[0].id, 'clase-grupo-a');

  const catB = userCatalog(studentB);
  const subB = catB.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subB, 'Alumno B ve la materia');
  assert.equal(subB.topics.length, 1, 'Alumno B solo ve 1 tema (Grupo B)');
  assert.equal(subB.topics[0].id, topicB.id);

  // 7. Docente ve ambos grupos y clases
  const teacherCat = userCatalog(teacher);
  const subTeacher = teacherCat.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subTeacher);
  assert.equal(subTeacher.topics.length, 2, 'Docente ve ambos grupos (temas)');

  // 8. Enlace de invitación directo a grupo
  const inviteRes = manage({
    action: 'getOrCreateInvite',
    subjectId: matGrupos.id,
    topicId: topicB.id,
  }) as { ok: boolean; token?: string };
  assert.ok(inviteRes.token, 'Generó token para el grupo B');

  // Alumno C se registra e ingresa con solicitud de Grupo B
  const studentC = createUser(
    {
      name: 'Estudiante C',
      username: 'alumno.c',
      password: 'Password-2026',
    },
    'student'
  );
  db()
    .prepare(
      'INSERT INTO subject_join_requests(id, subject_id, user_id, topic_id, created_at) VALUES (?,?,?,?,?)'
    )
    .run('req-c', matGrupos.id, studentC.id, topicB.id, new Date().toISOString());

  // Aprobar solicitud
  manage({ action: 'approveJoinRequest', requestId: 'req-c' });

  // Verificar que el alumno C quedó asignado al topicB.id
  assert.equal(
    canReadLesson(studentC, lessonGroupB.id),
    true,
    'Alumno C inscrito vía solicitud aprobada ve Grupo B'
  );
  assert.equal(canReadLesson(studentC, lessonGroupA.id), false, 'Alumno C NO ve Grupo A');
});

after(() => {
  db().close();
  rmSync(folder, { recursive: true, force: true });
});
