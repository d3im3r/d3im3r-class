import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Block, Lesson } from '@/features/catalog/model/types';
import type { User } from '@/features/auth/types';
import { AppError } from '@/features/auth/server/auth';
import {
  db,
  dataDirectory,
  lessonRecord,
  transaction,
  userAccessibleSubjectIds,
  getPgPool,
} from './database';
import { parseLatex } from '@/features/latex-import/lib/parser';
import { compileFigures } from './import-lesson';
import { sharedImage, type StoredResource } from './shared-resource';
export async function rebuildLesson(id: string, actor?: User) {
  const row = lessonRecord(id);
  if (!row) throw new AppError('Clase no encontrada.', 404);
  if (actor && actor.role === 'teacher') {
    const allowed = userAccessibleSubjectIds(actor);
    if (!allowed || !allowed.has(row.subject_id))
      throw new AppError('No tienes permiso para reparar clases de esta materia.', 403);
  }
  const lesson = JSON.parse(row.data) as Lesson;
  function walk(blocks: Block[], fn: (b: Block) => void) {
    for (const b of blocks) {
      fn(b);
      if (b.children) walk(b.children, fn);
      for (const item of b.items ?? []) walk(item, fn);
    }
  }
  function available(b: Block) {
    if (!b.asset) return false;
    let filePath: string | null = null;
    if (b.asset.startsWith('/assets/')) {
      const inPublic = path.join(process.cwd(), 'public', b.asset.slice(1));
      const inMaterials = path.join(process.cwd(), 'content/materials', b.asset.slice(1));
      if (existsSync(inPublic)) filePath = inPublic;
      else if (existsSync(inMaterials)) filePath = inMaterials;
    } else {
      const key = b.asset.split('/').at(-1);
      const resource = db()
        .prepare('SELECT path FROM resources WHERE lesson_id=? AND key=?')
        .get(id, key ?? '');
      if (resource && existsSync(String(resource.path))) filePath = String(resource.path);
    }
    if (!filePath) return false;
    if (b.type === 'diagram') {
      try {
        const content = readFileSync(filePath, 'utf8');
        if (
          !content ||
          content.length < 50 ||
          content.includes('<text ') ||
          content.includes('<text>')
        )
          return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  // Recover untouched TikZ from the stored source when an earlier parser masked its comments.
  const sourceResource = db()
    .prepare('SELECT path FROM resources WHERE lesson_id=? AND key=?')
    .get(id, lesson.source.split('/').at(-1) ?? '');
  if (sourceResource && existsSync(String(sourceResource.path))) {
    const parsed = parseLatex(await readFile(String(sourceResource.path), 'utf8'));
    if (
      parsed.frames.length === lesson.frames.length &&
      parsed.frames.every((f, i) => f.title === lesson.frames[i].title)
    ) {
      for (let i = 0; i < parsed.frames.length; i++) {
        const originals: Block[] = [],
          stored: Block[] = [];
        walk(parsed.frames[i].blocks, (b) => {
          if (b.type === 'diagram') originals.push(b);
        });
        walk(lesson.frames[i].blocks, (b) => {
          if (b.type === 'diagram') stored.push(b);
        });
        if (originals.length === stored.length)
          stored.forEach((b, j) => {
            if (!available(b)) b.content = originals[j].content;
          });
      }
    }
  }
  const figures: string[] = [];
  for (const frame of lesson.frames)
    walk(frame.blocks, (b) => {
      if (b.type === 'diagram' && !available(b)) figures.push(b.content);
    });
  const folder = path.join(dataDirectory(), 'uploads', id, 'repaired-' + randomUUID());
  await mkdir(folder, { recursive: true });
  const compiled = figures.length
    ? await compileFigures([...new Set(figures)], folder)
    : { results: {}, errors: [] };
  const resources: StoredResource[] = [],
    urls: Record<string, string> = {};
  for (const [hash, file] of Object.entries(compiled.results)) {
    const key = 'diag-' + hash.slice(0, 20);
    resources.push({
      key,
      name: 'diagrama-' + hash.slice(0, 8) + '.svg',
      path: file,
      mime: 'image/svg+xml',
    });
    urls[hash] = `/api/materials/${id}/${key}`;
  }
  const diagnostics = new Set(
    lesson.diagnostics.filter(
      (d) =>
        !/^Falta la imagen:|^Diagrama \d+:|^El diagrama usa comandos|^No se pudo compilar el diagrama|^Algunos diagramas TikZ|reading 'slice'|comandos que requieren revisión/i.test(
          d
        )
    )
  );
  let repairedDiagrams = 0,
    repairedImages = 0;
  for (const frame of lesson.frames)
    walk(frame.blocks, (b) => {
      if (b.type === 'diagram' && !available(b)) {
        const hash = createHash('sha256').update(b.content).digest('hex');
        if (urls[hash]) {
          b.asset = urls[hash];
          repairedDiagrams++;
        }
      }
      if (b.type === 'image' && !available(b)) {
        const resource = sharedImage(b.content);
        if (resource) {
          resources.push(resource);
          b.asset = `/api/materials/${id}/${resource.key}`;
          repairedImages++;
        } else diagnostics.add(`Falta la imagen: ${b.content}`);
      }
    });
  for (const e of compiled.errors) diagnostics.add(e.message);
  lesson.diagnostics = [...diagnostics];
  transaction(() => {
    if (lessonRecord(id)?.revision !== row.revision)
      throw new AppError('La clase cambió durante el proceso. Inténtalo de nuevo.', 409);
    for (const r of resources)
      db()
        .prepare('INSERT OR REPLACE INTO resources VALUES (?,?,?,?,?)')
        .run(id, r.key, r.name, r.path, r.mime);
    db().prepare('UPDATE lessons SET data=? WHERE id=?').run(JSON.stringify(lesson), id);
  });
  const pool = getPgPool();
  if (pool) {
    pool
      .query('UPDATE lessons SET data=$1 WHERE id=$2', [JSON.stringify(lesson), id])
      .catch(console.error);
    for (const r of resources) {
      pool
        .query(
          'INSERT INTO resources(lesson_id,key,name,path,mime) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(lesson_id,key) DO UPDATE SET name=EXCLUDED.name,path=EXCLUDED.path,mime=EXCLUDED.mime',
          [id, r.key, r.name, r.path, r.mime]
        )
        .catch(console.error);
    }
  }
  return { repairedDiagrams, repairedImages, diagnostics: lesson.diagnostics };
}
