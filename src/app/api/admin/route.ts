import {requirePermission,sameOrigin,errorResponse} from '@/features/auth/server/auth';
import {manage,snapshot} from '@/features/administration/server/manage';
export async function GET(){try{await requirePermission({campus:['manage']});return Response.json(snapshot(),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);await requirePermission({campus:['manage']});const data=await request.json();manage(data);return Response.json(snapshot(),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
