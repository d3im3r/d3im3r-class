import {
  query,
  queryOne,
  lessonRecord,
  userAccessibleSubjectIds,
} from '@/features/administration/server/database';
import { hasPermission } from '@/features/auth/server/permissions';
import type { Catalog, Institution, Subject, Lesson, Block } from '@/features/catalog/model/types';
import type { User, Progress } from '@/features/auth/types';

const parseData = <T>(val: unknown): T => {
  if (typeof val === 'string') {
    return JSON.parse(val) as T;
  }
  return val as T;
};

export async function canReadLesson(user: User, id: string): Promise<boolean> {
  const row = await lessonRecord(id);
  if (!row) return false;
  if (user.role === 'admin') return true;

  const allowed = await userAccessibleSubjectIds(user);
  if (!allowed || !allowed.has(row.subject_id)) return false;
  if (hasPermission(user, { lesson: ['readDraft'] })) return true;
  if (!hasPermission(user, { lesson: ['readPublished'] })) return false;

  const isBanned = await queryOne(
    'SELECT 1 FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
    [user.id, row.subject_id]
  );
  if (isBanned) return false;

  const data = parseData<Lesson>(row.data);

  // 1. Resolución de estado por Grupo
  const memberGroup = await queryOne<{ group_id: string }>(
    'SELECT group_id FROM group_members WHERE user_id = $1 AND subject_id = $2',
    [user.id, row.subject_id]
  );

  let effectiveStatus: string = row.status;
  let effectivePublishAt: string | null = data.publishAt ?? null;

  if (memberGroup) {
    const release = await queryOne<{ status: string; publish_at: string | null }>(
      'SELECT status, publish_at FROM group_lesson_releases WHERE group_id = $1 AND lesson_id = $2',
      [memberGroup.group_id, row.id]
    );
    if (release) {
      if (release.status === 'published' || release.status === 'draft') {
        effectiveStatus = release.status;
      }
      if (release.publish_at !== undefined) {
        effectivePublishAt = release.publish_at;
      }
    }
  }

  if (effectiveStatus !== 'published') return false;

  if (effectivePublishAt) {
    const pubTime = new Date(effectivePublishAt).getTime();
    if (!isNaN(pubTime) && Date.now() < pubTime) {
      return false;
    }
  }

  const topicEnrollments = await query<{ topic_id: string }>(
    'SELECT topic_id FROM topic_enrollments WHERE user_id = $1 AND subject_id = $2',
    [user.id, row.subject_id]
  );

  if (topicEnrollments.length > 0) {
    const allowedTopics = new Set(topicEnrollments.map((t) => t.topic_id));
    if (!allowedTopics.has(data.topicId)) {
      return false;
    }
  }

  return true;
}

export async function canReadResource(
  user: User,
  lessonId: string,
  resource: { mime: string; name: string }
): Promise<boolean> {
  if (!(await canReadLesson(user, lessonId))) return false;
  if (hasPermission(user, { lesson: ['downloadSource'] })) return true;
  const isDangerous = /\.(tex|sty|cls|bib|tikz|py|js|ts|zip)$/i.test(resource.name);
  if (isDangerous) return false;
  if (resource.mime.startsWith('image/')) return true;
  if (!hasPermission(user, { lesson: ['downloadMaterial'] })) return false;
  return resource.mime === 'application/pdf';
}

export function studentLesson(lesson: Lesson): Lesson {
  function visible(block: Block): Block {
    return {
      ...block,
      content: block.type === 'diagram' || block.children ? '' : block.content,
      children: block.children?.map(visible),
      items: block.items?.map((item) => item.map(visible)),
    };
  }
  return {
    ...lesson,
    pdf: '',
    source: '',
    diagnostics: [],
    frames: lesson.frames.map((frame) => ({
      ...frame,
      line: 0,
      blocks: (frame.blocks ?? []).map(visible),
    })),
  };
}

