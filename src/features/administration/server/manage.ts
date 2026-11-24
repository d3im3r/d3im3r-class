import { randomUUID } from 'node:crypto';
import {
  query,
  queryOne,
  execute,
  transaction,
  lessonRecord,
  userAccessibleSubjectIds,
  userAccessibleInstitutionIds,
  deleteFromStorage,
  MATERIALS_BUCKET,
} from './database';
import { AppError, text, createUser, resetPassword } from '@/features/auth/server/auth';
import type { Subject, Institution, Lesson } from '@/features/catalog/model/types';
import type { User } from '@/features/auth/types';

const object = (row: { data?: unknown } | null | undefined): any => {
  if (!row || row.data === undefined || row.data === null) return null;
  if (typeof row.data === 'string') {
    try {
      return JSON.parse(row.data);
    } catch {
      return row.data;
    }
  }
  return row.data;
};

export async function snapshot(actor?: User) {
  const allowed = actor ? await userAccessibleSubjectIds(actor) : null;
  const isUnrestricted = allowed === null;

  const rawInstitutions = await query<{ data: unknown }>('SELECT data FROM institutions');
  let institutions = rawInstitutions.map((r) => object(r) as Institution);

  const rawSubjects = await query<{ data: unknown }>('SELECT data FROM subjects');
  let subjects = rawSubjects.map((r) => object(r) as Subject);

  if (!isUnrestricted && actor) {
    const memberRows = await query<{ institution_id: string }>(
      'SELECT institution_id FROM institution_members WHERE user_id = $1',
      [actor.id]
    );
    const memberInstIds = new Set(memberRows.map((r) => r.institution_id));
    subjects = subjects.filter((s) => allowed.has(s.id) || memberInstIds.has(s.institutionId));
    const instIds = new Set([...subjects.map((s) => s.institutionId), ...memberInstIds]);
    institutions = institutions.filter((i) => instIds.has(i.id));
  }

  const subjectIdSet = new Set(subjects.map((s) => s.id));

  const rawLessons = await query<{
    id: string;
    subject_id: string;
    status: string;
    revision: number;
    reviewed: number;
    data: unknown;
  }>('SELECT id, subject_id, status, revision, reviewed, data FROM lessons');

  let lessons = rawLessons.map((r) => {
    const l = object(r) as Lesson;
    return {
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      subjectId: l.subjectId,
      topicId: l.topicId,
      status: r.status,
      revision: r.revision,
      reviewed: r.reviewed,
      frames: l.frames?.length ?? 0,
      diagnostics: l.diagnostics,
      order: l.order ?? 0,
      publishAt: l.publishAt ?? null,
    };
  });
  lessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!isUnrestricted) {
    lessons = lessons.filter((l) => subjectIdSet.has(l.subjectId));
  }

  let enrollments = await query<{ userId: string; subjectId: string }>(
    'SELECT user_id AS "userId", subject_id AS "subjectId" FROM enrollments'
  );
  if (!isUnrestricted) {
    enrollments = enrollments.filter((e) => subjectIdSet.has(e.subjectId));
  }

  let bans = await query<{
    userId: string;
    subjectId: string;
    reason?: string;
    bannedAt: string;
  }>(
    'SELECT user_id AS "userId", subject_id AS "subjectId", reason, banned_at AS "bannedAt" FROM subject_bans'
  );
  if (!isUnrestricted) {
    bans = bans.filter((b) => subjectIdSet.has(b.subjectId));
  }

  let invites = await query<{
    subjectId: string;
    token: string;
    topicId?: string | null;
  }>(
    'SELECT subject_id AS "subjectId", token, topic_id AS "topicId" FROM subject_invites'
  );
  if (!isUnrestricted) {
    invites = invites.filter((i) => subjectIdSet.has(i.subjectId));
  }

  let joinRequests = await query<{
    id: string;
    subjectId: string;
    userId: string;
    topicId?: string | null;
    status: string;
    createdAt: string;
    userName: string;
    username: string;
    institutionId: string;
  }>(
    `SELECT r.id, r.subject_id AS "subjectId", r.user_id AS "userId", r.topic_id AS "topicId", 
            r.status, r.created_at AS "createdAt", u.name AS "userName", u.username, 
            s.institution_id AS "institutionId" 
     FROM subject_join_requests r 
     JOIN users u ON u.id = r.user_id 
     JOIN subjects s ON s.id = r.subject_id 
     WHERE r.status = 'pending' 
     ORDER BY r.created_at DESC`
  );
  if (!isUnrestricted) {
    joinRequests = joinRequests.filter((r) => subjectIdSet.has(r.subjectId));
  }

  let topicEnrollments = await query<{
    userId: string;
    subjectId: string;
    topicId: string;
  }>(
    'SELECT user_id AS "userId", subject_id AS "subjectId", topic_id AS "topicId" FROM topic_enrollments'
  );
  if (!isUnrestricted) {
    topicEnrollments = topicEnrollments.filter((te) => subjectIdSet.has(te.subjectId));
  }

  let users = await query<{
    id: string;
    name: string;
    username: string;
    role: string;
  }>('SELECT id, name, username, role FROM users ORDER BY name');

  if (!isUnrestricted && actor) {
    const allowedUserIds = new Set<string>();
    allowedUserIds.add(actor.id);
    for (const e of enrollments) allowedUserIds.add(e.userId);
    for (const r of joinRequests) allowedUserIds.add(r.userId);
    users = users.filter((u) => allowedUserIds.has(u.id));
  }

  let institutionMembers = await query<{
    userId: string;
    institutionId: string;
  }>(
    'SELECT user_id AS "userId", institution_id AS "institutionId" FROM institution_members'
  );
  if (!isUnrestricted && actor) {
    institutionMembers = institutionMembers.filter((im) => im.userId === actor.id);
  }

  return {
    institutions,
    subjects,
    lessons,
    users,
    enrollments,
    bans,
    invites,
    joinRequests,
    institutionMembers,
    topicEnrollments,
  };
}

