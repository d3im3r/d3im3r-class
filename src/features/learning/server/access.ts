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
  if (row.status !== 'published' || !hasPermission(user, { lesson: ['readPublished'] }))
    return false;

  const isBanned = await queryOne(
    'SELECT 1 FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
    [user.id, row.subject_id]
  );
  if (isBanned) return false;

  const data = parseData<Lesson>(row.data);
  if (data.publishAt) {
    const pubTime = new Date(data.publishAt).getTime();
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

  const allLessons = await query<{ id: string; subject_id: string; data: unknown; status: string }>(
    'SELECT id, subject_id, data, status FROM lessons'
  );
  const rawLessons = allLessons.filter((row) => ids.has(row.subject_id));

  const lessons: Lesson[] = [];
  for (const row of rawLessons) {
    const isBanned = await queryOne(
      'SELECT 1 FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
      [user.id, row.subject_id]
    );
    if (isBanned) continue;

    const data = parseData<Lesson>(row.data);
    if (!canReadDraft && !allowedTopicIdSet.has(data.topicId)) {
      continue;
    }
    const isScheduledFuture =
      Boolean(data.publishAt) &&
      !isNaN(new Date(data.publishAt!).getTime()) &&
      Date.now() < new Date(data.publishAt!).getTime();

    const status: 'draft' | 'published' = row.status === 'published' ? 'published' : 'draft';

    if (row.status === 'published') {
      if (isScheduledFuture && !canReadDraft) {
        lessons.push({
          ...data,
          status: 'published',
          pdf: '',
          source: '',
          diagnostics: [],
          frames: [],
        });
      } else if (await canReadLesson(user, row.id)) {
        lessons.push({ ...data, status });
      }
    } else if (canReadDraft && (await canReadLesson(user, row.id))) {
      lessons.push({ ...data, status });
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

  for (const row of rows) {
    if (await canReadLesson(user, row.lesson_id)) {
      (result[row.lesson_id] ??= []).push(row.frame_id);
    }
  }
  return result;
}
