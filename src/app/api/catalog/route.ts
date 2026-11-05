import { createHash } from 'node:crypto';
import { requireUser, errorResponse } from '@/features/auth/server/auth';
import { userCatalog } from '@/features/learning/server/access';
import { syncFromPostgres } from '@/features/administration/server/database';
export async function GET(request: Request) {
  try {
    await syncFromPostgres();
    const body = JSON.stringify(userCatalog(await requireUser()));
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 24)}"`;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: etag,
      Vary: 'Cookie',
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
