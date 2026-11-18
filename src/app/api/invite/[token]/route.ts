import { currentUser, errorResponse, AppError } from '@/features/auth/server/auth';
import {
  db,
  syncFromPostgres,
  getPgPool,
  flushPg,
} from '@/features/administration/server/database';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await syncFromPostgres();
    const { token } = await params;
    const row = db()
      .prepare(
        'SELECT i.token,i.subject_id,s.data AS subject_data,inst.data AS inst_data FROM subject_invites i JOIN subjects s ON s.id=i.subject_id JOIN institutions inst ON inst.id=s.institution_id WHERE i.token=?'
      )
      .get(token) as
      | {
          token: string;
          subject_id: string;
          subject_data: string;
          inst_data: string;
        }
      | undefined;
    if (!row) throw new AppError('Enlace de inscripción no válido o expirado.', 404);

    let subjectObj: any = {};
    let instObj: any = {};
    try {
      subjectObj = typeof row.subject_data === 'string' ? JSON.parse(row.subject_data) : row.subject_data || {};
    } catch {}
    try {
      instObj = typeof row.inst_data === 'string' ? JSON.parse(row.inst_data) : row.inst_data || {};
    } catch {}

    const invite = {
      token: row.token,
      subject_id: row.subject_id,
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
          subjectName: invite.subject_name,
          subjectCode: invite.subject_code,
          description: invite.description,
          institutionName: invite.institution_name,
          institutionShortName: invite.institution_short_name,
        },
      });
    }

    const isEnrolled = !!db()
      .prepare('SELECT 1 FROM enrollments WHERE user_id=? AND subject_id=?')
      .get(user.id, invite.subject_id);
    const isBanned = !!db()
      .prepare('SELECT 1 FROM subject_bans WHERE user_id=? AND subject_id=?')
      .get(user.id, invite.subject_id);
    const hasAccess = isEnrolled && !isBanned;

    const existingReq = db()
      .prepare('SELECT id,status FROM subject_join_requests WHERE subject_id=? AND user_id=?')
      .get(invite.subject_id, user.id) as { id: string; status: string } | undefined;

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
    await syncFromPostgres();
    const { token } = await params;
    const invite = db()
      .prepare('SELECT subject_id FROM subject_invites WHERE token=?')
      .get(token) as { subject_id: string } | undefined;
    if (!invite) throw new AppError('Invitación de inscripción no válida.', 404);

    const user = await currentUser();
    if (!user)
      throw new AppError('Debes iniciar sesión para solicitar inscripción a la asignatura.', 401);

    const isEnrolled = !!db()
      .prepare('SELECT 1 FROM enrollments WHERE user_id=? AND subject_id=?')
      .get(user.id, invite.subject_id);
    const isBanned = !!db()
      .prepare('SELECT 1 FROM subject_bans WHERE user_id=? AND subject_id=?')
      .get(user.id, invite.subject_id);

    if (isEnrolled && !isBanned) {
      return Response.json({
        ok: true,
        status: 'approved',
        message: 'Ya estás inscrito y activo en esta asignatura.',
      });
    }

    const existing = db()
      .prepare('SELECT id,status FROM subject_join_requests WHERE subject_id=? AND user_id=?')
      .get(invite.subject_id, user.id) as { id: string; status: string } | undefined;
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
    db()
      .prepare(
        'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES (?,?,?,?,?)'
      )
      .run(reqId, invite.subject_id, user.id, 'pending', nowIso);

    const pool = getPgPool();
    if (pool) {
      pool
        .query(
          'INSERT INTO subject_join_requests(id,subject_id,user_id,status,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(subject_id,user_id) DO UPDATE SET status=EXCLUDED.status',
          [reqId, invite.subject_id, user.id, 'pending', nowIso]
        )
        .catch(console.error);
    }
    await flushPg();

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
