import { existsSync, readFileSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Block, Lesson } from '@/features/catalog/model/types';
import type { User } from '@/features/auth/types';
import { AppError } from '@/features/auth/server/auth';
import {
  query,
  queryOne,
  execute,
  lessonRecord,
  userAccessibleSubjectIds,
  uploadToStorage,
  MATERIALS_BUCKET,
} from './database';
import { parseLatex } from '@/features/latex-import/lib/parser';
import { compileFigures, cropSvgViewBox } from './import-lesson';
import { sharedImage, type StoredResource } from './shared-resource';

export async function rebuildLesson(id: string, actor?: User) {
  const row = await lessonRecord(id);
  if (!row) throw new AppError('Clase no encontrada.', 404);
  if (actor && actor.role === 'teacher') {
    const allowed = await userAccessibleSubjectIds(actor);
    if (!allowed || !allowed.has(row.subject_id))
      throw new AppError('No tienes permiso para reparar clases de esta materia.', 403);
  }

  const lesson = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Lesson;

  function walk(blocks: Block[], fn: (b: Block) => void) {
    for (const b of blocks) {
      fn(b);
      if (b.children) walk(b.children, fn);
      for (const item of b.items ?? []) walk(item, fn);
    }
  }

  const storedResources = await query<{ key: string; path: string; mime: string }>(
    'SELECT key, path, mime FROM resources WHERE lesson_id = $1',
    [id]
  );
  const resourceMap = new Map<string, { path: string; mime: string }>();
  for (const r of storedResources) {
    resourceMap.set(r.key, { path: r.path, mime: r.mime });
  }

  function available(b: Block) {
    if (!b.asset) return false;
    if (b.asset.startsWith('/assets/')) {
      const inPublic = path.join(process.cwd(), 'public', b.asset.slice(1));
      const inMaterials = path.join(process.cwd(), 'content/materials', b.asset.slice(1));
      if (existsSync(inPublic) || existsSync(inMaterials)) return true;
    } else {
      const key = b.asset.split('/').at(-1);
      const res = key ? resourceMap.get(key) : undefined;
      if (res && res.path) {
        if (
          res.path.startsWith('data:') ||
          res.path.startsWith('<svg') ||
          res.path.startsWith('<?xml') ||
          res.path.startsWith('http://') ||
          res.path.startsWith('https://') ||
          res.path.includes('.svg') ||
          res.path.includes('.png') ||
          res.path.includes('.jpg') ||
          res.path.includes('.pdf') ||
          existsSync(res.path)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // Recover untouched TikZ from the stored source when an earlier parser masked its comments.
  const sourceKey = lesson.source ? (lesson.source.split('/').at(-1) ?? '') : '';
  const sourceResource = resourceMap.get(sourceKey);
  if (sourceResource && existsSync(sourceResource.path)) {
    try {
      const parsed = parseLatex(await readFile(sourceResource.path, 'utf8'));
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
    } catch {}
  }

  const figures: string[] = [];
  for (const frame of lesson.frames)
    walk(frame.blocks, (b) => {
      if (b.type === 'diagram' && !available(b)) figures.push(b.content);
    });

  let tempFolder: string | undefined;
  let compiled: {
    results: Record<string, string>;
    errors: { hash: string; message: string; log?: string; line?: number }[];
  } = { results: {}, errors: [] };

  try {
    if (figures.length) {
      tempFolder = await mkdtemp(path.join(tmpdir(), 'aula-rebuild-'));
      compiled = await compileFigures([...new Set(figures)], tempFolder);
    }
  } finally {
    if (tempFolder) {
      await rm(tempFolder, { recursive: true, force: true }).catch(() => {});
    }
  }

  const resources: StoredResource[] = [],
    urls: Record<string, string> = {};

  for (const [hash, file] of Object.entries(compiled.results)) {
    const key = 'diag-' + hash.slice(0, 20);
    let svgContent = '';
    try {
      if (file.startsWith('<svg') || file.startsWith('<?xml')) {
        svgContent = file;
      } else if (existsSync(file)) {
        svgContent = await readFile(file, 'utf8');
      }
    } catch {}
    if (svgContent) {
      svgContent = cropSvgViewBox(svgContent);
    }

    const storagePath = `${id}/${key}.svg`;
    let storedPath = svgContent;
    if (svgContent) {
      try {
        await uploadToStorage(MATERIALS_BUCKET, storagePath, svgContent, 'image/svg+xml');
        storedPath = storagePath;
      } catch {
        storedPath = svgContent;
      }
    }

    resources.push({
      key,
      name: 'diagrama-' + hash.slice(0, 8) + '.svg',
      path: storedPath,
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

  const latest = await lessonRecord(id);
  if (latest?.revision !== row.revision)
    throw new AppError('La clase cambió durante el proceso. Inténtalo de nuevo.', 409);

  for (const r of resources) {
    await execute(
      `INSERT INTO resources(lesson_id, key, name, path, mime)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(lesson_id, key) DO UPDATE SET 
         name = EXCLUDED.name,
         path = EXCLUDED.path,
         mime = EXCLUDED.mime`,
      [id, r.key, r.name, r.path, r.mime]
    );
  }

  await execute('UPDATE lessons SET data = $1 WHERE id = $2', [JSON.stringify(lesson), id]);

  return { repairedDiagrams, repairedImages, diagnostics: lesson.diagnostics };
}
