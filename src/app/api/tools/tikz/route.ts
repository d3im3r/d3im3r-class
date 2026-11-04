import {requirePermission,sameOrigin,errorResponse,AppError} from '@/features/auth/server/auth';
import {testTikz} from '@/features/tools/server/test-tikz';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){try{sameOrigin(request);await requirePermission({tools:['use']});if(Number(request.headers.get('content-length')??0)>100000)throw new AppError('El código es demasiado grande.',413);const raw=await request.text();if(raw.length>100000)throw new AppError('El código es demasiado grande.',413);let data;try{data=JSON.parse(raw);}catch{throw new AppError('La solicitud no contiene JSON válido.');}return Response.json(await testTikz(data?.source));}catch(error){return errorResponse(error);}}
