import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './test-db';
import { execute } from './database';
import { setup, login, createUser } from '../../auth/server/auth';
import { manage, snapshot } from './manage';
import { userCatalog, userProgress, canReadLesson } from '../../learning/server/access';

const testDb = await createTestDatabase();

let teacher: any, student: any;

test('Pestañas: 1. Pestaña Instituciones (lectura, inserción y cambio)', async () => {
  teacher = await setup({
    name: 'Profesor Tabs',
    username: 'profe.tabs',
    password: 'ClaveDocente-2026',
  });
  assert.equal(teacher.role, 'admin');

  const snap = await snapshot();
  assert.ok(snap.institutions.length > 0, 'Carga instituciones iniciales');

  await manage(
    {
      action: 'institution',
      name: 'Instituto Tecnológico del Futuro',
      shortName: 'ITF',
      city: 'Bogotá',
      color: 'green',
    },
    teacher
  );

  const snapUpdated = await snapshot();
  const created = snapUpdated.institutions.find((i) => i.shortName === 'ITF');
  assert.ok(created);
  assert.equal(created.city, 'Bogotá');
});

test('Pestañas: 2. Pestaña Materias y Temas (jerarquía Institución -> Materia -> Temas)', async () => {
  const itf = (await snapshot()).institutions.find((i) => i.shortName === 'ITF')!;

  await manage({
    action: 'subject',
    institutionId: itf.id,
    name: 'Sistemas Embebidos',
    code: 'EMB-201',
    description: 'Microcontroladores y RTOS',
    icon: 'code',
  });

  const subject = (await snapshot()).subjects.find((s) => s.code === 'EMB-201')!;
  assert.ok(subject);
  assert.equal(subject.institutionId, itf.id);

  await manage({
    action: 'topic',
    subjectId: subject.id,
    name: 'Arquitectura ARM Cortex-M',
  });
  await manage({
    action: 'topic',
    subjectId: subject.id,
    name: 'Drivers y Periféricos',
  });

  const subjectWithTopics = (await snapshot()).subjects.find((s) => s.id === subject.id)!;
  assert.equal(subjectWithTopics.topics.length, 2);
  assert.equal(subjectWithTopics.topics[0].name, 'Arquitectura ARM Cortex-M');
});

test('Pestañas: 3. Pestaña Materias (generación de links de inscripción a asignatura /join)', async () => {
  const snap = await snapshot();
  const subject = snap.subjects[0];
  assert.ok(subject);

  await manage({
    action: 'getOrCreateInvite',
    subjectId: subject.id,
  });

  const afterInvite = await snapshot();
  const invite = afterInvite.invites?.find((i) => i.subjectId === subject.id);
  assert.ok(invite, 'Enlace de inscripción disponible');
  assert.ok(invite.token.length > 10);
});

test('Pestañas: 4. Pestaña Alumnos y Asignaciones (RBAC, inscripción a asignatura y moderación)', async () => {
  await manage({
    action: 'student',
    name: 'Alumno Enrolado',
    username: 'alumno.enrolado',
    password: 'Password-2026',
  });
  student = await login({ username: 'alumno.enrolado', password: 'Password-2026' });
  assert.equal(student.role, 'student');

  const snap = await snapshot();
  const subject = snap.subjects[0];
  const lesson = snap.lessons.find((l) => l.subjectId === subject.id)!;
  const reqId = 'req-tab-test';
  await execute(
    'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES ($1,$2,$3,$4,$5)',
    [reqId, subject.id, student.id, 'pending', new Date().toISOString()]
  );

  assert.equal(await canReadLesson(student, lesson.id), false, 'Pendiente de aprobación');
  const snapPending = await snapshot();
  const foundReq = snapPending.joinRequests?.find((r) => r.id === reqId);
  assert.ok(foundReq);

  await manage({
    action: 'approveJoinRequest',
    requestId: reqId,
  });

  assert.equal(
    await canReadLesson(student, lesson.id),
    true,
    'Inscrito y aprobado para la materia y sus clases'
  );

  await manage({
    action: 'banStudent',
    userId: student.id,
    subjectId: subject.id,
    reason: 'Sanción disciplinaria',
  });

  assert.equal(await canReadLesson(student, lesson.id), false, 'Bloqueado por baneo en materia');
  const catalog = await userCatalog(student);
  assert.ok(!catalog.lessons.some((l) => l.id === lesson.id), 'Oculto del catálogo interactivo');

  await manage({
    action: 'unbanStudent',
    userId: student.id,
    subjectId: subject.id,
  });
  assert.equal(await canReadLesson(student, lesson.id), true, 'Acceso restaurado tras desbanear');
});

