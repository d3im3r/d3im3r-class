import { requirePermission, errorResponse } from '@/features/auth/server/auth';
import { rosterTemplate } from '@/features/administration/server/student-roster';
export async function GET() {
  try {
    await requirePermission({ campus: ['students'] });
    const buffer = await rosterTemplate();
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="alumnos-aula.xlsx"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
