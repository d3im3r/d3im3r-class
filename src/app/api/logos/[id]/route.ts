import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  queryOne,
  downloadFromStorage,
  LOGOS_BUCKET,
} from '@/features/administration/server/database';
import { errorResponse, AppError } from '@/features/auth/server/auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let mime: string | null = null;
    let buffer: Buffer | null = null;

    const row = await queryOne<{ mime: string; data?: string; path?: string }>(
      'SELECT mime, data, path FROM institution_logos WHERE id = $1',
      [id]
    );

    if (row) {
      mime = row.mime;
      if (row.path && !row.path.startsWith('data:') && !row.path.startsWith('/')) {
        const { data, error } = await downloadFromStorage(LOGOS_BUCKET, row.path);
        if (!error && data) {
          buffer = data;
        }
      }

      if (!buffer && row.data) {
        buffer = Buffer.from(row.data, 'base64');
      } else if (!buffer && row.path && existsSync(row.path)) {
        buffer = await readFile(row.path);
      }
    }

    // Fallback a logos predeterminados en disco
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
