import {
  db,
  lessonRecord,
  userAccessibleSubjectIds,
} from '@/features/administration/server/database';
import { hasPermission } from '@/features/auth/server/permissions';
import type { Catalog, Institution, Subject, Lesson, Block } from '@/features/catalog/model/types';
import type { User, Progress } from '@/features/auth/types';
export function canReadLesson(user: User, id: string) {
  const row = lessonRecord(id);
  if (!row) return false;
  if (user.role === 'admin') return true;
  const allowed = userAccessibleSubjectIds(user);
  if (!allowed || !allowed.has(row.subject_id)) return false;
  if (hasPermission(user, { lesson: ['readDraft'] })) return true;
  if (row.status !== 'published' || !hasPermission(user, { lesson: ['readPublished'] }))
    return false;
  const isBanned = !!db()
    .prepare('SELECT 1 FROM subject_bans WHERE user_id=? AND subject_id=?')
    .get(user.id, row.subject_id);
  if (isBanned) return false;

  const data = JSON.parse(row.data) as Lesson;
  if (data.publishAt) {
    const pubTime = new Date(data.publishAt).getTime();
    if (!isNaN(pubTime) && Date.now() < pubTime) {
      return false;
    }
  }

  return true;
}
export function canReadResource(
  user: User,
  lessonId: string,
  resource: { mime: string; name: string }
) {
  if (!canReadLesson(user, lessonId)) return false;
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
      blocks: frame.blocks.map(visible),
    })),
  };
}
export function userCatalog(user: User): Catalog {
  const canReadAll = user.role === 'admin';
  const canReadDraft = canReadAll || hasPermission(user, { lesson: ['readDraft'] });
  const subjects = (
    canReadAll
      ? db().prepare('SELECT data FROM subjects').all()
      : db()
          .prepare(
            `
      SELECT s.data FROM subjects s 
      LEFT JOIN subject_bans b ON b.subject_id=s.id AND b.user_id=? 
      WHERE (
        s.id IN (SELECT subject_id FROM enrollments WHERE user_id=?)
        OR s.institution_id IN (SELECT institution_id FROM institution_members WHERE user_id=?)
      )
      AND b.user_id IS NULL
    `
          )
          .all(user.id, user.id, user.id)
  ).map((row) => JSON.parse(row.data as string) as Subject);
  const ids = new Set(subjects.map((s) => s.id));
  const rawLessons = db()
    .prepare('SELECT id,subject_id,data,status FROM lessons')
    .all()
    .filter((row) => ids.has(row.subject_id as string));

  const lessons: Lesson[] = [];
  for (const row of rawLessons) {
    const isBanned = !!db()
      .prepare('SELECT 1 FROM subject_bans WHERE user_id=? AND subject_id=?')
      .get(user.id, row.subject_id);
    if (isBanned) continue;

    const data = JSON.parse(row.data as string) as Lesson;
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
      } else if (canReadLesson(user, row.id as string)) {
        lessons.push({ ...data, status });
      }
    } else if (canReadDraft && canReadLesson(user, row.id as string)) {
      lessons.push({ ...data, status });
    }
  }

  if (!hasPermission(user, { tools: ['inspectSource'] }))
    for (let i = 0; i < lessons.length; i++) {
      if (lessons[i].frames.length > 0) {
        lessons[i] = studentLesson(lessons[i]);
      }
    }

  lessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const institutionIds = new Set(subjects.map((s) => s.institutionId));
  if (!canReadAll) {
    for (const im of db()
      .prepare('SELECT institution_id FROM institution_members WHERE user_id=?')
      .all(user.id) as { institution_id: string }[]) {
      institutionIds.add(im.institution_id);
    }
  }
  const institutions = db()
    .prepare('SELECT data FROM institutions')
    .all()
    .map((row) => JSON.parse(row.data as string) as Institution)
    .filter((i) => canReadAll || institutionIds.has(i.id));
  return { institutions, subjects, lessons };
}
export function userProgress(user: User) {
  if (!hasPermission(user, { progress: ['read'] })) return {};
  const result: Progress = {};
  for (const row of db()
    .prepare('SELECT lesson_id,frame_id FROM progress WHERE user_id=?')
    .all(user.id)) {
    if (canReadLesson(user, row.lesson_id as string))
      (result[row.lesson_id as string] ??= []).push(row.frame_id as string);
  }
  return result;
}
