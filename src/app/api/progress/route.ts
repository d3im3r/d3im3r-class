import {
  requirePermission,
  sameOrigin,
  errorResponse,
  AppError,
  text,
} from '@/features/auth/server/auth';
import { canReadLesson, userProgress } from '@/features/learning/server/access';
import { execute, readLesson } from '@/features/administration/server/database';

export async function GET() {
  try {
    const user = await requirePermission({ progress: ['read'] });
    const progress = await userProgress(user);
    return Response.json(progress, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requirePermission({ progress: ['write'] });
    const input = await request.json(),
      id = text(input.lessonId, 'Clase');

    if (!(await canReadLesson(user, id))) throw new AppError('Clase no disponible.', 403);

    const frame = text(input.frameId, 'Bloque');
    const lesson = await readLesson(id);
    if (!lesson?.frames.some((f) => f.id === frame) || typeof input.completed !== 'boolean')
      throw new AppError('Bloque no válido.');

    if (input.completed) {
      await execute(
        'INSERT INTO progress(user_id, lesson_id, frame_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [user.id, id, frame]
      );
    } else {
      await execute(
        'DELETE FROM progress WHERE user_id = $1 AND lesson_id = $2 AND frame_id = $3',
        [user.id, id, frame]
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
