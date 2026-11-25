import { currentUser, errorResponse, AppError } from '@/features/auth/server/auth';
import { queryOne, execute } from '@/features/administration/server/database';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const row = await queryOne<{
      token: string;
      subject_id: string;
      topic_id?: string | null;
      group_id?: string | null;
      subject_data: unknown;
      inst_data: unknown;
    }>(
      `SELECT i.token, i.subject_id, i.topic_id, i.group_id, s.data AS subject_data, inst.data AS inst_data 
       FROM subject_invites i 
       JOIN subjects s ON s.id = i.subject_id 
       JOIN institutions inst ON inst.id = s.institution_id 
       WHERE i.token = $1`,
      [token]
    );

    if (!row) throw new AppError('Enlace de inscripción no válido o expirado.', 404);

    let subjectObj: any = {};
    let instObj: any = {};
    try {
      subjectObj =
        typeof row.subject_data === 'string'
          ? JSON.parse(row.subject_data)
          : row.subject_data || {};
    } catch {}
    try {
      instObj = typeof row.inst_data === 'string' ? JSON.parse(row.inst_data) : row.inst_data || {};
    } catch {}

    const topic = (subjectObj.topics || []).find((t: any) => t.id === row.topic_id);
    let groupName: string | null = null;
    if (row.group_id) {
      const gRow = await queryOne<{ name: string }>(
        'SELECT name FROM subject_groups WHERE id = $1',
        [row.group_id]
      );
      groupName = gRow?.name ?? null;
    }

    const invite = {
      token: row.token,
      subject_id: row.subject_id,
      topic_id: row.topic_id ?? null,
      topic_name: topic?.name ?? null,
      group_id: row.group_id ?? null,
      group_name: groupName,
      subject_name: subjectObj.name ?? 'Materia',
      subject_code: subjectObj.code ?? '',
      description: subjectObj.description ?? '',
      institution_name: instObj.name ?? '',
      institution_short_name: instObj.shortName ?? '',
    };

    const user = await currentUser();
    if (!user) {
      return Response.json({
        authenticated: false,
        invite: {
          token: invite.token,
          subjectId: invite.subject_id,
          topicId: invite.topic_id,
          topicName: invite.topic_name,
          groupId: invite.group_id,
          groupName: invite.group_name,
          subjectName: invite.subject_name,
          subjectCode: invite.subject_code,
          description: invite.description,
          institutionName: invite.institution_name,
          institutionShortName: invite.institution_short_name,
        },
      });
    }

    const isEnrolled = !!(await queryOne(
      'SELECT 1 FROM enrollments WHERE user_id = $1 AND subject_id = $2',
      [user.id, invite.subject_id]
    ));
    const isBanned = !!(await queryOne(
      'SELECT 1 FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
      [user.id, invite.subject_id]
    ));
    const hasAccess = isEnrolled && !isBanned;

    const existingReq = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM subject_join_requests WHERE subject_id = $1 AND user_id = $2',
      [invite.subject_id, user.id]
    );

    return Response.json({
      authenticated: true,
      user,
      hasAccess,
      isEnrolled,
      isBanned,
      requestStatus: existingReq?.status ?? null,
      invite: {
        token: invite.token,
        subjectId: invite.subject_id,
        topicId: invite.topic_id,
        topicName: invite.topic_name,
        subjectName: invite.subject_name,
        subjectCode: invite.subject_code,
        description: invite.description,
        institutionName: invite.institution_name,
        institutionShortName: invite.institution_short_name,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await queryOne<{
      subject_id: string;
      topic_id?: string | null;
      group_id?: string | null;
    }>('SELECT subject_id, topic_id, group_id FROM subject_invites WHERE token = $1', [token]);
    if (!invite) throw new AppError('Invitación de inscripción no válida.', 404);

    const user = await currentUser();
    if (!user)
      throw new AppError('Debes iniciar sesión para solicitar inscripción a la asignatura.', 401);

    const isEnrolled = !!(await queryOne(
      'SELECT 1 FROM enrollments WHERE user_id = $1 AND subject_id = $2',
      [user.id, invite.subject_id]
    ));
    const isBanned = !!(await queryOne(
      'SELECT 1 FROM subject_bans WHERE user_id = $1 AND subject_id = $2',
      [user.id, invite.subject_id]
    ));

    if (isEnrolled && !isBanned) {
      if (invite.topic_id) {
        await execute(
          'INSERT INTO topic_enrollments(user_id, subject_id, topic_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [user.id, invite.subject_id, invite.topic_id]
        );
      }
      if (invite.group_id) {
        await execute(
          'INSERT INTO group_members(group_id, user_id, subject_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [invite.group_id, user.id, invite.subject_id]
        );
      }
      return Response.json({
        ok: true,
        status: 'approved',
        message: 'Ya estás inscrito y activo en esta asignatura.',
      });
    }

    const existing = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM subject_join_requests WHERE subject_id = $1 AND user_id = $2',
      [invite.subject_id, user.id]
    );

    if (existing) {
      if (existing.status === 'approved' && !isBanned) {
        return Response.json({
          ok: true,
          status: 'approved',
          message: 'Tu inscripción ya fue aprobada por el docente.',
        });
      }
      return Response.json({
        ok: true,
        status: 'pending',
        message: 'Tu solicitud de inscripción ya está pendiente de aprobación por el docente.',
      });
    }

    const reqId = randomUUID();
    const nowIso = new Date().toISOString();
    await execute(
      `INSERT INTO subject_join_requests(id, subject_id, user_id, topic_id, group_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(subject_id, user_id) DO UPDATE SET 
         topic_id = EXCLUDED.topic_id, 
         group_id = EXCLUDED.group_id,
         status = EXCLUDED.status`,
      [
        reqId,
        invite.subject_id,
        user.id,
        invite.topic_id || null,
        invite.group_id || null,
        'pending',
        nowIso,
      ]
    );

    return Response.json({
      ok: true,
      status: 'pending',
      message:
        'Solicitud de inscripción enviada al docente. El docente debe aceptar tu ingreso a la asignatura.',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
