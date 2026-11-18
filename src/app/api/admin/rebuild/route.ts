import { requirePermission, sameOrigin, errorResponse, text } from '@/features/auth/server/auth';
import { rebuildLesson } from '@/features/administration/server/rebuild-lesson';
import { syncFromPostgres, flushPg } from '@/features/administration/server/database';
export const runtime = 'nodejs';
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await syncFromPostgres();
    const user = await requirePermission({ campus: ['rebuild'] });
    const data = await request.json();
    const result = await rebuildLesson(text(data.lessonId, 'Clase'), user);
    await flushPg();
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
