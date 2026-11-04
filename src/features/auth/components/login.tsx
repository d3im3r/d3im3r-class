'use client';
import {useState,type FormEvent} from 'react';
import {GraduationCap,LockKeyhole,ArrowRight,BookOpen,ShieldCheck,Globe} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BrandSignature} from '@/features/theme/brand-signature';
import {ThemeControls} from '@/features/theme/theme-toggle';
import {authClient} from '@/features/auth/client';

export function Login({setup=false,inviteToken}:{setup?:boolean;inviteToken?:string}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [devGooglePrompt,setDevGooglePrompt]=useState(false);
 const [devEmail,setDevEmail]=useState('alumno.google@gmail.com');

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');setBusy(true);
  const form=new FormData(event.currentTarget);
  try{
   const response=await fetch(`/api/auth/${setup?'setup':'login'}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.fromEntries(form))
   });
   const result=await response.json();
   if(!response.ok)throw new Error(result.error);
   if(inviteToken){
    window.location.assign(`/join/${inviteToken}`);
   }else{
    window.location.assign('/');
   }
  }catch(error){
   setError(error instanceof Error?error.message:'No fue posible iniciar sesión.');
   setBusy(false);
  }
 }

 async function loginGoogle(){
  setError('');setBusy(true);
  try{
   const provRes=await fetch('/api/auth/providers');
   const provData=await provRes.json().catch(()=>({google:false}));

   if(!provData.google){
    setDevGooglePrompt(true);
    setBusy(false);
    return;
   }

   const callbackURL=inviteToken?`${window.location.origin}/join/${inviteToken}`:`${window.location.origin}/`;
   const res=await authClient.signIn.social({
    provider:'google',
    callbackURL,
   });

   if(res?.error){
    setError(res.error.message||'No se pudo conectar con el proveedor de Google.');
    setBusy(false);
    return;
   }
   if(res?.data?.url){
    window.location.assign(res.data.url);
    return;
   }
   // En caso de que el navegador no haya redirigido aún
   setTimeout(()=>setBusy(false),3000);
  }catch(e){
   setError(e instanceof Error?e.message:'No se pudo conectar con Google.');
   setBusy(false);
  }
 }

 async function continueWithDevGoogle(){
  setError('');setBusy(true);
  try{
   const response=await fetch('/api/auth/dev-google',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:devEmail,name:'Alumno Google'}),
   });
   const result=await response.json();
   if(!response.ok)throw new Error(result.error);
   if(inviteToken){
    window.location.assign(`/join/${inviteToken}`);
   }else{
    window.location.assign('/');
   }
  }catch(e){
   setError(e instanceof Error?e.message:'Error al iniciar sesión con Google de prueba.');
   setBusy(false);
  }
 }

 return <main className="login-page"><header><a href="/" className="login-brand">aula<span>.</span></a><ThemeControls/></header><div className="login-grid"><section className="login-intro"><div className="eyebrow"><GraduationCap size={18}/> UN CAMPUS PARA TUS IDEAS</div><h1>Enseñar.<br/>Explorar.<br/><span>Aprender juntos.</span></h1><p>Clases, ejemplos y prácticas en un espacio que conecta a docentes y alumnos.</p><div className="login-features"><span><ShieldCheck size={20}/>Docentes que organizan y acompañan</span><span><BookOpen size={20}/>Alumnos que aprenden a su ritmo</span></div><BrandSignature/></section><section className="login-card"><span className="stat-icon sage"><LockKeyhole size={22}/></span><h2>{setup?'Configura tu campus':'Bienvenido a Aula'}</h2><p>{setup?'Crea la primera cuenta docente para gestionar materias, clases y alumnos.':inviteToken?'Inicia sesión para solicitar acceso a la clase asignada.':'Ingresa con tu cuenta o accede mediante Google.'}</p>
 {!setup&&<div className="google-login-wrap my-3">
  <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2 py-5" disabled={busy} onClick={loginGoogle}>
   <svg className="w-4 h-4" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
   </svg>
   Continuar con Google
  </Button>
  {devGooglePrompt&&<div className="p-3 my-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs">
   <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
    Google OAuth no configurado en el servidor
   </p>
   <p className="text-amber-800 dark:text-amber-300 mb-2 leading-relaxed">
    Para conectar con Google real, define <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> en tu archivo <code>.env.local</code>.
   </p>
   <div className="space-y-2">
    <input
     type="email"
     className="w-full text-xs p-1.5 rounded border bg-background"
     value={devEmail}
     onChange={e=>setDevEmail(e.target.value)}
     placeholder="correo@gmail.com para prueba"
    />
    <div className="flex gap-2">
     <Button type="button" size="sm" disabled={busy} onClick={continueWithDevGoogle}>
      Ingresar como alumno de prueba
     </Button>
     <Button type="button" size="sm" variant="ghost" onClick={()=>setDevGooglePrompt(false)}>
      Cerrar
     </Button>
    </div>
   </div>
  </div>}
  <div className="flex items-center my-3 text-xs text-muted-foreground uppercase tracking-wider before:flex-1 before:border-t after:flex-1 after:border-t before:mr-2 after:ml-2">o con credenciales</div>
 </div>}
 <form onSubmit={submit}>{setup&&<label>Tu nombre<input name="name" required maxLength={100} autoComplete="name" placeholder="Nombre y apellido"/></label>}<label>Usuario o correo<input name="username" required minLength={3} maxLength={100} autoComplete="username" placeholder="Tu usuario o correo"/></label><label>Contraseña<input type="password" name="password" required minLength={setup?10:1} maxLength={256} autoComplete={setup?'new-password':'current-password'} placeholder={setup?'Al menos 10 caracteres':'Tu contraseña'}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<Button type="submit" disabled={busy}>{busy?'Procesando…':setup?'Crear cuenta docente':'Iniciar sesión'}<ArrowRight size={16}/></Button></form><div className="login-note">{setup?'Esta configuración solo está disponible antes de crear la primera cuenta.':'Los nuevos alumnos inician con acceso restringido hasta que el docente apruebe su ingreso.'}</div></section></div></main>;
}
