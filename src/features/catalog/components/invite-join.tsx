'use client';
import {useEffect,useState} from 'react';
import {Building2,BookOpen,CheckCircle2,Clock,ArrowRight,ShieldAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BrandSignature} from '@/features/theme/brand-signature';
import {ThemeControls} from '@/features/theme/theme-toggle';
import type {User} from '@/features/auth/types';

export function InviteJoin({token,user}:{token:string;user:User}){
 const [loading,setLoading]=useState(true);
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState('');
 const [data,setData]=useState<{
  invite:{subjectId:string;subjectName:string;subjectCode:string;description:string;institutionName:string;institutionShortName:string};
  hasAccess:boolean;
  isEnrolled:boolean;
  isBanned:boolean;
  requestStatus:string|null;
 }|null>(null);

 async function load(){
  try{
   const res=await fetch(`/api/invite/${token}`);
   const json=await res.json();
   if(!res.ok)throw new Error(json.error||'Error al consultar inscripción');
   setData(json);
  }catch(e){
   setError(e instanceof Error?e.message:'Error al cargar invitación');
  }finally{
   setLoading(false);
  }
 }

 useEffect(()=>{
  load();
 },[token]);

 async function requestJoin(){
  setSubmitting(true);
  setError('');
  try{
   const res=await fetch(`/api/invite/${token}`,{method:'POST'});
   const json=await res.json();
   if(!res.ok)throw new Error(json.error||'Error al enviar solicitud');
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:'Error al solicitar inscripción');
  }finally{
   setSubmitting(false);
  }
 }

 return (
  <main className="login-page">
   <header>
    <a href="/" className="login-brand">aula<span>.</span></a>
    <ThemeControls/>
   </header>
   <div className="login-grid" style={{maxWidth:700,gridTemplateColumns:'1fr',margin:'30px auto'}}>
    <section className="login-card">
     <div className="eyebrow"><BookOpen size={16}/> INSCRIPCIÓN A ASIGNATURA</div>
     {loading?<p className="py-6 text-center text-muted-foreground">Verificando enlace de inscripción…</p>:error?<div className="form-error"><p>{error}</p><Button variant="outline" className="mt-3" onClick={()=>window.location.assign('/')}>Volver al inicio</Button></div>:data?(
      <div>
       <h2 className="text-xl font-bold mt-2">{data.invite.subjectName} ({data.invite.subjectCode})</h2>
       <p className="text-sm text-muted-foreground mt-1">{data.invite.institutionName}</p>
       {data.invite.description&&<p className="text-xs text-muted-foreground mt-2 italic">{data.invite.description}</p>}
       
       <div className="my-6 p-4 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
        <p className="text-xs text-muted-foreground">Sesión iniciada como:</p>
        <p className="font-semibold text-sm">{user.name} ({user.username})</p>
       </div>

       {data.hasAccess?(
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 text-emerald-800 dark:text-emerald-300">
         <div className="flex items-center gap-2 font-semibold text-sm">
          <CheckCircle2 size={18}/> Ya estás inscrito y activo en esta asignatura
         </div>
         <p className="text-xs mt-1">Puedes acceder a todos los temas, clases y actividades disponibles.</p>
         <Button className="mt-4 w-full" onClick={()=>window.location.assign('/')}>
          Ir a mis asignaturas <ArrowRight size={16}/>
         </Button>
        </div>
       ):data.isBanned?(
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-800 dark:text-red-300">
         <div className="flex items-center gap-2 font-semibold text-sm">
          <ShieldAlert size={18}/> Inscripción bloqueada o suspendida
         </div>
         <p className="text-xs mt-1">El docente ha restringido tu acceso en esta asignatura. Contacta a tu docente para habilitar tu ingreso.</p>
        </div>
       ):data.requestStatus==='pending'?(
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-amber-800 dark:text-amber-300">
         <div className="flex items-center gap-2 font-semibold text-sm">
          <Clock size={18}/> Solicitud de inscripción pendiente
         </div>
         <p className="text-xs mt-1 leading-relaxed">
          Tu solicitud fue registrada con éxito. Como medida de seguridad, el docente debe autorizar tu inscripción para que puedas ver los contenidos de la asignatura.
         </p>
         <Button variant="outline" className="mt-4 w-full" onClick={load}>
          Actualizar estado
         </Button>
        </div>
       ):(
        <div>
         <div className="p-4 rounded-lg bg-stone-100 dark:bg-stone-800/50 border mb-4 text-xs text-muted-foreground leading-relaxed flex gap-2">
          <ShieldAlert size={18} className="shrink-0 text-amber-500"/>
          <span>Al inscribirte, el docente recibirá tu solicitud para autorizar tu acceso formal a las clases y materiales de la asignatura.</span>
         </div>
         <Button className="w-full" disabled={submitting} onClick={requestJoin}>
          {submitting?'Enviando solicitud…':'Inscribirme en esta asignatura'}
         </Button>
        </div>
       )}
      </div>
     ):null}
    </section>
   </div>
  </main>
 );
}