test('Pestañas: 5. Pestañas de Aprendizaje del Alumno (Catálogo, Progreso y Restricciones)', async () => {
  const catalog = await userCatalog(student);
  assert.ok(catalog.subjects.length > 0);
  assert.ok(catalog.lessons.length > 0);

  for (const l of catalog.lessons) {
    assert.equal(l.source, '', 'Fuente .tex oculta para el alumno');
    assert.equal(l.pdf, '', 'Descarga de PDF bloqueada para el alumno');
  }

  const targetLesson = catalog.lessons[0];
  const targetFrame = targetLesson.frames[0];
  assert.ok(targetFrame);

  await execute('INSERT INTO progress(user_id,lesson_id,frame_id) VALUES ($1,$2,$3)', [
    student.id,
    targetLesson.id,
    targetFrame.id,
  ]);

  const progress = await userProgress(student);
  assert.deepEqual(progress[targetLesson.id], [targetFrame.id]);
});

test('Acciones masivas: aprobación múltiple de solicitudes y asignación masiva de alumnos a materias', async () => {
  // Crear alumnos adicionales para pruebas masivas
  await manage({
    action: 'student',
    name: 'Alumno Masivo 1',
    username: 'alumno.masivo1',
    password: 'Password-2026',
  });
  await manage({
    action: 'student',
    name: 'Alumno Masivo 2',
    username: 'alumno.masivo2',
    password: 'Password-2026',
  });
  const m1 = await login({ username: 'alumno.masivo1', password: 'Password-2026' });
  const m2 = await login({ username: 'alumno.masivo2', password: 'Password-2026' });

  const snap = await snapshot();
  const sub = snap.subjects[0];
  const lesson = snap.lessons.find((l) => l.subjectId === sub.id)!;

  // Insertar solicitudes pendientes para ambos alumnos
  const req1 = 'req-bulk-1';
  const req2 = 'req-bulk-2';
  await execute(
    'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES ($1,$2,$3,$4,$5)',
    [req1, sub.id, m1.id, 'pending', new Date().toISOString()]
  );
  await execute(
    'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES ($1,$2,$3,$4,$5)',
    [req2, sub.id, m2.id, 'pending', new Date().toISOString()]
  );

  assert.equal(await canReadLesson(m1, lesson.id), false);
  assert.equal(await canReadLesson(m2, lesson.id), false);

  // Probar aprobación masiva de todas las solicitudes
  await manage({
    action: 'approveAllJoinRequests',
  });

  assert.equal(await canReadLesson(m1, lesson.id), true, 'Alumno 1 aprobado masivamente');
  assert.equal(await canReadLesson(m2, lesson.id), true, 'Alumno 2 aprobado masivamente');

  // Probar asignación masiva directa de estudiantes a asignaturas
  await manage({
    action: 'bulkAssignStudents',
    userIds: [m1.id, m2.id],
    subjectIds: [sub.id],
    mode: 'add',
  });

  const cat1 = await userCatalog(m1);
  const cat2 = await userCatalog(m2);
  assert.ok(
    cat1.subjects.some((s) => s.id === sub.id),
    'Materia presente en catálogo de Alumno 1'
  );
  assert.ok(
    cat2.subjects.some((s) => s.id === sub.id),
    'Materia presente en catálogo de Alumno 2'
  );
});

