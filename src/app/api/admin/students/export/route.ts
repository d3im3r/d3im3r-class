import { requirePermission, errorResponse } from '@/features/auth/server/auth';
import { exportStudentRoster } from '@/features/administration/server/student-roster';

export async function GET() {
  try {
    const actor = await requirePermission({ campus: ['students'] });
    const buffer = await exportStudentRoster(actor);
    const date = new Date().toISOString().split('T')[0];
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="alumnos-progreso-${date}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
