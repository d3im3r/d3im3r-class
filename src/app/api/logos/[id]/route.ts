import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, getPgPool } from '@/features/administration/server/database';
import { errorResponse, AppError } from '@/features/auth/server/auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let mime: string | null = null;
    let buffer: Buffer | null = null;

    // 1. Intentar desde SQLite local
    try {
      const row = db()
        .prepare('SELECT mime, data, path FROM institution_logos WHERE id=?')
        .get(id) as { mime: string; data?: string; path?: string } | undefined;

      if (row?.data) {
        mime = row.mime;
        buffer = Buffer.from(row.data, 'base64');
      } else if (row?.path && existsSync(row.path)) {
        buffer = await readFile(row.path);
        mime = row.mime;
      }
    } catch {}

    // 2. Si no está en SQLite local, consultar PostgreSQL directamente
    if (!buffer) {
      const pool = getPgPool();
      if (pool) {
        try {
          const pgRes = await pool.query('SELECT mime, data FROM institution_logos WHERE id=$1', [id]);
          if (pgRes.rows.length > 0 && pgRes.rows[0].data) {
            mime = pgRes.rows[0].mime;
            buffer = Buffer.from(pgRes.rows[0].data, 'base64');
            // Cachear en SQLite local para siguientes peticiones
            try {
              db()
                .prepare(
                  'INSERT INTO institution_logos(id, mime, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime=excluded.mime, data=excluded.data'
                )
                .run(id, mime, pgRes.rows[0].data);
            } catch {}
          }
        } catch {}
      }
    }

    // 3. Fallback a logos predeterminados en disco
    if (!buffer) {
      const fallbackFile =
        id === 'sena'
          ? path.join(process.cwd(), 'public/assets/teaching/logoSena.png')
          : id === 'politecnico'
            ? path.join(process.cwd(), 'public/assets/teaching/LogoPoli.png')
            : null;
      if (fallbackFile && existsSync(fallbackFile)) {
        buffer = await readFile(fallbackFile);
        mime = 'image/png';
      }
    }

    if (!buffer || !mime) {
      throw new AppError('Logo no encontrado.', 404);
    }

    const versionHash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    const etag = `"logo-${id}-${versionHash}"`;
    const url = new URL(request.url);
    const hasVersion = url.searchParams.has('v');

    const headers = {
      'Content-Type': mime,
      'Cache-Control': hasVersion
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600, stale-while-revalidate=86400',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };

    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(new Uint8Array(buffer), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
