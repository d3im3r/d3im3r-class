import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../../administration/server/test-db';
import { query, execute } from '../../administration/server/database';
import { createUser, login } from '../../auth/server/auth';
import { manage, snapshot } from '../../administration/server/manage';
import { canReadLesson, userCatalog, userProgress, studentLesson } from './access';

test('Auditoría Operativa: Modos Administrador, Docente y Estudiante', async () => {
  await createTestDatabase();

  // 1. Crear usuarios para los 3 roles
  const admin = await createUser(
    { name: 'Admin General', username: 'admin.operacion', password: 'Password-2026' },
    'admin'
  );
  const teacher = await createUser(
    { name: 'Profesor Robótica', username: 'profe.operacion', password: 'Password-2026' },
    'teacher'
  );
  const student = await createUser(
    { name: 'Estudiante Aula', username: 'alumno.operacion', password: 'Password-2026' },
    'student'
  );

  // Asegurar instituciones y materias de prueba
  await execute(`
    INSERT INTO institutions(id, data) VALUES 
      ('inst-a', '{"id":"inst-a","name":"Instituto A","city":"Medellin","country":"CO"}'),
      ('inst-b', '{"id":"inst-b","name":"Instituto B","city":"Bogota","country":"CO"}')
    ON CONFLICT (id) DO NOTHING
  `);

  await execute(`
    INSERT INTO subjects(id, institution_id, data) VALUES 
      ('sub-robotica', 'inst-a', '{"id":"sub-robotica","name":"Robótica","institutionId":"inst-a","topics":[{"id":"top-ros2","name":"ROS2"},{"id":"top-control","name":"Control"}]}'),
      ('sub-quimica', 'inst-b', '{"id":"sub-quimica","name":"Química","institutionId":"inst-b","topics":[{"id":"top-organica","name":"Orgánica"}]}')
    ON CONFLICT (id) DO NOTHING
  `);

  await execute(`
    INSERT INTO lessons(id, subject_id, status, revision, reviewed, data) VALUES 
      ('les-ros2-pub', 'sub-robotica', 'published', 1, 1, '{"id":"les-ros2-pub","title":"Nodos ROS2","subjectId":"sub-robotica","topicId":"top-ros2","status":"published","frames":[{"id":"f1","title":"Intro","blocks":[]},{"id":"f2","title":"Publicador","blocks":[]}]}'),
      ('les-ros2-draft', 'sub-robotica', 'draft', 1, 0, '{"id":"les-ros2-draft","title":"Borrador ROS2","subjectId":"sub-robotica","topicId":"top-ros2","status":"draft","frames":[{"id":"f3","title":"Draft","blocks":[]}]}'),
      ('les-quimica-pub', 'sub-quimica', 'published', 1, 1, '{"id":"les-quimica-pub","title":"Enlaces","subjectId":"sub-quimica","topicId":"top-organica","status":"published","frames":[{"id":"f4","title":"Enlaces","blocks":[]}]}')
    ON CONFLICT (id) DO NOTHING
  `);

  // Asignar al docente solo la materia 'sub-robotica'
  await execute('INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2)', [
    teacher.id,
    'sub-robotica',
  ]);

  // ==========================================
  // PRUEBA 1: OPERACIÓN MODO ADMINISTRADOR
  // ==========================================
  {
    const adminCatalog = await userCatalog(admin);
    // El admin ve todas las instituciones, todas las materias y todas las lecciones (incluyendo borradores)
    assert.ok(adminCatalog.institutions.length >= 2, 'Admin debe ver todas las instituciones');
    assert.ok(adminCatalog.subjects.length >= 2, 'Admin debe ver todas las materias');
    assert.ok(
      adminCatalog.lessons.some((l) => l.id === 'les-ros2-draft'),
      'Admin debe ver lecciones en borrador'
    );
    assert.ok(
      adminCatalog.lessons.some((l) => l.id === 'les-quimica-pub'),
      'Admin debe ver materias de otras instituciones'
    );

    const adminSnapshot = await snapshot(admin);
    assert.ok(adminSnapshot.lessons.length >= 3, 'Snapshot de admin debe ser irrestricto');
  }

  // ==========================================
  // PRUEBA 2: OPERACIÓN MODO DOCENTE
  // ==========================================
  {
    const teacherCatalog = await userCatalog(teacher);
    // El docente solo ve 'sub-robotica', no 'sub-quimica'
    const subjectIds = teacherCatalog.subjects.map((s) => s.id);
    assert.deepEqual(subjectIds, ['sub-robotica'], 'Docente solo debe ver materias asignadas');

    // El docente ve tanto publicada como borrador de su materia
    const lessonIds = teacherCatalog.lessons.map((l) => l.id);
    assert.ok(lessonIds.includes('les-ros2-pub'), 'Docente ve clase publicada');
    assert.ok(lessonIds.includes('les-ros2-draft'), 'Docente ve clase en borrador');
    assert.ok(!lessonIds.includes('les-quimica-pub'), 'Docente NO ve clases de materias ajenas');

    // Permisos individuales
    assert.equal(await canReadLesson(teacher, 'les-ros2-draft'), true);
    assert.equal(await canReadLesson(teacher, 'les-quimica-pub'), false);

    // Snapshot docente acotado
    const teacherSnapshot = await snapshot(teacher);
    assert.ok(
      teacherSnapshot.subjects.every((s) => s.id === 'sub-robotica'),
      'Snapshot docente solo contiene materias autorizadas'
    );
  }

  // ==========================================
  // PRUEBA 3: OPERACIÓN MODO ESTUDIANTE
  // ==========================================
  {
    // A) Alumno sin asignación -> catálogo vacío
    const initialCatalog = await userCatalog(student);
    assert.equal(initialCatalog.subjects.length, 0);
    assert.equal(initialCatalog.lessons.length, 0);

    // B) Asignar 'sub-robotica' al alumno
    await execute('INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2)', [
      student.id,
      'sub-robotica',
    ]);

    const studentCatalog = await userCatalog(student);
    assert.equal(studentCatalog.subjects.length, 1);
    assert.equal(studentCatalog.subjects[0].id, 'sub-robotica');

    // El alumno ve la publicada pero NUNCA el borrador
    const studentLessonIds = studentCatalog.lessons.map((l) => l.id);
    assert.ok(studentLessonIds.includes('les-ros2-pub'), 'Alumno ve lección publicada');
    assert.ok(!studentLessonIds.includes('les-ros2-draft'), 'Alumno NO ve borrador');
    assert.equal(await canReadLesson(student, 'les-ros2-draft'), false);
    assert.equal(await canReadLesson(student, 'les-ros2-pub'), true);

    // C) Filtrado por tema (topic enrollment)
    // Asignar al alumno únicamente el tema 'top-control' (la lección es 'top-ros2')
    await execute(
      'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3)',
      [student.id, 'sub-robotica', 'top-control']
    );
    const restrictedTopicCatalog = await userCatalog(student);
    assert.equal(
      restrictedTopicCatalog.lessons.length,
      0,
      'Alumno no debe ver lección de tema no matriculado'
    );
    assert.equal(await canReadLesson(student, 'les-ros2-pub'), false);

    // Limpiar restricción de tema para continuar
    await execute('DELETE FROM topic_enrollments WHERE user_id = $1', [student.id]);

    // D) Bloqueo / Baneo de alumno
    await execute('INSERT INTO subject_bans(user_id, subject_id, banned_at) VALUES ($1, $2, $3)', [
      student.id,
      'sub-robotica',
      new Date().toISOString(),
    ]);
    const bannedCatalog = await userCatalog(student);
    assert.equal(bannedCatalog.subjects.length, 0, 'Alumno baneado no ve la materia');
    assert.equal(bannedCatalog.lessons.length, 0, 'Alumno baneado no ve lecciones');
    assert.equal(await canReadLesson(student, 'les-ros2-pub'), false);

    // Desbanear alumno
    await execute('DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2', [
      student.id,
      'sub-robotica',
    ]);

    // E) Progreso del estudiante
    await execute(
      'INSERT INTO progress(user_id, lesson_id, frame_id) VALUES ($1, $2, $3), ($1, $2, $4)',
      [student.id, 'les-ros2-pub', 'f1', 'f2']
    );

    const progress = await userProgress(student);
    assert.deepEqual(
      progress['les-ros2-pub'],
      ['f1', 'f2'],
      'Progreso debe recuperar los marcos leídos'
    );
  }
});
