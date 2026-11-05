import {
  requirePermission,
  sameOrigin,
  errorResponse,
  AppError,
} from '@/features/auth/server/auth';
import { previewRoster, importRoster } from '@/features/administration/server/student-roster';
import { flushPg } from '@/features/administration/server/database';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requirePermission({ campus: ['students'] });
    if (Number(request.headers.get('content-length') ?? 0) > 2300000)
      throw new AppError('Selecciona un .xlsx de hasta 2 MB.');
    const form = await request.formData(),
      file = form.get('file');
    if (
      !(file instanceof File) ||
      !file.name.toLowerCase().endsWith('.xlsx') ||
      file.size > 2 * 1024 * 1024
    )
      throw new AppError('Selecciona un archivo Excel .xlsx de hasta 2 MB.');
    const buffer = Buffer.from(await file.arrayBuffer());
    if (form.get('mode') !== 'import') return Response.json(await previewRoster(buffer));
    let subjectIds;
    try {
      subjectIds = JSON.parse(String(form.get('subjectIds') ?? '[]'));
    } catch {
      throw new AppError('Las materias no son válidas.');
    }
    if (!Array.isArray(subjectIds)) throw new AppError('Las materias no son válidas.');
    const res = await importRoster(
      buffer,
      {
        fingerprint: String(form.get('fingerprint') ?? ''),
        subjectIds,
        skipErrors: form.get('skipErrors') === 'true',
        enrollExisting: form.get('enrollExisting') === 'true',
      },
      user
    );
    await flushPg();
    return Response.json(res);
  } catch (error) {
    return errorResponse(error);
  }
}