test('Organización de clases: reordenamiento (moveLesson) y publicación programada por fecha (publishAt)', async () => {
  const snap = await snapshot();
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

  await execute(
    'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,$3,1,1,$4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    [lessonData1.id, sub.id, 'published', JSON.stringify(lessonData1)]
  );
  await execute(
    'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,$3,1,1,$4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    [lessonData2.id, sub.id, 'published', JSON.stringify(lessonData2)]
  );

  // Verificar orden inicial: Alfa (0) antes que Beta (1)
  let snapLessons = (await snapshot()).lessons.filter((l) => l.topicId === topic.id);
  const idxAlfa = snapLessons.findIndex((l) => l.id === lessonData1.id);
  const idxBeta = snapLessons.findIndex((l) => l.id === lessonData2.id);
  assert.ok(idxAlfa < idxBeta, 'Clase Alfa aparece antes que Clase Beta');

  // Mover Clase Beta hacia arriba (moveLesson direction: 'up')
  await manage({
    action: 'moveLesson',
    lessonId: lessonData2.id,
    direction: 'up',
  });

  snapLessons = (await snapshot()).lessons.filter((l) => l.topicId === topic.id);
  const newIdxBeta = snapLessons.findIndex((l) => l.id === lessonData2.id);
  const newIdxAlfa = snapLessons.findIndex((l) => l.id === lessonData1.id);
  assert.ok(
    newIdxBeta < newIdxAlfa,
    'Clase Beta ahora aparece antes que Clase Alfa tras mover arriba'
  );

  // Reordenar mediante drag & drop (reorderLessons) volviendo a poner Alfa primero
  await manage({
    action: 'reorderLessons',
    lessonIds: [lessonData1.id, lessonData2.id],
  });

  snapLessons = (await snapshot()).lessons.filter((l) => l.topicId === topic.id);
  const reorderIdxAlfa = snapLessons.findIndex((l) => l.id === lessonData1.id);
  const reorderIdxBeta = snapLessons.findIndex((l) => l.id === lessonData2.id);
  assert.ok(
    reorderIdxAlfa < reorderIdxBeta,
    'Clase Alfa vuelve a aparecer antes que Beta tras reordenar por drag & drop'
  );

  // Probar publicación programada por fecha (publishAt futuro)
  const futureIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  await manage({
    action: 'setLessonPublishDate',
    lessonId: lessonData1.id,
    publishAt: futureIso,
  });

  const studentUser = await login({ username: 'alumno.enrolado', password: 'Password-2026' });
  const adminUser = teacher;

  // Docente/Admin puede leer la clase programada
  assert.equal(
    await canReadLesson(adminUser, lessonData1.id),
    true,
    'Docente puede ver clase programada'
  );

  // Alumno NO puede leer el contenido de la clase futura (bloqueada)
  assert.equal(
    await canReadLesson(studentUser, lessonData1.id),
    false,
    'Alumno no puede leer clase programada a futuro'
  );

  // En el catálogo del alumno aparece con frames vacíos (bloqueada)
  const studentCat = await userCatalog(studentUser);
  const scheduledInCat = studentCat.lessons.find((l) => l.id === lessonData1.id);
  assert.ok(scheduledInCat, 'Clase programada aparece en el syllabus');
  assert.equal(
    scheduledInCat.frames.length,
    0,
    'Bloques vacíos para alumno mientras esté bloqueada'
  );

  // Probar fecha en el pasado (desbloqueada)
  const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
  await manage({
    action: 'setLessonPublishDate',
    lessonId: lessonData1.id,
    publishAt: pastIso,
  });

  assert.equal(
    await canReadLesson(studentUser, lessonData1.id),
    true,
    'Alumno puede leer clase tras llegar su fecha'
  );
});

