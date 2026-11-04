import {requirePermission,sameOrigin,errorResponse,text} from '@/features/auth/server/auth';
import {rebuildLesson} from '@/features/administration/server/rebuild-lesson';
export const runtime='nodejs';export const maxDuration=240;
export async function POST(request:Request){try{sameOrigin(request);await requirePermission({campus:['rebuild']});const data=await request.json();return Response.json(await rebuildLesson(text(data.lessonId,'Clase')));}catch(error){return errorResponse(error);}}
