import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  db,
  dataDirectory,
  transaction,
  getPgPool,
  flushPg,
} from '@/features/administration/server/database';
import {
  AppError,
  requirePermission,
  sameOrigin,
  errorResponse,
  text,
} from '@/features/auth/server/auth';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requirePermission({ campus: ['logo'] });
    if (Number(request.headers.get('content-length') ?? 0) > 2200000)
      throw new AppError('El logo debe ser menor a 2 MB.');
    const form = await request.formData(),
      id = text(form.get('id'), 'Institución');
    const row = db().prepare('SELECT data FROM institutions WHERE id=?').get(id);
    if (!row) throw new AppError('Institución no encontrada.', 404);
    const file = form.get('logo');
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024)
      throw new AppError('Selecciona un logo PNG, JPG o WebP de hasta 2 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          ? 'image/webp'
          : null;
    if (!mime) throw new AppError('El archivo no es una imagen PNG, JPG o WebP válida.');
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const folder = path.join(dataDirectory(), 'logos');
    await mkdir(folder, { recursive: true });
    const dest = path.join(folder, randomUUID());
    await writeFile(dest, bytes, { mode: 0o600 });
    transaction(() => {
      db()
        .prepare(
          'INSERT INTO institution_logos VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,mime=excluded.mime'
        )
        .run(id, dest, mime);
      const data = JSON.parse(row.data as string);
      data.logo = `/api/logos/${id}?v=${version}`;
      db().prepare('UPDATE institutions SET data=? WHERE id=?').run(JSON.stringify(data), id);
    });
    const pool = getPgPool();
    if (pool) {
      const data = JSON.parse(row.data as string);
      data.logo = `/api/logos/${id}?v=${version}`;
      pool
        .query('UPDATE institutions SET data=$1 WHERE id=$2', [JSON.stringify(data), id])
        .catch(console.error);
    }
    await flushPg();
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
