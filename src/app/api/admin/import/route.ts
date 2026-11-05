import {
  requirePermission,
  sameOrigin,
  errorResponse,
  AppError,
} from '@/features/auth/server/auth';
import { importLesson } from '@/features/administration/server/import-lesson';
import { syncFromPostgres } from '@/features/administration/server/database';
export const runtime = 'nodejs';
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await syncFromPostgres();
    const user = await requirePermission({ campus: ['import'] });
    if (Number(request.headers.get('content-length') ?? 0) > 38 * 1024 * 1024)
      throw new AppError('Los archivos superan el límite de 35 MB.', 413);
    return Response.json(await importLesson(await request.formData(), user));
  } catch (error) {
    return errorResponse(error);
  }
}
