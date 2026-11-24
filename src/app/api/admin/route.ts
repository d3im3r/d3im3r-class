import { requirePermission, sameOrigin, errorResponse } from '@/features/auth/server/auth';
import { manage, snapshot } from '@/features/administration/server/manage';

export async function GET() {
  try {
    const user = await requirePermission({ campus: ['manage'] });
    const data = await snapshot(user);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requirePermission({ campus: ['manage'] });
    const data = await request.json();
    await manage(data, user);
    const updated = await snapshot(user);
    return Response.json(updated, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
