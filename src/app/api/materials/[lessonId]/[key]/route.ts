import { existsSync, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  db,
  dataDirectory,
  readLesson,
  getPgPool,
} from '@/features/administration/server/database';
import { requireUser, errorResponse, AppError } from '@/features/auth/server/auth';
import { canReadLesson, canReadResource } from '@/features/learning/server/access';
import {
  compileTikzWithTikzjax,
  cropSvgViewBox,
} from '@/features/administration/server/import-lesson';

export const runtime = 'nodejs';

function resolvePath(filePath: string): string | null {
  if (existsSync(filePath)) return filePath;
  const cwd = process.cwd();
  const relMaterials = filePath.replace(/^.*\/content\/materials\//, 'content/materials/');
  if (existsSync(path.join(cwd, relMaterials))) return path.join(cwd, relMaterials);
  const relAssets = filePath.replace(/^.*\/assets\//, 'assets/');
  if (existsSync(path.join(cwd, 'public', relAssets))) return path.join(cwd, 'public', relAssets);
  if (existsSync(path.join(cwd, 'content/materials', relAssets)))
    return path.join(cwd, 'content/materials', relAssets);
  const base = path.basename(filePath);
  const candidates = [
    path.join(cwd, 'public/assets/diagrams', base),
    path.join(cwd, 'public/assets/teaching', base),
    path.join(cwd, 'content/materials/assets/diagrams', base),
    path.join(cwd, 'content/materials/assets/teaching', base),
    path.join(cwd, 'content/materials/resources', base),
    path.join(dataDirectory(), 'cache/diagrams', base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function findFallbackResource(key: string): { path: string; mime: string; name: string } | null {
  const cwd = process.cwd();
  const searchPrefix = key.startsWith('diag-') ? key.slice(5) : key;
  const diagDirs = [
    path.join(cwd, 'public/assets/diagrams'),
    path.join(cwd, 'content/materials/assets/diagrams'),
    path.join(dataDirectory(), 'cache/diagrams'),
  ];
  for (const d of diagDirs) {
    if (existsSync(d)) {
      try {
        for (const f of readdirSync(d)) {
          if (!f.endsWith('.svg')) continue;
          if (f.startsWith(searchPrefix) || f === `${searchPrefix}.svg`) {
            return { path: path.join(d, f), mime: 'image/svg+xml', name: f };
          }
          const rel = `assets/diagrams/${f}`;
          const k = createHash('sha256').update(rel).digest('hex').slice(0, 24);
          if (k === key) {
            return { path: path.join(d, f), mime: 'image/svg+xml', name: f };
          }
        }
      } catch {}
    }
  }
  // Check teaching directory
  const teachDirs = [
    path.join(cwd, 'public/assets/teaching'),
    path.join(cwd, 'content/materials/assets/teaching'),
  ];
  for (const d of teachDirs) {
    if (existsSync(d)) {
      try {
        for (const f of readdirSync(d)) {
          const rel = `assets/teaching/${f}`;
          const k = createHash('sha256').update(rel).digest('hex').slice(0, 24);
          const sharedK = createHash('sha256').update(`shared:${f}`).digest('hex').slice(0, 24);
          if (k === key || sharedK === key || f.toLowerCase().startsWith(key.toLowerCase())) {
            const ext = path.extname(f).toLowerCase();
            const mime =
              ext === '.svg'
                ? 'image/svg+xml'
                : ext === '.png'
                  ? 'image/png'
                  : ext === '.webp'
                    ? 'image/webp'
                    : ext === '.pdf'
                      ? 'application/pdf'
                      : 'image/jpeg';
            return { path: path.join(d, f), mime, name: f };
          }
        }
      } catch {}
    }
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lessonId: string; key: string }> }
) {
  try {
    const user = await requireUser();
    const { lessonId, key } = await params;
    if (!canReadLesson(user, lessonId)) throw new AppError('Material no disponible.', 404);
    let row = db()
      .prepare('SELECT * FROM resources WHERE lesson_id=? AND key=?')
      .get(lessonId, key) as { path: string; mime: string; name: string } | undefined;

    // 1. Si el recurso es un SVG almacenado directamente como texto en la base de datos
    if (row && row.mime === 'image/svg+xml') {
      if (
        row.path.startsWith('<svg') ||
        row.path.startsWith('<?xml') ||
        row.path.startsWith('data:image/svg+xml')
      ) {
        let svg = row.path;
        if (svg.startsWith('data:image/svg+xml;utf8,')) {
          svg = decodeURIComponent(svg.slice('data:image/svg+xml;utf8,'.length));
        }
        if (!canReadResource(user, lessonId, row))
          throw new AppError('Recurso no encontrado.', 404);
        const etag = `"${key}-${createHash('sha256').update(svg).digest('hex').slice(0, 16)}"`;
        const headers = {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: etag,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        };
        if (request.headers.get('if-none-match') === etag)
          return new Response(null, { status: 304, headers });
        return new Response(svg, { headers });
      }
    }

    if (row) {
      const resolved = resolvePath(row.path);
      if (resolved) {
        row = { ...row, path: resolved };
      } else if (row.mime === 'image/svg+xml') {
        // Recuperación bajo demanda para diagramas cuyo archivo temporal no existe en la instancia Serverless actual
        const lesson = readLesson(lessonId);
        let recoveredSvg: string | null = null;
        if (lesson) {
          for (const f of lesson.frames || []) {
            for (const b of f.blocks || []) {
              if (b.type === 'diagram' && b.content) {
                const h = createHash('sha256').update(b.content).digest('hex');
                if (key === `diag-${h.slice(0, 20)}` || key.includes(h.slice(0, 12))) {
                  try {
                    const compiled = await compileTikzWithTikzjax([b.content], tmpdir());
                    const svgFile = compiled.results[h];
                    if (svgFile && existsSync(svgFile)) {
                      const raw = await readFile(svgFile, 'utf8');
                      recoveredSvg = cropSvgViewBox(raw);
                    }
                  } catch {}
                  break;
                }
              }
            }
            if (recoveredSvg) break;
          }
        }
        if (recoveredSvg) {
          db()
            .prepare('UPDATE resources SET path=? WHERE lesson_id=? AND key=?')
            .run(recoveredSvg, lessonId, key);
          const pool = getPgPool();
          if (pool) {
            pool
              .query('UPDATE resources SET path=$1 WHERE lesson_id=$2 AND key=$3', [
                recoveredSvg,
                lessonId,
                key,
              ])
              .catch(() => {});
          }
          if (!canReadResource(user, lessonId, row))
            throw new AppError('Recurso no encontrado.', 404);
          const etag = `"${key}-${createHash('sha256').update(recoveredSvg).digest('hex').slice(0, 16)}"`;
          const headers = {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: etag,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          };
          if (request.headers.get('if-none-match') === etag)
            return new Response(null, { status: 304, headers });
          return new Response(recoveredSvg, { headers });
        }
        const fallback = findFallbackResource(key);
        if (fallback) row = fallback;
        else throw new AppError('Recurso no encontrado.', 404);
      } else {
        const fallback = findFallbackResource(key);
        if (fallback) row = fallback;
        else throw new AppError('Recurso no encontrado.', 404);
      }
    } else {
      const fallback = findFallbackResource(key);
      if (fallback) row = fallback;
      else throw new AppError('Recurso no encontrado.', 404);
    }
    if (!canReadResource(user, lessonId, row)) throw new AppError('Recurso no encontrado.', 404);
    const info = await stat(row.path).catch(() => {
      throw new AppError('Recurso no encontrado.', 404);
    });
    const etag = `"${key}-${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': row.mime,
      'Content-Disposition': `${row.mime.startsWith('text/') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: etag,
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    const bytes = await readFile(row.path);
    return new Response(bytes, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