test('Separación de alumnos por grupos (Temas como Grupos)', async () => {
  const instId = (await snapshot()).institutions[0].id;
  // 1. Crear materia con dos grupos (temas): Grupo A y Grupo B
  await manage({
    action: 'subject',
    institutionId: instId,
    name: 'Matemáticas por Grupos',
    code: 'MAT-GRP',
    color: '#3b82f6',
  });
  const matGrupos = (await snapshot()).subjects.find((s) => s.code === 'MAT-GRP')!;
  assert.ok(matGrupos);

  await manage({
    action: 'topic',
    subjectId: matGrupos.id,
    name: 'Grupo A',
  });
  await manage({
    action: 'topic',
    subjectId: matGrupos.id,
    name: 'Grupo B',
  });

  const matUpdated = (await snapshot()).subjects.find((s) => s.id === matGrupos.id)!;
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
  await manage({ action: 'saveLesson', ...lessonGroupA, publish: true });
  await manage({ action: 'saveLesson', ...lessonGroupB, publish: true });

  // 3. Crear alumno para Grupo A y alumno para Grupo B
  const studentA = await createUser(
    {
      name: 'Estudiante Grupo A',
      username: 'alumno.grupo.a',
      password: 'Password-2026',
    },
    'student'
  );
  const studentB = await createUser(
    {
      name: 'Estudiante Grupo B',
      username: 'alumno.grupo.b',
      password: 'Password-2026',
    },
    'student'
  );

  // 4. Inscribir ambos a la materia, pero restringir temas/grupos
  await manage({ action: 'assign', userId: studentA.id, subjectIds: [matGrupos.id] });
  await manage({ action: 'assign', userId: studentB.id, subjectIds: [matGrupos.id] });

  await manage({
    action: 'setStudentTopics',
    userId: studentA.id,
    subjectId: matGrupos.id,
    topicIds: [topicA.id],
  });
  await manage({
    action: 'setStudentTopics',
    userId: studentB.id,
    subjectId: matGrupos.id,
    topicIds: [topicB.id],
  });

  // 5. Verificar canReadLesson
  assert.equal(
    await canReadLesson(studentA, lessonGroupA.id),
    true,
    'Alumno A puede leer clase de Grupo A'
  );
  assert.equal(
    await canReadLesson(studentA, lessonGroupB.id),
    false,
    'Alumno A NO puede leer clase de Grupo B'
  );

  assert.equal(
    await canReadLesson(studentB, lessonGroupA.id),
    false,
    'Alumno B NO puede leer clase de Grupo A'
  );
  assert.equal(
    await canReadLesson(studentB, lessonGroupB.id),
    true,
    'Alumno B puede leer clase de Grupo B'
  );

  // 6. Verificar userCatalog (solo debe listar el tema y clases correspondientes a su grupo)
  const catA = await userCatalog(studentA);
  const subA = catA.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subA, 'Alumno A ve la materia');
  assert.equal(subA.topics.length, 1, 'Alumno A solo ve 1 tema (Grupo A)');
  assert.equal(subA.topics[0].id, topicA.id);

  const lessonsCatA = catA.lessons.filter((l) => l.subjectId === matGrupos.id);
  assert.equal(lessonsCatA.length, 1, 'Alumno A solo ve 1 clase en el catálogo');
  assert.equal(lessonsCatA[0].id, 'clase-grupo-a');

  const catB = await userCatalog(studentB);
  const subB = catB.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subB, 'Alumno B ve la materia');
  assert.equal(subB.topics.length, 1, 'Alumno B solo ve 1 tema (Grupo B)');
  assert.equal(subB.topics[0].id, topicB.id);

  // 7. Docente ve ambos grupos y clases
  const teacherCat = await userCatalog(teacher);
  const subTeacher = teacherCat.subjects.find((s) => s.id === matGrupos.id);
  assert.ok(subTeacher);
  assert.equal(subTeacher.topics.length, 2, 'Docente ve ambos grupos (temas)');

  // 8. Enlace de invitación directo a grupo
  const inviteRes = (await manage({
    action: 'getOrCreateInvite',
    subjectId: matGrupos.id,
    topicId: topicB.id,
  })) as { ok: boolean; token?: string };
  assert.ok(inviteRes.token, 'Generó token para el grupo B');

  // Alumno C se registra e ingresa con solicitud de Grupo B
  const studentC = await createUser(
    {
      name: 'Estudiante C',
      username: 'alumno.c',
      password: 'Password-2026',
    },
    'student'
  );
  await execute(
    'INSERT INTO subject_join_requests(id, subject_id, user_id, topic_id, created_at) VALUES ($1,$2,$3,$4,$5)',
    ['req-c', matGrupos.id, studentC.id, topicB.id, new Date().toISOString()]
  );

  // Aprobar solicitud
  await manage({ action: 'approveJoinRequest', requestId: 'req-c' });

  // Verificar que el alumno C quedó asignado al topicB.id
  assert.equal(
    await canReadLesson(studentC, lessonGroupB.id),
    true,
    'Alumno C inscrito vía solicitud aprobada ve Grupo B'
  );
  assert.equal(await canReadLesson(studentC, lessonGroupA.id), false, 'Alumno C NO ve Grupo A');
});

