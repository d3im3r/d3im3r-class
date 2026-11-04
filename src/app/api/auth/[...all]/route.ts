import {sameOrigin,setup,login,loginDevGoogle,startSession,endSession,currentUser,hasPermission,roles,errorResponse} from '@/features/auth/server/auth';
import {getAuth} from '@/features/auth/server/better-auth';
export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{all?:string[]}>}){
 try{
  const {all}=await params;
  const action=all?.[0]??'';
  const fullPath=all?.join('/')??'';
  if(action==='session'||action==='get-session'||fullPath==='session'||fullPath==='get-session'){
   const user=await currentUser();
   if(!user)return Response.json({user:null,session:null,permissions:null});
   return Response.json({
    user,
    permissions:roles[user.role].statements,
   });
  }
  if(action==='providers'||fullPath==='providers'){
   const google=Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET);
   return Response.json({google});
  }
  return getAuth().handler(request);
 }catch(error){
  return errorResponse(error);
 }
}

export async function POST(request:Request,{params}:{params:Promise<{all?:string[]}>}){
 try{
  const {all}=await params;
  const action=all?.[0]??'';
  const fullPath=all?.join('/')??'';

  if(action==='logout'||action==='sign-out'||fullPath==='logout'||fullPath==='sign-out'){
   sameOrigin(request);
   await endSession();
   return Response.json({ok:true});
  }
  if(action==='setup'||action==='login'){
   sameOrigin(request);
   const input=await request.json();
   const user=action==='setup'?setup(input):login(input);
   await startSession(user);
   return Response.json({user,permissions:roles[user.role].statements});
  }
  if(action==='dev-google'){
   sameOrigin(request);
   const input=await request.json().catch(()=>({}));
   const user=await loginDevGoogle(input);
   return Response.json({user,permissions:roles[user.role].statements});
  }
  if(action==='permissions'||action==='has-permission'){
   sameOrigin(request);
   const user=await currentUser();
   if(!user)return Response.json({success:false,error:'No autenticado'},{status:401});
   const body=await request.json();
   return Response.json({success:hasPermission(user,body?.permissions??{})});
  }
  return getAuth().handler(request);
 }catch(error){
  return errorResponse(error);
 }
}

export async function PATCH(request:Request){
 return getAuth().handler(request);
}

export async function PUT(request:Request){
 return getAuth().handler(request);
}

export async function DELETE(request:Request){
 return getAuth().handler(request);
}
