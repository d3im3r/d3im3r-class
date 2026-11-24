import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  queryOne,
  execute,
  uploadToStorage,
  LOGOS_BUCKET,
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

    const row = await queryOne<{ data: unknown }>('SELECT data FROM institutions WHERE id = $1', [
      id,
    ]);
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

    const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const storagePath = `${id}-${version}${ext}`;

    let uploadedPath = storagePath;
    try {
      await uploadToStorage(LOGOS_BUCKET, storagePath, bytes, mime);
    } catch {
      uploadedPath = `data:${mime};base64,${bytes.toString('base64')}`;
    }

    const base64Data = bytes.toString('base64');
    await execute(
      `INSERT INTO institution_logos(id, mime, data, path)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(id) DO UPDATE SET 
         mime = EXCLUDED.mime,
         data = EXCLUDED.data,
         path = EXCLUDED.path`,
      [id, mime, base64Data, uploadedPath]
    );

    const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as any;
    data.logo = `/api/logos/${id}?v=${version}`;

    await execute('UPDATE institutions SET data = $1 WHERE id = $2', [JSON.stringify(data), id]);

    return Response.json({ ok: true, logo: data.logo });
  } catch (error) {
    return errorResponse(error);
  }
}
