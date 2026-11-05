import {
  requirePermission,
  sameOrigin,
  errorResponse,
  AppError,
} from '@/features/auth/server/auth';
import { testTikz } from '@/features/tools/server/test-tikz';
import { checkRateLimit } from '@/lib/rate-limiter';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requirePermission({ tools: ['use'] });
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || user.id;
    const rate = checkRateLimit(`tikz:${ip}`, { windowMs: 60_000, max: 20 });
    if (!rate.success) {
      throw new AppError(
        'Has realizado demasiadas compilaciones de TikZ seguidas. Por favor espera un momento.',
        429
      );
    }
    if (Number(request.headers.get('content-length') ?? 0) > 100000)
      throw new AppError('El código es demasiado grande.', 413);
    const raw = await request.text();
    if (raw.length > 100000) throw new AppError('El código es demasiado grande.', 413);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AppError('La solicitud no contiene JSON válido.');
    }
    return Response.json(await testTikz(data?.source));
  } catch (error) {
    return errorResponse(error);
  }
}
