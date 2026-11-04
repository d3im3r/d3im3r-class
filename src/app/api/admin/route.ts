import {requirePermission,sameOrigin,errorResponse} from '@/features/auth/server/auth';
import {manage,snapshot} from '@/features/administration/server/manage';
import {syncFromPostgres} from '@/features/administration/server/database';
export async function GET(){try{await syncFromPostgres();const user=await requirePermission({campus:['manage']});return Response.json(snapshot(user),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);await syncFromPostgres();const user=await requirePermission({campus:['manage']});const data=await request.json();manage(data,user);return Response.json(snapshot(user),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