test('Cohortes independientes: Grupos con liberación asíncrona de clases sin duplicar contenidos', async () => {
  const snap = await snapshot();
  const sub = snap.subjects[0];
  const topic = sub.topics[0];

  // 1. Crear una única clase para la materia
  const sharedLesson = {
    id: 'lesson-shared-groups-1',
    title: 'Clase Unificada para Grupos',
    subtitle: 'Mismo contenido para todos los grupos',
    institutionId: sub.institutionId,
    subjectId: sub.id,
    topicId: topic.id,
    source: '',
    pdf: '',
    frames: [{ id: 'f-shared-1', title: 'Intro', section: topic.name, line: 1, blocks: [] }],
    diagnostics: [],
    status: 'draft', // Estado global en borrador
    order: 0,
  };
  await execute(
    'INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,$3,1,1,$4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, status = EXCLUDED.status',
    [sharedLesson.id, sub.id, 'draft', JSON.stringify(sharedLesson)]
  );

  // 2. Crear dos grupos en la materia: Grupo Diurno y Grupo Nocturno
  const resG1 = (await manage({
    action: 'createGroup',
    subjectId: sub.id,
    name: 'Grupo Diurno',
  })) as { id: string; name: string };
  const resG2 = (await manage({
    action: 'createGroup',
    subjectId: sub.id,
    name: 'Grupo Nocturno',
  })) as { id: string; name: string };

  assert.ok(resG1.id, 'Grupo 1 creado');
  assert.ok(resG2.id, 'Grupo 2 creado');

  // 3. Crear dos alumnos y asignarlos a la materia y a sus grupos respectivos
  const studentG1 = await createUser(
    {
      name: 'Estudiante Grupo Diurno',
      username: 'alumno.diurno',
      password: 'Password-2026',
    },
    'student'
  );
  const studentG2 = await createUser(
    {
      name: 'Estudiante Grupo Nocturno',
      username: 'alumno.nocturno',
      password: 'Password-2026',
    },
    'student'
  );

  await execute(
    'INSERT INTO enrollments(user_id, subject_id) VALUES ($1,$2), ($3,$2) ON CONFLICT DO NOTHING',
    [studentG1.id, sub.id, studentG2.id]
  );

  await manage({
    action: 'assignStudentGroup',
    userId: studentG1.id,
    subjectId: sub.id,
    groupId: resG1.id,
  });
  await manage({
    action: 'assignStudentGroup',
    userId: studentG2.id,
    subjectId: sub.id,
    groupId: resG2.id,
  });

  // 4. Configurar liberación: Publicar SOLO para Grupo Diurno; Grupo Nocturno permanece en borrador
  await manage({
    action: 'setGroupLessonRelease',
    groupId: resG1.id,
    lessonId: sharedLesson.id,
    status: 'published',
  });
  await manage({
    action: 'setGroupLessonRelease',
    groupId: resG2.id,
    lessonId: sharedLesson.id,
    status: 'draft',
  });

  // 5. Verificar accesibilidad asíncrona: Diurno puede leer, Nocturno NO
  assert.equal(
    await canReadLesson(studentG1, sharedLesson.id),
    true,
    'Alumno Diurno tiene acceso a la clase'
  );
  assert.equal(
    await canReadLesson(studentG2, sharedLesson.id),
    false,
    'Alumno Nocturno NO tiene acceso (sigue en borrador para su grupo)'
  );

  const catG1 = await userCatalog(studentG1);
  const catG2 = await userCatalog(studentG2);
  assert.ok(
    catG1.lessons.some((l) => l.id === sharedLesson.id),
    'Clase aparece en catálogo de Alumno Diurno'
  );
  assert.ok(
    !catG2.lessons.some((l) => l.id === sharedLesson.id),
    'Clase NO aparece en catálogo de Alumno Nocturno'
  );

  // 6. Ahora liberar para Grupo Nocturno programada a futuro (7 días después)
  const futureIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  await manage({
    action: 'setGroupLessonRelease',
    groupId: resG2.id,
    lessonId: sharedLesson.id,
    status: 'published',
    publishAt: futureIso,
  });

  // Nocturno ve la clase en catálogo como programada pero aún no puede leer su contenido
  const catG2Updated = await userCatalog(studentG2);
  const lessonScheduledG2 = catG2Updated.lessons.find((l) => l.id === sharedLesson.id);
  assert.ok(lessonScheduledG2, 'Clase programada aparece en catálogo de Nocturno');
  assert.equal(
    lessonScheduledG2?.frames.length,
    0,
    'Clase programada no expone diapositivas antes de fecha'
  );
  assert.equal(
    await canReadLesson(studentG2, sharedLesson.id),
    false,
    'Nocturno aún no puede leer clase programada a futuro'
  );

  // 7. Liberar definitivamente para Nocturno con fecha inmediata
  await manage({
    action: 'setGroupLessonRelease',
    groupId: resG2.id,
    lessonId: sharedLesson.id,
    status: 'published',
    publishAt: null,
  });
  assert.equal(
    await canReadLesson(studentG2, sharedLesson.id),
    true,
    'Nocturno ahora puede leer la clase'
  );

  // 8. Probar enlace de invitación con groupId: nuevo alumno se inscribe directamente al grupo
  const inviteRes = (await manage({
    action: 'getOrCreateInvite',
    subjectId: sub.id,
    groupId: resG1.id,
  })) as { ok: boolean; token?: string };
  assert.ok(inviteRes.token, 'Generó token de invitación para Grupo Diurno');

  const studentNew = await createUser(
    {
      name: 'Nuevo Alumno Diurno',
      username: 'alumno.nuevo.diurno',
      password: 'Password-2026',
    },
    'student'
  );
  await execute(
    'INSERT INTO subject_join_requests(id, subject_id, user_id, group_id, created_at) VALUES ($1,$2,$3,$4,$5)',
    ['req-diurno-new', sub.id, studentNew.id, resG1.id, new Date().toISOString()]
  );
  await manage({ action: 'approveJoinRequest', requestId: 'req-diurno-new' });

  // Comprobar que studentNew pertenece a Grupo Diurno y ve la clase inmediatamente
  assert.equal(
    await canReadLesson(studentNew, sharedLesson.id),
    true,
    'Nuevo alumno aprobado pertenece al Grupo Diurno y ve la clase'
  );
});

after(async () => {
  await testDb.adapter.close();
});