export async function userCatalog(user: User): Promise<Catalog> {
  const canReadAll = user.role === 'admin';
  const canReadDraft = canReadAll || hasPermission(user, { lesson: ['readDraft'] });

  const rawSubjects = canReadAll
    ? await query<{ data: unknown }>('SELECT data FROM subjects')
    : await query<{ data: unknown }>(
        `SELECT s.data FROM subjects s 
         LEFT JOIN subject_bans b ON b.subject_id = s.id AND b.user_id = $1 
         WHERE (
           s.id IN (SELECT subject_id FROM enrollments WHERE user_id = $1)
           OR s.institution_id IN (SELECT institution_id FROM institution_members WHERE user_id = $1)
         )
         AND b.user_id IS NULL`,
        [user.id]
      );

  let subjects = rawSubjects.map((row) => parseData<Subject>(row.data));

  if (!canReadDraft) {
    const topicRows = await query<{ subject_id: string; topic_id: string }>(
      'SELECT subject_id, topic_id FROM topic_enrollments WHERE user_id = $1',
      [user.id]
    );

    if (topicRows.length > 0) {
      const allowedTopicsBySubject = new Map<string, Set<string>>();
      for (const tr of topicRows) {
        if (!allowedTopicsBySubject.has(tr.subject_id)) {
          allowedTopicsBySubject.set(tr.subject_id, new Set());
        }
        allowedTopicsBySubject.get(tr.subject_id)!.add(tr.topic_id);
      }

      subjects = subjects.map((s) => {
        const allowed = allowedTopicsBySubject.get(s.id);
        if (!allowed || allowed.size === 0) return s;
        return {
          ...s,
          topics: s.topics.filter((t) => allowed.has(t.id)),
        };
      });
    }
  }

  const ids = new Set(subjects.map((s) => s.id));
  const allowedTopicIdSet = new Set(subjects.flatMap((s) => s.topics.map((t) => t.id)));

  const institutionIds = new Set(subjects.map((s) => s.institutionId));

  if (!canReadAll) {
    const memberInsts = await query<{ institution_id: string }>(
      'SELECT institution_id FROM institution_members WHERE user_id = $1',
      [user.id]
    );
    for (const im of memberInsts) {
      institutionIds.add(im.institution_id);
    }
  }

  // Si el usuario no tiene materias accesibles y no es admin, evitamos consultas innecesarias
  if (ids.size === 0 && !canReadAll) {
    const rawInstitutions = await query<{ id: string; data: unknown }>(
      'SELECT id, data FROM institutions'
    );
    const institutions = rawInstitutions
      .map((row) => parseData<Institution>(row.data))
      .filter((i) => institutionIds.has(i.id));

    return { institutions, subjects, lessons: [] };
  }

  const userGroups = !canReadDraft
    ? await query<{ subject_id: string; group_id: string }>(
        'SELECT subject_id, group_id FROM group_members WHERE user_id = $1',
        [user.id]
      )
    : [];
  const userGroupBySubject = new Map<string, string>();
  for (const ug of userGroups) {
    userGroupBySubject.set(ug.subject_id, ug.group_id);
  }

  const groupIds = [...new Set(userGroups.map((ug) => ug.group_id))];
  const userReleases =
    groupIds.length > 0
      ? await query<{
          group_id: string;
          lesson_id: string;
          status: string;
          publish_at: string | null;
        }>(
          `SELECT group_id, lesson_id, status, publish_at FROM group_lesson_releases WHERE group_id IN (${groupIds.map((_, i) => `$${i + 1}`).join(',')})`,
          groupIds
        )
      : [];
  const releaseByGroupAndLesson = new Map<string, { status: string; publishAt: string | null }>();
  for (const rel of userReleases) {
    releaseByGroupAndLesson.set(`${rel.group_id}:${rel.lesson_id}`, {
      status: rel.status,
      publishAt: rel.publish_at,
    });
  }

  // Pre-cargar bloqueos de materias para evitar consultas N+1 en el bucle
  const bannedSubjectSet = new Set<string>();
  if (!canReadAll) {
    const bannedRows = await query<{ subject_id: string }>(
      'SELECT subject_id FROM subject_bans WHERE user_id = $1',
      [user.id]
    );
    for (const b of bannedRows) {
      bannedSubjectSet.add(b.subject_id);
    }
  }

  // Consulta optimizada a lecciones: filtrado en PostgreSQL mediante ANY($1) si no es admin
  const rawLessons = canReadAll
    ? await query<{ id: string; subject_id: string; data: unknown; status: string }>(
        'SELECT id, subject_id, data, status FROM lessons'
      )
    : await query<{ id: string; subject_id: string; data: unknown; status: string }>(
        'SELECT id, subject_id, data, status FROM lessons WHERE subject_id = ANY($1)',
        [Array.from(ids)]
      );

  const canReadPublished = hasPermission(user, { lesson: ['readPublished'] });
  const lessons: Lesson[] = [];

  for (const row of rawLessons) {
    if (bannedSubjectSet.has(row.subject_id)) continue;

    const data = parseData<Lesson>(row.data);
    if (!canReadDraft && !allowedTopicIdSet.has(data.topicId)) {
      continue;
    }

    let effectiveStatus: 'draft' | 'published' = row.status === 'published' ? 'published' : 'draft';
    let effectivePublishAt: string | null = data.publishAt ?? null;

    const userGroupId = userGroupBySubject.get(row.subject_id);
    if (userGroupId) {
      const rel = releaseByGroupAndLesson.get(`${userGroupId}:${row.id}`);
      if (rel) {
        if (rel.status === 'published' || rel.status === 'draft') {
          effectiveStatus = rel.status as 'draft' | 'published';
        }
        if (rel.publishAt !== undefined) {
          effectivePublishAt = rel.publishAt;
        }
      }
    }

    const isScheduledFuture =
      Boolean(effectivePublishAt) &&
      !isNaN(new Date(effectivePublishAt!).getTime()) &&
      Date.now() < new Date(effectivePublishAt!).getTime();

    if (effectiveStatus === 'published') {
      if (isScheduledFuture && !canReadDraft) {
        lessons.push({
          ...data,
          status: 'published',
          publishAt: effectivePublishAt,
          pdf: '',
          source: '',
          diagnostics: [],
          frames: [],
        });
      } else if (canReadDraft || canReadPublished) {
        lessons.push({ ...data, status: effectiveStatus, publishAt: effectivePublishAt });
      }
    } else if (canReadDraft) {
      lessons.push({ ...data, status: effectiveStatus, publishAt: effectivePublishAt });
    }
  }

  if (!hasPermission(user, { tools: ['inspectSource'] })) {
    for (let i = 0; i < lessons.length; i++) {
      if (lessons[i].frames.length > 0) {
        lessons[i] = studentLesson(lessons[i]);
      }
    }
  }

  lessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const rawInstitutions = await query<{ id: string; data: unknown }>(
    'SELECT id, data FROM institutions'
  );
  const institutions = rawInstitutions
    .map((row) => parseData<Institution>(row.data))
    .filter((i) => canReadAll || institutionIds.has(i.id));

  return { institutions, subjects, lessons };
}

export async function userProgress(user: User): Promise<Progress> {
  if (!hasPermission(user, { progress: ['read'] })) return {};
  const result: Progress = {};

  const rows = await query<{ lesson_id: string; frame_id: string }>(
    'SELECT lesson_id, frame_id FROM progress WHERE user_id = $1',
    [user.id]
  );

  if (!rows.length) return result;

  // Evaluar permisos deduplicando por lección para evitar consultas N+1
  const distinctLessonIds = Array.from(new Set(rows.map((r) => r.lesson_id)));
  const readableMap = new Map<string, boolean>();

  await Promise.all(
    distinctLessonIds.map(async (lessonId) => {
      readableMap.set(lessonId, await canReadLesson(user, lessonId));
    })
  );

  for (const row of rows) {
    if (readableMap.get(row.lesson_id)) {
      (result[row.lesson_id] ??= []).push(row.frame_id);
    }
  }
  return result;
}