async function subject(id: unknown): Promise<Subject> {
  const key = text(id, 'Materia');
  const row = await queryOne<{ data: unknown }>('SELECT data FROM subjects WHERE id = $1', [key]);
  const s = object(row) as Subject | null;
  if (!s) throw new AppError('Materia no encontrada.', 404);
  return s;
}

async function subjectIds(value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length > 200) throw new AppError('Selecciona las materias.');
  const list = await Promise.all(value.map((v) => subject(v)));
  return [...new Set(list.map((s) => s.id))];
}

async function removeLessonCascade(rowId: string) {
  const resources = await query<{ path: string }>(
    'SELECT path FROM resources WHERE lesson_id = $1',
    [rowId]
  );
  const storagePaths = resources
    .map((r) => r.path)
    .filter((p) => p && !p.startsWith('data:') && !p.startsWith('<svg') && !p.startsWith('<?xml'));

  await execute('DELETE FROM progress WHERE lesson_id = $1', [rowId]);
  await execute('DELETE FROM resources WHERE lesson_id = $1', [rowId]);
  await execute('DELETE FROM class_join_requests WHERE lesson_id = $1', [rowId]);
  await execute('DELETE FROM class_invites WHERE lesson_id = $1', [rowId]);
  await execute('DELETE FROM lessons WHERE id = $1', [rowId]);

  if (storagePaths.length > 0) {
    await deleteFromStorage(MATERIALS_BUCKET, storagePaths);
  }
}

async function removeStudentCascade(userId: string) {
  const target = await queryOne<User>(
    'SELECT id, name, username, role FROM users WHERE id = $1',
    [userId]
  );
  if (!target) return;
  if (target.role === 'admin') {
    throw new AppError('No se puede eliminar a un administrador.');
  }

  await execute('DELETE FROM progress WHERE user_id = $1', [userId]);
  await execute('DELETE FROM enrollments WHERE user_id = $1', [userId]);
  await execute('DELETE FROM topic_enrollments WHERE user_id = $1', [userId]);
  await execute('DELETE FROM subject_bans WHERE user_id = $1', [userId]);
  await execute('DELETE FROM subject_join_requests WHERE user_id = $1', [userId]);
  await execute('DELETE FROM class_join_requests WHERE user_id = $1', [userId]);
  await execute('DELETE FROM institution_members WHERE user_id = $1', [userId]);
  await execute('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await execute('DELETE FROM "session" WHERE "userId" = $1', [userId]);
  await execute('DELETE FROM account WHERE "userId" = $1', [userId]);
  await execute('DELETE FROM "user" WHERE id = $1', [userId]);
  await execute('DELETE FROM users WHERE id = $1', [userId]);
  await execute('DELETE FROM login_attempts WHERE username = $1', [target.username]);
}

export async function manage(input: Record<string, unknown>, actor?: User) {
  switch (input.action) {
    case 'institution': {
      if (actor && actor.role !== 'admin')
        throw new AppError('Solo los administradores pueden añadir o editar instituciones.', 403);
      const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
      const existing = await queryOne<{ data: unknown }>('SELECT data FROM institutions WHERE id = $1', [id]);
      const existingObj = object(existing);
      const i: Institution = {
        id,
        name: text(input.name, 'Institución', 150),
        shortName: text(input.shortName, 'Nombre corto', 35),
        city: text(input.city, 'Ciudad', 100),
        color: input.color === 'green' ? 'green' : 'blue',
        logo: existingObj?.logo,
      };
      await execute(
        'INSERT INTO institutions(id, data) VALUES ($1, $2) ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data',
        [id, JSON.stringify(i)]
      );
      break;
    }
    case 'teacher': {
      if (actor && actor.role !== 'admin')
        throw new AppError('Solo los administradores pueden registrar nuevos docentes.', 403);
      const institutionId =
        typeof input.institutionId === 'string' && input.institutionId.trim()
          ? input.institutionId.trim()
          : '';
      const rawSubjectIds = Array.isArray(input.subjectIds)
        ? input.subjectIds
        : typeof input.subjectId === 'string' && input.subjectId
          ? [input.subjectId]
          : [];

      const user = await createUser(input, 'teacher');
      let enrolledSubjectIds: string[] = [];
      if (institutionId) {
        const instExists = await queryOne('SELECT id FROM institutions WHERE id = $1', [institutionId]);
        if (!instExists) throw new AppError('Institución no encontrada.', 404);
        await execute(
          'INSERT INTO institution_members(user_id, institution_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, institutionId]
        );
        if (rawSubjectIds.length === 0) {
          const instSubjects = await query<{ id: string }>(
            'SELECT id FROM subjects WHERE institution_id = $1',
            [institutionId]
          );
          enrolledSubjectIds = instSubjects.map((s) => s.id);
        }
      }
      if (rawSubjectIds.length > 0) {
        const sIds = await subjectIds(rawSubjectIds);
        enrolledSubjectIds = [...new Set([...enrolledSubjectIds, ...sIds])];
      }
      for (const sId of enrolledSubjectIds) {
        await execute(
          'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, sId]
        );
      }
      break;
    }
    case 'resetPassword': {
      const userId = text(input.userId, 'Usuario');
      const target = await queryOne<User>(
        'SELECT id, name, username, role FROM users WHERE id = $1',
        [userId]
      );
      if (!target) throw new AppError('Usuario no encontrado.', 404);
      if (target.role === 'admin' && actor?.id !== target.id && actor?.role !== 'admin') {
        throw new AppError(
          'No tienes permiso para restablecer la contraseña de un administrador.',
          403
        );
      }
      if (target.role === 'teacher' && actor && actor.role !== 'admin') {
        throw new AppError(
          'Solo los administradores pueden restablecer la contraseña de otro docente.',
          403
        );
      }
      if (actor && actor.role === 'teacher' && target.role === 'student') {
        const teacherSubjects = await userAccessibleSubjectIds(actor);
        if (!teacherSubjects || teacherSubjects.size === 0) {
          throw new AppError(
            'No tienes permiso para restablecer la contraseña de alumnos que no pertenecen a tus materias.',
            403
          );
        }
        const placeholders = [...teacherSubjects].map((_, i) => `$${i + 2}`).join(',');
        const isStudentInTeacherSubjects = await queryOne(
          `SELECT 1 FROM enrollments WHERE user_id = $1 AND subject_id IN (${placeholders})`,
          [target.id, ...teacherSubjects]
        );
        if (!isStudentInTeacherSubjects)
          throw new AppError(
            'No tienes permiso para restablecer la contraseña de alumnos que no pertenecen a tus materias.',
            403
          );
      }
      await resetPassword(userId, input.password);
      break;
    }
    case 'subject': {
      const institutionId = text(input.institutionId, 'Institución');
      const instExists = await queryOne('SELECT id FROM institutions WHERE id = $1', [institutionId]);
      if (!instExists) throw new AppError('Institución no encontrada.');

      if (actor && actor.role === 'teacher') {
        const allowedInsts = await userAccessibleInstitutionIds(actor);
        if (!allowedInsts || !allowedInsts.has(institutionId))
          throw new AppError(
            'No tienes permiso para gestionar materias en esta institución.',
            403
          );
        if (input.id) {
          const allowedSubs = await userAccessibleSubjectIds(actor);
          if (!allowedSubs || !allowedSubs.has(String(input.id)))
            throw new AppError('No tienes permiso para modificar esta materia.', 403);
        }
      }
      const existing = input.id ? await subject(input.id) : null;
      const description =
        typeof input.description === 'string' ? input.description.trim().slice(0, 600) : '';
      const s: Subject = {
        id: existing?.id ?? randomUUID(),
        institutionId,
        name: text(input.name, 'Materia', 120),
        code: text(input.code, 'Código', 40),
        description,
        icon: input.icon === 'robot' ? 'robot' : 'code',
        topics: existing?.topics ?? [],
      };
      if (existing && existing.institutionId !== institutionId)
        throw new AppError('La institución de una materia existente no se puede cambiar.');

      await execute(
        'INSERT INTO subjects(id, institution_id, data) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET institution_id = EXCLUDED.institution_id, data = EXCLUDED.data',
        [s.id, institutionId, JSON.stringify(s)]
      );
      if (actor && actor.role === 'teacher') {
        await execute(
          'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [actor.id, s.id]
        );
      }
      break;
    }
    case 'topic': {
      const subjectId = String(input.subjectId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para modificar temas de esta materia.', 403);
      }
      const s = await subject(subjectId);
      const name = text(input.name, 'Tema', 120);
      const id = typeof input.id === 'string' ? input.id : '';
      if (id) {
        const topic = s.topics.find((t) => t.id === id);
        if (!topic) throw new AppError('Tema no encontrado.');
        topic.name = name;
      } else {
        s.topics.push({ id: randomUUID(), name });
      }
      await execute('UPDATE subjects SET data = $1 WHERE id = $2', [JSON.stringify(s), s.id]);
      break;
    }
    case 'moveTopic': {
      const subjectId = String(input.subjectId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para modificar temas de esta materia.', 403);
      }
      const s = await subject(subjectId);
      const index = s.topics.findIndex((t) => t.id === input.topicId);
      const target = index + (input.direction === 'up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= s.topics.length)
        throw new AppError('No se puede mover el tema.');
      [s.topics[index], s.topics[target]] = [s.topics[target], s.topics[index]];
      await execute('UPDATE subjects SET data = $1 WHERE id = $2', [JSON.stringify(s), s.id]);
      break;
    }
    case 'student': {
      const institutionId =
        typeof input.institutionId === 'string' && input.institutionId.trim()
          ? input.institutionId.trim()
          : '';
      let rawSubjectIds = Array.isArray(input.subjectIds)
        ? input.subjectIds
        : typeof input.subjectId === 'string' && input.subjectId
          ? [input.subjectId]
          : [];
      if (rawSubjectIds.length === 0 && institutionId) {
        const instSubjects = await query<{ id: string }>(
          'SELECT id FROM subjects WHERE institution_id = $1',
          [institutionId]
        );
        rawSubjectIds = instSubjects.map((s) => s.id);
      }
      const ids = rawSubjectIds.length > 0 ? await subjectIds(rawSubjectIds) : [];
      if (actor && actor.role === 'teacher') {
        if (ids.length === 0)
          throw new AppError('Debes asignar al alumno al menos a una de tus materias.', 400);
        const teacherSubjects = await userAccessibleSubjectIds(actor);
        for (const id of ids) {
          if (!teacherSubjects || !teacherSubjects.has(id))
            throw new AppError(
              'No tienes permiso para matricular alumnos en materias que no impartes.',
              403
            );
        }
      }
      const user = await createUser(input, 'student');
      for (const id of ids) {
        await execute(
          'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, id]
        );
        await execute(
          'DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
          [user.id, id]
        );
      }
      break;
    }
    case 'assignTeacher':
    case 'assign': {
      const userId = text(input.userId || input.teacherId, 'Usuario');
      const targetUser = await queryOne<User>(
        'SELECT id, name, username, role FROM users WHERE id = $1',
        [userId]
      );
      if (!targetUser) throw new AppError('Usuario no encontrado.', 404);

      if (targetUser.role === 'teacher' && actor && actor.role !== 'admin') {
        throw new AppError('Solo los administradores pueden asignar materias a un docente.', 403);
      }

      const ids = await subjectIds(input.subjectIds);
      if (actor && actor.role === 'teacher' && targetUser.role === 'student') {
        const teacherSubjects = await userAccessibleSubjectIds(actor);
        if (!teacherSubjects) throw new AppError('No tienes materias asignadas.', 403);
        for (const sId of ids) {
          if (!teacherSubjects.has(sId))
            throw new AppError('No tienes permiso para asignar materias que no impartes.', 403);
        }
        for (const sId of teacherSubjects) {
          if (ids.includes(sId)) {
            await execute(
              'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [userId, sId]
            );
            await execute(
              'DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
              [userId, sId]
            );
          } else {
            await execute('DELETE FROM enrollments WHERE user_id = $1 AND subject_id = $2', [
              userId,
              sId,
            ]);
            await execute('DELETE FROM topic_enrollments WHERE user_id = $1 AND subject_id = $2', [
              userId,
              sId,
            ]);
          }
        }
      } else {
        await execute('DELETE FROM enrollments WHERE user_id = $1', [userId]);
        await execute('DELETE FROM topic_enrollments WHERE user_id = $1', [userId]);
        for (const id of ids) {
          await execute(
            'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, id]
          );
          await execute(
            'DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
            [userId, id]
          );
        }
      }

      // Si el usuario es docente, sincronizar membresías institucionales
      if (targetUser.role === 'teacher' && ids.length > 0) {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const subjectInstitutions = await query<{ institution_id: string }>(
          `SELECT DISTINCT institution_id FROM subjects WHERE id IN (${placeholders})`,
          ids
        );
        for (const inst of subjectInstitutions) {
          await execute(
            'INSERT INTO institution_members(user_id, institution_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, inst.institution_id]
          );
        }
      }
      break;
    }
    case 'review': {
      const row = await lessonRecord(text(input.lessonId, 'Clase'));
      if (!row) throw new AppError('Clase no encontrada.', 404);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para gestionar clases de esta materia.', 403);
      }
      const l = object(row) as Lesson;
      if (!l.frames?.length) throw new AppError('La clase no contiene bloques.');
      if (input.acknowledged !== true)
        throw new AppError('Confirma que revisaste la vista previa y los avisos.');

      await execute('UPDATE lessons SET reviewed = revision WHERE id = $1', [row.id]);
      break;
    }
    case 'publish': {
      const row = await lessonRecord(text(input.lessonId, 'Clase'));
      if (!row) throw new AppError('Clase no encontrada.', 404);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para gestionar clases de esta materia.', 403);
      }
      if (row.reviewed !== row.revision)
        throw new AppError('Revisa esta versión de la clase antes de publicarla.');
      const lData = object(row) as Lesson;
      delete lData.publishAt;
      const newJson = JSON.stringify(lData);
      await execute("UPDATE lessons SET status = 'published', data = $1 WHERE id = $2", [
        newJson,
        row.id,
      ]);
      break;
    }
    case 'unpublish': {
      const row = await lessonRecord(text(input.lessonId, 'Clase'));
      if (!row) throw new AppError('Clase no encontrada.', 404);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para gestionar clases de esta materia.', 403);
      }
      const lData = object(row) as Lesson;
      delete lData.publishAt;
      const newJson = JSON.stringify(lData);
      await execute("UPDATE lessons SET status = 'draft', data = $1 WHERE id = $2", [
        newJson,
        row.id,
      ]);
      break;
    }
    case 'moveLesson': {
      const lessonId = text(input.lessonId, 'Clase');
      const direction = input.direction === 'up' ? 'up' : 'down';
      const row = await lessonRecord(lessonId);
      if (!row) throw new AppError('Clase no encontrada.', 404);

      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para ordenar clases de esta materia.', 403);
      }

      const currentData = object(row) as Lesson;
      const topicId = currentData.topicId;
      const subjectId = row.subject_id;

      const allLessonRows = await query<{ id: string; data: unknown }>(
        'SELECT id, data FROM lessons WHERE subject_id = $1',
        [subjectId]
      );

      const topicLessons: Array<{ id: string; data: Lesson }> = [];
      for (const lr of allLessonRows) {
        const lData = object(lr) as Lesson;
        if (lData.topicId === topicId) {
          topicLessons.push({ id: lr.id, data: lData });
        }
      }

      topicLessons.sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));

      const index = topicLessons.findIndex((item) => item.id === lessonId);
      const targetIndex = index + (direction === 'up' ? -1 : 1);
      if (index < 0 || targetIndex < 0 || targetIndex >= topicLessons.length) {
        throw new AppError('No se puede mover la clase.');
      }

      const temp = topicLessons[index];
      topicLessons[index] = topicLessons[targetIndex];
      topicLessons[targetIndex] = temp;

      for (let i = 0; i < topicLessons.length; i++) {
        topicLessons[i].data.order = i;
        const jsonStr = JSON.stringify(topicLessons[i].data);
        await execute('UPDATE lessons SET data = $1 WHERE id = $2', [
          jsonStr,
          topicLessons[i].id,
        ]);
      }
      break;
    }
    case 'setLessonPublishDate': {
      const lessonId = text(input.lessonId, 'Clase');
      const row = await lessonRecord(lessonId);
      if (!row) throw new AppError('Clase no encontrada.', 404);

      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para programar fechas de esta materia.', 403);
      }

      const publishAt =
        typeof input.publishAt === 'string' && input.publishAt.trim()
          ? input.publishAt.trim()
          : null;

      const currentData = object(row) as Lesson;
      if (publishAt) {
        currentData.publishAt = publishAt;
      } else {
        delete currentData.publishAt;
      }

      let newStatus = row.status;
      let newReviewed = row.reviewed;
      if (publishAt) {
        newStatus = 'published';
        newReviewed = row.revision;
      }

      const jsonStr = JSON.stringify(currentData);
      await execute('UPDATE lessons SET data = $1, status = $2, reviewed = $3 WHERE id = $4', [
        jsonStr,
        newStatus,
        newReviewed,
        lessonId,
      ]);
      break;
    }
    case 'saveLesson': {
      const subjectId = text(input.subjectId, 'Materia');
      const topicId = text(input.topicId, 'Tema');
      const subj = await subject(subjectId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para gestionar clases de esta materia.', 403);
      }
      const title = text(input.title, 'Título de la clase', 150);
      const subtitle =
        typeof input.subtitle === 'string' ? input.subtitle.trim().slice(0, 200) : '';
      const frames = Array.isArray(input.frames) ? input.frames : [];
      if (!frames.length)
        throw new AppError('La clase debe contener al menos un bloque de contenido.');

      const existingId =
        typeof input.lessonId === 'string' && input.lessonId.trim() ? input.lessonId.trim() : '';
      const existing = existingId ? await lessonRecord(existingId) : null;
      const id =
        existing?.id ??
        (typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID());
      const revision = (existing?.revision ?? 0) + 1;
      const isPublish = input.publish === true;
      const status: 'draft' | 'published' = isPublish ? 'published' : 'draft';
      const reviewed = isPublish ? revision : 0;
      const diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];

      const existingData = existing ? (object(existing) as Lesson) : null;
      const l: Lesson = {
        id,
        title,
        subtitle,
        institutionId: subj.institutionId,
        subjectId,
        topicId,
        source: existingData?.source || '',
        pdf: existingData?.pdf || '',
        frames,
        diagnostics,
        status,
      };

      await execute(
        `INSERT INTO lessons(id, subject_id, status, revision, reviewed, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(id) DO UPDATE SET 
           status = EXCLUDED.status,
           revision = EXCLUDED.revision,
           reviewed = EXCLUDED.reviewed,
           data = EXCLUDED.data`,
        [id, subjectId, status, revision, reviewed, JSON.stringify(l)]
      );

      if (existing) {
        await execute('DELETE FROM progress WHERE lesson_id = $1', [id]);
      }
      break;
    }
    case 'banStudent': {
      const userId = text(input.userId, 'Alumno'),
        subjectId = text(input.subjectId, 'Materia');
      const studentExists = await queryOne(
        "SELECT id FROM users WHERE id = $1 AND role = 'student'",
        [userId]
      );
      if (!studentExists) throw new AppError('Alumno no encontrado.');
      await subject(subjectId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para moderar alumnos en esta materia.', 403);
      }
      const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
      const nowIso = new Date().toISOString();
      await execute(
        `INSERT INTO subject_bans(user_id, subject_id, reason, banned_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(user_id, subject_id) DO UPDATE SET 
           reason = EXCLUDED.reason,
           banned_at = EXCLUDED.banned_at`,
        [userId, subjectId, reason, nowIso]
      );
      break;
    }
    case 'unbanStudent': {
      const userId = text(input.userId, 'Alumno'),
        subjectId = text(input.subjectId, 'Materia');
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para moderar alumnos en esta materia.', 403);
      }
      await execute('DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2', [
        userId,
        subjectId,
      ]);
      break;
    }
    case 'getOrCreateInvite': {
      const subjectId = text(input.subjectId, 'Materia');
      const topicId = input.topicId ? String(input.topicId) : null;
      await subject(subjectId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para generar enlaces de esta materia.', 403);
      }
      const existing = topicId
        ? await queryOne<{ token: string }>(
            'SELECT token FROM subject_invites WHERE subject_id = $1 AND topic_id = $2',
            [subjectId, topicId]
          )
        : await queryOne<{ token: string }>(
            "SELECT token FROM subject_invites WHERE subject_id = $1 AND (topic_id IS NULL OR topic_id = '')",
            [subjectId]
          );

      let token = existing?.token;
      if (!existing) {
        token = randomUUID();
        const nowIso = new Date().toISOString();
        await execute(
          'INSERT INTO subject_invites(token, subject_id, topic_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [token, subjectId, topicId, nowIso]
        );
      }
      return { ok: true, token };
    }
    case 'approveJoinRequest': {
      const requestId = text(input.requestId, 'Solicitud');
      const req = await queryOne<{
        id: string;
        subject_id: string;
        user_id: string;
        topic_id?: string | null;
      }>('SELECT id, subject_id, user_id, topic_id FROM subject_join_requests WHERE id = $1', [
        requestId,
      ]);
      if (!req) throw new AppError('Solicitud no encontrada.', 404);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(req.subject_id))
          throw new AppError(
            'No tienes permiso para responder solicitudes de esta materia.',
            403
          );
      }
      await execute(
        'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.user_id, req.subject_id]
      );
      if (req.topic_id) {
        await execute(
          'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [req.user_id, req.subject_id, req.topic_id]
        );
      }
      await execute('DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2', [
        req.user_id,
        req.subject_id,
      ]);
      await execute("UPDATE subject_join_requests SET status = 'approved' WHERE id = $1", [
        req.id,
      ]);
      break;
    }
    case 'approveAllJoinRequests':
    case 'approveJoinRequests': {
      const allowedSubs =
        actor && actor.role === 'teacher' ? await userAccessibleSubjectIds(actor) : null;
      let reqs: Array<{
        id: string;
        subject_id: string;
        user_id: string;
        topic_id?: string | null;
      }> = [];
      if (Array.isArray(input.requestIds) && input.requestIds.length > 0) {
        const placeholders = input.requestIds.map((_, i) => `$${i + 1}`).join(',');
        reqs = await query(
          `SELECT id, subject_id, user_id, topic_id FROM subject_join_requests WHERE id IN (${placeholders}) AND status = 'pending'`,
          input.requestIds
        );
      } else {
        reqs = await query(
          "SELECT id, subject_id, user_id, topic_id FROM subject_join_requests WHERE status = 'pending'"
        );
      }
      if (allowedSubs) {
        reqs = reqs.filter((r) => allowedSubs.has(r.subject_id));
      }
      if (reqs.length === 0) break;

      for (const req of reqs) {
        await execute(
          'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.user_id, req.subject_id]
        );
        if (req.topic_id) {
          await execute(
            'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [req.user_id, req.subject_id, req.topic_id]
          );
        }
        await execute('DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2', [
          req.user_id,
          req.subject_id,
        ]);
        await execute("UPDATE subject_join_requests SET status = 'approved' WHERE id = $1", [
          req.id,
        ]);
      }
      break;
    }
    case 'rejectAllJoinRequests':
    case 'rejectJoinRequests': {
      const allowedSubs =
        actor && actor.role === 'teacher' ? await userAccessibleSubjectIds(actor) : null;
      let reqs: Array<{ id: string; subject_id: string }> = [];
      if (Array.isArray(input.requestIds) && input.requestIds.length > 0) {
        const placeholders = input.requestIds.map((_, i) => `$${i + 1}`).join(',');
        reqs = await query(
          `SELECT id, subject_id FROM subject_join_requests WHERE id IN (${placeholders}) AND status = 'pending'`,
          input.requestIds
        );
      } else {
        reqs = await query(
          "SELECT id, subject_id FROM subject_join_requests WHERE status = 'pending'"
        );
      }
      if (allowedSubs) {
        reqs = reqs.filter((r) => allowedSubs.has(r.subject_id));
      }
      if (reqs.length === 0) break;

      for (const req of reqs) {
        await execute("UPDATE subject_join_requests SET status = 'rejected' WHERE id = $1", [
          req.id,
        ]);
      }
      break;
    }
    case 'bulkAssign':
    case 'bulkAssignStudents': {
      const userIds = Array.isArray(input.userIds) ? (input.userIds as string[]) : [];
      if (userIds.length === 0) throw new AppError('Debes seleccionar al menos un alumno.', 400);
      const subIds = await subjectIds(input.subjectIds);
      if (subIds.length === 0) throw new AppError('Debes seleccionar al menos una materia.', 400);
      const mode = input.mode === 'replace' ? 'replace' : 'add';

      if (actor && actor.role === 'teacher') {
        const teacherSubjects = await userAccessibleSubjectIds(actor);
        if (!teacherSubjects) throw new AppError('No tienes materias asignadas.', 403);
        for (const sId of subIds) {
          if (!teacherSubjects.has(sId))
            throw new AppError('No tienes permiso para asignar materias que no impartes.', 403);
        }
      }

      for (const uId of userIds) {
        const targetUser = await queryOne<User>(
          'SELECT id, name, username, role FROM users WHERE id = $1',
          [uId]
        );
        if (!targetUser || targetUser.role !== 'student') continue;

        if (mode === 'replace') {
          if (actor && actor.role === 'teacher') {
            const teacherSubjects = await userAccessibleSubjectIds(actor);
            if (teacherSubjects) {
              for (const sId of teacherSubjects) {
                await execute('DELETE FROM enrollments WHERE user_id = $1 AND subject_id = $2', [
                  uId,
                  sId,
                ]);
                await execute(
                  'DELETE FROM topic_enrollments WHERE user_id = $1 AND subject_id = $2',
                  [uId, sId]
                );
              }
            }
          } else {
            await execute('DELETE FROM enrollments WHERE user_id = $1', [uId]);
            await execute('DELETE FROM topic_enrollments WHERE user_id = $1', [uId]);
          }
        }

        for (const sId of subIds) {
          await execute(
            'INSERT INTO enrollments(user_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [uId, sId]
          );
          if (input.topicId) {
            const tId = String(input.topicId);
            await execute(
              'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
              [uId, sId, tId]
            );
          }
          await execute('DELETE FROM subject_bans WHERE user_id = $1 AND subject_id = $2', [
            uId,
            sId,
          ]);
          await execute(
            "UPDATE subject_join_requests SET status = 'approved' WHERE user_id = $1 AND subject_id = $2",
            [uId, sId]
          );
        }
      }
      break;
    }
    case 'setStudentTopics': {
      const userId = text(input.userId, 'Alumno');
      const subjectId = text(input.subjectId, 'Materia');
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para modificar grupos de esta materia.', 403);
      }
      const rawTopicIds = Array.isArray(input.topicIds) ? (input.topicIds as string[]) : [];
      await execute('DELETE FROM topic_enrollments WHERE user_id = $1 AND subject_id = $2', [
        userId,
        subjectId,
      ]);
      for (const tId of rawTopicIds) {
        await execute(
          'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [userId, subjectId, tId]
        );
      }
      break;
    }
    case 'rejectJoinRequest': {
      const requestId = text(input.requestId, 'Solicitud');
      const req = await queryOne<{ id: string; subject_id: string; user_id: string }>(
        'SELECT id, subject_id, user_id FROM subject_join_requests WHERE id = $1',
        [requestId]
      );
      if (req && actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(req.subject_id))
          throw new AppError(
            'No tienes permiso para responder solicitudes de esta materia.',
            403
          );
      }
      await execute("UPDATE subject_join_requests SET status = 'rejected' WHERE id = $1", [
        requestId,
      ]);
      break;
    }
    case 'deleteLesson': {
      const lessonId = text(input.lessonId, 'Clase');
      const row = await lessonRecord(lessonId);
      if (!row) throw new AppError('Clase no encontrada.', 404);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(row.subject_id))
          throw new AppError('No tienes permiso para eliminar clases de esta materia.', 403);
      }
      await removeLessonCascade(row.id);
      break;
    }
    case 'deleteTopic': {
      const subjectId = String(input.subjectId);
      const topicId = String(input.topicId);
      if (actor && actor.role === 'teacher') {
        const allowedSubs = await userAccessibleSubjectIds(actor);
        if (!allowedSubs || !allowedSubs.has(subjectId))
          throw new AppError('No tienes permiso para eliminar temas de esta materia.', 403);
      }
      const s = await subject(subjectId);
      const topicIndex = s.topics.findIndex((t) => t.id === topicId);
      if (topicIndex < 0) throw new AppError('Tema no encontrado.', 404);
      s.topics.splice(topicIndex, 1);

      await execute('UPDATE subjects SET data = $1 WHERE id = $2', [JSON.stringify(s), s.id]);
      await execute('DELETE FROM topic_enrollments WHERE subject_id = $1 AND topic_id = $2', [
        s.id,
        topicId,
      ]);
      await execute('DELETE FROM subject_invites WHERE subject_id = $1 AND topic_id = $2', [
        s.id,
        topicId,
      ]);

      const topicLessons = await query<{ id: string; data: unknown }>(
        'SELECT id, data FROM lessons WHERE subject_id = $1',
        [s.id]
      );
      for (const l of topicLessons) {
        try {
          const data = object(l);
          if (data.topicId === topicId) {
            await removeLessonCascade(l.id);
          }
        } catch {}
      }
      break;
    }
    case 'deleteSubject': {
      if (!actor || actor.role !== 'admin')
        throw new AppError('Solo los administradores pueden eliminar materias.', 403);
      const subjectId = String(input.subjectId);
      const s = await subject(subjectId);

      const subjectLessons = await query<{ id: string }>(
        'SELECT id FROM lessons WHERE subject_id = $1',
        [s.id]
      );
      for (const l of subjectLessons) {
        await removeLessonCascade(l.id);
      }

      await execute('DELETE FROM enrollments WHERE subject_id = $1', [s.id]);
      await execute('DELETE FROM topic_enrollments WHERE subject_id = $1', [s.id]);
      await execute('DELETE FROM subject_bans WHERE subject_id = $1', [s.id]);
      await execute('DELETE FROM subject_invites WHERE subject_id = $1', [s.id]);
      await execute('DELETE FROM subject_join_requests WHERE subject_id = $1', [s.id]);
      await execute('DELETE FROM subjects WHERE id = $1', [s.id]);
      break;
    }
    case 'deleteStudent': {
      const userId = text(input.userId, 'Alumno');
      const target = await queryOne<User>(
        'SELECT id, name, username, role FROM users WHERE id = $1',
        [userId]
      );
      if (!target) throw new AppError('Alumno no encontrado.', 404);
      if (target.role === 'admin')
        throw new AppError('No se puede eliminar a un administrador.', 403);
      if (target.role === 'teacher' && actor?.role !== 'admin')
        throw new AppError('Solo los administradores pueden eliminar a un docente.', 403);
      if (actor?.role === 'teacher' && target.role === 'student') {
        const teacherSubjects = await userAccessibleSubjectIds(actor);
        if (!teacherSubjects || teacherSubjects.size === 0) {
          throw new AppError(
            'No tienes permiso para eliminar alumnos que no pertenecen a tus materias.',
            403
          );
        }
        const placeholders = [...teacherSubjects].map((_, i) => `$${i + 2}`).join(',');
        const isEnrolled = await queryOne(
          `SELECT 1 FROM enrollments WHERE user_id = $1 AND subject_id IN (${placeholders})`,
          [target.id, ...teacherSubjects]
        );
        if (!isEnrolled) {
          throw new AppError(
            'No tienes permiso para eliminar alumnos que no pertenecen a tus materias.',
            403
          );
        }
      }
      await removeStudentCascade(userId);
      break;
    }
    case 'deleteStudents': {
      const rawIds = input.userIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        throw new AppError('Selecciona al menos un alumno para eliminar.');
      }
      const userIds = rawIds.map((id) => String(id));
      for (const userId of userIds) {
        const target = await queryOne<User>(
          'SELECT id, name, username, role FROM users WHERE id = $1',
          [userId]
        );
        if (!target || target.role === 'admin') continue;
        if (target.role === 'teacher' && actor?.role !== 'admin') continue;
        if (actor?.role === 'teacher' && target.role === 'student') {
          const teacherSubjects = await userAccessibleSubjectIds(actor);
          if (!teacherSubjects || teacherSubjects.size === 0) continue;
          const placeholders = [...teacherSubjects].map((_, i) => `$${i + 2}`).join(',');
          const isEnrolled = await queryOne(
            `SELECT 1 FROM enrollments WHERE user_id = $1 AND subject_id IN (${placeholders})`,
            [target.id, ...teacherSubjects]
          );
          if (!isEnrolled) continue;
        }
        await removeStudentCascade(userId);
      }
      break;
    }
    case 'cleanAllStudents': {
      if (!actor || actor.role !== 'admin') {
        throw new AppError(
          'Solo los administradores pueden realizar una limpieza masiva de alumnos.',
          403
        );
      }
      const students = await query<{ id: string }>("SELECT id FROM users WHERE role = 'student'");
      for (const s of students) {
        await removeStudentCascade(s.id);
      }
      break;
    }
    default:
      throw new AppError('Acción no válida.');
  }
  return { ok: true };
}
