'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {Building2,BookOpen,Layers3,Users,Plus,Upload,Eye,CheckCircle2,Globe,Pencil,Save,ArrowRight,AlertTriangle,RefreshCw,ChevronUp,ChevronDown,ChevronLeft,FolderOpen,Ban,ShieldAlert,ShieldCheck,Link as LinkIcon,Copy,Check,Clock,KeyRound,GraduationCap,Shield,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Institution,Subject} from '@/features/catalog/model/types';
import {StudentImport} from './student-import';
import type {User} from '@/features/auth/types';
type LessonInfo={id:string;title:string;subtitle:string;subjectId:string;topicId:string;status:string;revision:number;reviewed:number;frames:number;diagnostics:string[]};
type Snapshot={institutions:Institution[];subjects:Subject[];lessons:LessonInfo[];users:User[];enrollments:{userId:string;subjectId:string}[];institutionMembers?:{userId:string;institutionId:string}[];bans?:{userId:string;subjectId:string;reason?:string;bannedAt:string}[];invites?:{subjectId:string;token:string}[];joinRequests?:{id:string;subjectId:string;userId:string;status:string;createdAt:string;userName:string;username:string;institutionId:string}[]};
async function parseJson<T = any>(response: Response): Promise<T> {
 const text = await response.text();
 let data: any;
 try {
  data = JSON.parse(text);
 } catch {
  if (!response.ok) {
   throw new Error(`Error del servidor (${response.status}): ${text.slice(0, 150) || response.statusText || 'Error desconocido'}`);
  }
  throw new Error('Respuesta inválida del servidor.');
 }
 if (!response.ok) throw new Error(data?.error || `Error del servidor (${response.status})`);
 return data;
}

export function AdminPanel({onCatalogChange:reloadCampus,user:currentUser}:{onCatalogChange:()=>Promise<void>;user?:User}){
 const [data,setData]=useState<Snapshot|null>(null),[tab,setTab]=useState('institutions'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[editInstitution,setEditInstitution]=useState<Institution|null>(null),[editSubject,setEditSubject]=useState<Subject|null>(null),[selectedInstitution,setSelectedInstitution]=useState(''),[selectedSubject,setSelectedSubject]=useState(''),[selectedTopic,setSelectedTopic]=useState(''),[replace,setReplace]=useState(''),[student,setStudent]=useState(''),[assigned,setAssigned]=useState<string[]>([]),[review,setReview]=useState<Record<string,boolean>>({}),[banSubject,setBanSubject]=useState(''),[banReason,setBanReason]=useState(''),[copiedSubject,setCopiedSubject]=useState(''),[resetUserId,setResetUserId]=useState(''),[newPassword,setNewPassword]=useState(''),[teacherInstitution,setTeacherInstitution]=useState(''),[teacherSubjectIds,setTeacherSubjectIds]=useState<string[]>([]),[newStudentInstitution,setNewStudentInstitution]=useState(''),[newStudentSubjectIds,setNewStudentSubjectIds]=useState<string[]>([]);
 async function onCatalogChange(){try{sessionStorage.setItem('aula-admin-state',JSON.stringify({tab,selectedInstitution,selectedSubject,selectedTopic}));}catch{}await reloadCampus();}
 async function refresh(){const response=await fetch('/api/admin',{cache:'no-store'});const result=await parseJson<Snapshot>(response);setData(result);}
 useEffect(()=>{try{const raw=sessionStorage.getItem('aula-admin-state');if(raw){const saved=JSON.parse(raw);if(saved.selectedInstitution)setSelectedInstitution(saved.selectedInstitution);if(saved.selectedSubject)setSelectedSubject(saved.selectedSubject);if(saved.selectedTopic)setSelectedTopic(saved.selectedTopic);if(saved.tab&&['institutions','subjects','topics','lessons','students'].includes(saved.tab))setTab(saved.tab);sessionStorage.removeItem('aula-admin-state');}}catch{}refresh().catch(e=>setError(e.message));},[]);
 async function mutate(input:Record<string,unknown>,success:string){setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await parseJson<Snapshot>(response);setData(result);await onCatalogChange();setMessage(success);return true;}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar.');return false;}finally{setBusy(false);}}
 function form(event:FormEvent<HTMLFormElement>){event.preventDefault();return Object.fromEntries(new FormData(event.currentTarget));}
 async function importClass(event:FormEvent<HTMLFormElement>){event.preventDefault();const node=event.currentTarget;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/admin/import',{method:'POST',body:new FormData(node)});const result=await parseJson<{frames:number;diagnostics:string[]}>(response);await Promise.all([refresh(),onCatalogChange()]);node.reset();setReplace('');setMessage(`Clase importada: ${result.frames} bloques. Revisa la vista previa antes de publicar.`);}catch(e){setError(e instanceof Error?e.message:'No se pudo importar.');}finally{setBusy(false);}}
 async function uploadLogo(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');try{const response=await fetch('/api/admin/logo',{method:'POST',body:new FormData(event.currentTarget)});await parseJson(response);await Promise.all([refresh(),onCatalogChange()]);setMessage('Logo actualizado.');}catch(error){setError(error instanceof Error?error.message:'No se pudo guardar el logo.');}finally{setBusy(false);}}
 async function repairResources(lessonId:string){setBusy(true);setError('');try{const response=await fetch('/api/admin/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lessonId})});const result=await parseJson<{repairedDiagrams:number;repairedImages:number}>(response);await Promise.all([refresh(),onCatalogChange()]);setMessage(`Recursos reprocesados: ${result.repairedDiagrams} diagramas y ${result.repairedImages} imágenes restaurados.`);}catch(e){setError(e instanceof Error?e.message:'No se pudo reprocesar.');}finally{setBusy(false);}}
 if(!data)return <main className="admin-page"><h1>Gestión docente</h1>{error?<p role="alert" className="form-error">{error}</p>:<p>Cargando tu campus…</p>}</main>;
 const currentInstitution=data.institutions.find(i=>i.id===selectedInstitution)??null;
 const institutionSubjects=currentInstitution?data.subjects.filter(s=>s.institutionId===currentInstitution.id):[];
 const currentSubject=institutionSubjects.find(s=>s.id===selectedSubject)??null;
 const subjectTopics=currentSubject?currentSubject.topics:[];
 const currentTopic=subjectTopics.find(t=>t.id===selectedTopic)??null;
 const topicLessons=currentSubject&&currentTopic?data.lessons.filter(l=>l.subjectId===currentSubject.id&&l.topicId===currentTopic.id):[];
  const isAdmin=currentUser?.role==='admin';
  const students=data.users.filter(u=>u.role==='student');
  const teachers=data.users.filter(u=>u.role==='teacher');
  const admins=data.users.filter(u=>u.role==='admin');
  const pendingRequests=data.joinRequests??[];
  const activeTab=tab==='lessons'&&!currentTopic?(currentSubject?'topics':currentInstitution?'subjects':'institutions'):tab==='topics'&&!currentSubject?(currentInstitution?'subjects':'institutions'):tab==='subjects'&&!currentInstitution?'institutions':tab;
  function goTab(next:string){setTab(next);setError('');setMessage('');}

  async function copyInviteLink(subjectId:string){
   try{
    let token=(data?.invites??[]).find(i=>i.subjectId===subjectId)?.token;
    if(!token){
     await mutate({action:'getOrCreateInvite',subjectId},'Enlace de inscripción generado.');
     const ref=await fetch('/api/admin',{cache:'no-store'});
     const snap=await ref.json();
     token=snap.invites?.find((i:{subjectId:string;token:string})=>i.subjectId===subjectId)?.token;
    }
    if(token){
     const url=`${window.location.origin}/join/${token}`;
     await navigator.clipboard.writeText(url);
     setCopiedSubject(subjectId);
     setTimeout(()=>setCopiedSubject(''),2500);
     setMessage('Enlace de inscripción a la asignatura copiado al portapapeles. Compártelo con tus alumnos.');
    }
   }catch(e){
    setError('No se pudo copiar el enlace de inscripción.');
   }
  }
 return <main className="admin-page"><div className="admin-heading"><div><div className="eyebrow">{isAdmin?'PANEL DE ADMINISTRACIÓN':'ESPACIO DOCENTE'}</div><h1>Construye tu campus.</h1><p>Selecciona una institución, entra a una materia y su tema para gestionar únicamente sus clases.</p></div><span className="admin-role"><CheckCircle2 size={16}/>{isAdmin?'Super Administrador':'Docente'}</span></div>
 <div className="admin-steps">
  <button type="button" className={activeTab==='institutions'?'active':''} onClick={()=>goTab('institutions')}>1. Institución{currentInstitution?`: ${currentInstitution.shortName}`:''}</button>
  <ArrowRight size={13}/>
  <button type="button" className={activeTab==='subjects'?'active':''} disabled={!currentInstitution} onClick={()=>currentInstitution&&goTab('subjects')}>2. Materia{currentSubject?`: ${currentSubject.name}`:''}</button>
  <ArrowRight size={13}/>
  <button type="button" className={activeTab==='topics'?'active':''} disabled={!currentSubject} onClick={()=>currentSubject&&goTab('topics')}>3. Tema{currentTopic?`: ${currentTopic.name}`:''}</button>
  <ArrowRight size={13}/>
  <button type="button" className={activeTab==='lessons'?'active':''} disabled={!currentTopic} onClick={()=>currentTopic&&goTab('lessons')}>4. Clases{currentTopic?` (${topicLessons.length})`:''}</button>
 </div>
 <nav className="admin-tabs" aria-label="Gestión docente">
  <button className={activeTab==='institutions'?'selected':''} onClick={()=>goTab('institutions')}><Building2 size={16}/>Instituciones<span>{data.institutions.length}</span></button>
  <button className={activeTab==='subjects'?'selected':''} disabled={!currentInstitution} onClick={()=>currentInstitution&&goTab('subjects')}><BookOpen size={16}/>{currentInstitution?`Materias · ${currentInstitution.shortName}`:'Materias'}<span>{currentInstitution?institutionSubjects.length:data.subjects.length}</span></button>
  <button className={activeTab==='topics'?'selected':''} disabled={!currentSubject} onClick={()=>currentSubject&&goTab('topics')}><FolderOpen size={16}/>{currentSubject?`Temas · ${currentSubject.code}`:'Temas'}<span>{currentSubject?subjectTopics.length:0}</span></button>
  <button className={activeTab==='lessons'?'selected':''} disabled={!currentTopic} onClick={()=>currentTopic&&goTab('lessons')}><Layers3 size={16}/>{currentTopic?`Clases · ${currentTopic.name}`:'Clases'}<span>{currentTopic?topicLessons.length:0}</span></button>
  <button className={activeTab==='students'?'selected':''} onClick={()=>goTab('students')}><Users size={16}/>Alumnos y asignaciones<span>{students.length}{pendingRequests.length>0?` (${pendingRequests.length} pendientes)`:''}</span></button>
  {isAdmin&&<button className={activeTab==='teachers'?'selected':''} onClick={()=>goTab('teachers')}><GraduationCap size={16}/>Profesores y equipo<span>{teachers.length}</span></button>}
 </nav>
 {message&&<div className="form-success" role="status"><CheckCircle2 size={17}/>{message}</div>}{error&&<div className="form-error" role="alert">{error}</div>}
 {activeTab==='institutions'&&<div className="admin-two-columns">
  <section className="admin-card admin-established">
   <div className="admin-card-header"><div><span className="eyebrow">ESTRUCTURA ESTABLECIDA</span><h2><Building2 size={20}/>Instituciones del campus</h2></div><span className="admin-count-badge">{data.institutions.length} {data.institutions.length===1?'institución':'instituciones'}</span></div>
   <p className="admin-help">Selecciona una institución para entrar y gestionar únicamente sus materias.</p>
   <div className="admin-list">{data.institutions.map(i=>{const count=data.subjects.filter(s=>s.institutionId===i.id).length;return <div key={i.id} className={selectedInstitution===i.id?'is-active':''}><span className={`institution-dot ${i.color}`}/><div><strong>{i.name}</strong><p>{i.shortName} · {i.city} · {count} {count===1?'materia':'materias'}</p></div>{isAdmin&&<Button variant="ghost" size="sm" onClick={()=>setEditInstitution(i)} aria-label={`Editar ${i.shortName}`}><Pencil size={15}/></Button>}<Button size="sm" onClick={()=>{setSelectedInstitution(i.id);setSelectedSubject('');setSelectedTopic('');setEditSubject(null);goTab('subjects');}}>Ver materias<ArrowRight size={14}/></Button></div>;})}</div>
  </section>
  <section className="admin-card admin-create">
   <div className="admin-card-header"><div><span className="eyebrow">{editInstitution?'MODO EDICIÓN':isAdmin?'AÑADIR AL CAMPUS':'ROL DOCENTE'}</span><h2><Plus size={19}/>{editInstitution?'Editar institución':isAdmin?'Nueva institución':'Instituciones del campus'}</h2></div></div>
   {isAdmin?<form key={editInstitution?.id??'new'} onSubmit={async e=>{const input=form(e);if(await mutate({...input,action:'institution',id:editInstitution?.id},'Institución guardada.'))setEditInstitution(null);}}><label>Nombre completo<input name="name" required maxLength={150} defaultValue={editInstitution?.name} placeholder="Nombre de la institución"/></label><div className="form-grid"><label>Nombre corto<input name="shortName" required maxLength={35} defaultValue={editInstitution?.shortName} placeholder="Sigla o nombre corto"/></label><label>Ciudad<input name="city" required maxLength={100} defaultValue={editInstitution?.city} placeholder="Ciudad, país"/></label></div><label>Identificador visual<select name="color" defaultValue={editInstitution?.color??'blue'}><option value="blue">Azul</option><option value="green">Verde</option></select></label><Button disabled={busy}><Save size={15}/>Guardar institución</Button>{editInstitution&&<Button type="button" variant="ghost" onClick={()=>setEditInstitution(null)}>Cancelar edición</Button>}</form>:<p className="admin-help">Tu rol docente te permite gestionar las materias y clases de las instituciones existentes. La creación y edición de instituciones está reservada al Administrador.</p>}{isAdmin&&editInstitution&&<form className="logo-upload-form" onSubmit={uploadLogo}><input type="hidden" name="id" value={editInstitution.id}/><label>Logo institucional<input type="file" name="logo" accept=".png,.jpg,.jpeg,.webp" required/><small>PNG, JPG o WebP · hasta 2 MB</small></label><Button disabled={busy} variant="outline"><Upload size={14}/>Actualizar logo</Button></form>}
  </section>
 </div>}
 {activeTab==='subjects'&&currentInstitution&&<><button type="button" className="back-link" onClick={()=>goTab('institutions')}><ChevronLeft size={15}/>Volver a instituciones</button><div className="admin-two-columns">
  <section className="admin-card admin-established">
   <div className="admin-card-header"><div><span className="eyebrow">MATERIAS ESTABLECIDAS · {currentInstitution.shortName}</span><h2><BookOpen size={20}/>Materias de {currentInstitution.shortName}</h2></div><span className="admin-count-badge">{institutionSubjects.length} {institutionSubjects.length===1?'materia':'materias'}</span></div>
   <p className="admin-help">Selecciona una materia para gestionar únicamente sus temas y clases.</p>
   {institutionSubjects.length?<div className="admin-list">{institutionSubjects.map(s=>{const lessonCount=data.lessons.filter(l=>l.subjectId===s.id).length;return <div key={s.id} className={selectedSubject===s.id?'is-active':''}><span className="stat-icon sage"><BookOpen size={17}/></span><div><strong>{s.name}</strong><p>{s.code} · {s.topics.length} {s.topics.length===1?'tema':'temas'} · {lessonCount} {lessonCount===1?'clase':'clases'}</p></div><Button variant="outline" size="sm" onClick={()=>copyInviteLink(s.id)}>{copiedSubject===s.id?<><Check size={14}/>Copiado</>:<><LinkIcon size={14}/>Inscripción</>}</Button><Button variant="ghost" size="sm" onClick={()=>setEditSubject(s)} aria-label={`Editar ${s.name}`}><Pencil size={15}/></Button><Button size="sm" onClick={()=>{setSelectedSubject(s.id);setSelectedTopic('');goTab('topics');}}>Ver temas<ArrowRight size={14}/></Button></div>;})}</div>:<p className="admin-help">Aún no hay materias registradas en {currentInstitution.shortName}. Añade la primera desde el panel derecho.</p>}
  </section>
  <section className="admin-card admin-create">
   <div className="admin-card-header"><div><span className="eyebrow">{editSubject?'MODO EDICIÓN':'AÑADIR A '+currentInstitution.shortName}</span><h2><Plus size={19}/>{editSubject?`Editar materia`:`Nueva materia`}</h2></div></div>
   <form key={editSubject?.id??`new-${currentInstitution.id}`} onSubmit={async e=>{const node=e.currentTarget,input=form(e);if(await mutate({...input,action:'subject',institutionId:currentInstitution.id,id:editSubject?.id},'Materia guardada. Entra a sus temas para organizar sus clases.')){setEditSubject(null);node.reset();}}}><input type="hidden" name="institutionId" value={currentInstitution.id}/><label>Nombre de la materia<input name="name" required maxLength={120} defaultValue={editSubject?.name} placeholder="Ej. Programación en Python"/></label><div className="form-grid"><label>Código<input name="code" required maxLength={40} defaultValue={editSubject?.code} placeholder="Ej. PROG-01"/></label><label>Área visual<select name="icon" defaultValue={editSubject?.icon??'code'}><option value="code">Programación y tecnología</option><option value="robot">Ingeniería y robótica</option></select></label></div><label>Descripción (opcional)<textarea name="description" maxLength={600} rows={2} defaultValue={editSubject?.description} placeholder="Opcional · qué aprenderán los alumnos en esta materia"/></label><Button disabled={busy}><Save size={15}/>Guardar materia</Button>{editSubject&&<Button type="button" variant="ghost" onClick={()=>setEditSubject(null)}>Cancelar edición</Button>}</form>
  </section>
 </div></>}
 {activeTab==='topics'&&currentInstitution&&currentSubject&&<><button type="button" className="back-link" onClick={()=>goTab('subjects')}><ChevronLeft size={15}/>Volver a materias de {currentInstitution.shortName}</button><div className="admin-two-columns">
  <section className="admin-card admin-established admin-topic-manager">
   <div className="admin-card-header"><div><span className="eyebrow">TEMAS ESTABLECIDOS · {currentSubject.code}</span><h2><FolderOpen size={20}/>Temas de {currentSubject.name}</h2></div><span className="admin-count-badge">{subjectTopics.length} {subjectTopics.length===1?'tema':'temas'}</span></div>
   <p className="admin-help">Selecciona un tema para ver o importar únicamente las clases que pertenecen a ese tema.</p>
   {subjectTopics.length?<div className="topic-chips">{subjectTopics.map((t,i)=>{const count=data.lessons.filter(l=>l.subjectId===currentSubject.id&&l.topicId===t.id).length;return <form key={t.id} className={`topic-edit ${selectedTopic===t.id?'is-active':''}`} onSubmit={async e=>{const input=form(e);await mutate({...input,action:'topic',subjectId:currentSubject.id,id:t.id},'Tema actualizado.');}}><span>{String(i+1).padStart(2,'0')}</span><input aria-label={`Nombre del tema ${i+1}`} name="name" required maxLength={120} defaultValue={t.name}/><Button size="sm" variant="outline" disabled={busy}>Guardar</Button><Button type="button" size="sm" variant="ghost" aria-label={`Subir tema ${i+1}`} disabled={busy||i===0} onClick={()=>mutate({action:'moveTopic',subjectId:currentSubject.id,topicId:t.id,direction:'up'},'Orden actualizado.')}><ChevronUp size={14}/></Button><Button type="button" size="sm" variant="ghost" aria-label={`Bajar tema ${i+1}`} disabled={busy||i===subjectTopics.length-1} onClick={()=>mutate({action:'moveTopic',subjectId:currentSubject.id,topicId:t.id,direction:'down'},'Orden actualizado.')}><ChevronDown size={14}/></Button><Button type="button" size="sm" onClick={()=>{setSelectedTopic(t.id);setReplace('');goTab('lessons');}}>Ver clases ({count})<ArrowRight size={14}/></Button></form>;})}</div>:<p className="admin-help">Esta materia aún no tiene temas. Añade el primer tema desde el panel derecho.</p>}
  </section>
  <section className="admin-card admin-create">
   <div className="admin-card-header"><div><span className="eyebrow">AÑADIR A {currentSubject.code}</span><h2><Plus size={19}/>Nuevo tema</h2></div></div>
   <p className="admin-help">Organiza las unidades o módulos temáticos de {currentSubject.name}.</p>
   <form onSubmit={async e=>{const node=e.currentTarget,input=form(e);if(await mutate({...input,action:'topic',subjectId:currentSubject.id},'Tema creado.'))node.reset();}}><label>Nombre del tema<input name="name" required maxLength={120} placeholder="Ej. Funciones y estructuras de datos"/></label><Button disabled={busy}><Plus size={15}/>Añadir tema</Button></form>
  </section>
 </div></>}
 {activeTab==='lessons'&&currentInstitution&&currentSubject&&currentTopic&&<><button type="button" className="back-link" onClick={()=>goTab('topics')}><ChevronLeft size={15}/>Volver a temas de {currentSubject.name}</button><div className="admin-two-columns">
  <section className="admin-card admin-established">
   <div className="admin-card-header"><div><span className="eyebrow">{currentInstitution.shortName} · {currentSubject.code}</span><h2><Layers3 size={20}/>Clases de «{currentTopic.name}»</h2></div><span className="admin-count-badge">{topicLessons.length} {topicLessons.length===1?'clase':'clases'}</span></div>
   <p className="admin-help">Revisa la vista previa, reprocesa recursos o publica las clases construidas en este tema.</p>
   {topicLessons.length?<div className="admin-lesson-list">{topicLessons.map(l=><article key={l.id}><div className="admin-lesson-heading"><div><span className={`status-badge ${l.status}`}>{l.status==='published'?'Publicada':'Borrador'}</span><h3>{l.title}</h3><p>{l.subtitle?`${l.subtitle} · `:''}{l.frames} bloques · Versión {l.revision}</p></div><Button variant="outline" size="sm" asChild><a href={`/?class=${l.id}`} target="_blank" rel="noreferrer"><Eye size={14}/>Vista previa</a></Button></div>{l.diagnostics.length>0&&<details className="review-warnings"><summary><AlertTriangle size={14}/>{l.diagnostics.length} avisos de importación</summary>{l.diagnostics.map((d,i)=><p key={i}>{d}</p>)}</details>}<div className="publication-actions"><Button size="sm" variant="outline" disabled={busy} onClick={()=>repairResources(l.id)}><RefreshCw size={14}/>Reparar recursos</Button>{l.reviewed!==l.revision?<><label className="checkbox-label"><input type="checkbox" checked={!!review[l.id]} onChange={e=>setReview(v=>({...v,[l.id]:e.target.checked}))}/>He revisado la vista previa y los avisos</label><Button size="sm" variant="outline" disabled={busy||!review[l.id]} onClick={()=>mutate({action:'review',lessonId:l.id,acknowledged:review[l.id]},'Revisión completada. Ya puedes publicar la clase.')}><CheckCircle2 size={14}/>Completar revisión</Button></>:<span className="reviewed-label"><CheckCircle2 size={14}/>Versión revisada</span>}{l.status==='published'?<Button size="sm" variant="outline" disabled={busy} onClick={()=>mutate({action:'unpublish',lessonId:l.id},'Clase retirada de la vista del alumno.')}>Volver a borrador</Button>:<Button size="sm" disabled={busy||l.reviewed!==l.revision} onClick={()=>mutate({action:'publish',lessonId:l.id},'Clase publicada para los alumnos asignados a la materia.')}><Globe size={14}/>Publicar clase</Button>}<Button size="sm" variant="outline" className="btn-danger-action" disabled={busy} onClick={()=>{if(window.confirm(`¿Seguro que deseas eliminar la clase «${l.title}»? Esta acción no se puede deshacer.`)){mutate({action:'deleteLesson',lessonId:l.id},'Clase eliminada correctamente.');}}}><Trash2 size={14}/>Eliminar clase</Button></div></article>)}</div>:<p className="admin-help">Aún no hay clases en este tema. Importa un archivo .tex desde el panel derecho para crear la primera clase.</p>}
  </section>
  <section className="admin-card admin-create">
   <div className="admin-card-header"><div><span className="eyebrow">AÑADIR O ACTUALIZAR EN «{currentTopic.name.toUpperCase()}»</span><h2><Upload size={19}/>Importar clase</h2></div></div>
   <p className="admin-help">Carga el archivo .tex; el título y el subtítulo se detectan automáticamente.</p>
   <form onSubmit={importClass}><input type="hidden" name="subjectId" value={currentSubject.id}/><input type="hidden" name="topicId" value={currentTopic.id}/><label>Documento LaTeX (.tex)<input type="file" name="source" accept=".tex" required/><small>Archivo .tex de la clase · hasta 2 MB</small></label><label>PDF e imágenes (opcional)<input type="file" name="images" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple/><small>Opcional · PDF original y figuras (hasta 35 MB)</small></label><label>Título de la clase (opcional)<input name="title" maxLength={150} placeholder="Opcional · se detecta del .tex"/></label>{topicLessons.length>0&&<label>Acción<select name="lessonId" value={replace} onChange={e=>setReplace(e.target.value)}><option value="">Crear nueva clase en este tema</option>{topicLessons.map(l=><option key={l.id} value={l.id}>Actualizar: {l.title}</option>)}</select></label>}{replace&&<p className="admin-help">La versión anterior se sustituirá y la clase volverá a borrador hasta revisar y publicar esta versión.</p>}<Button disabled={busy}><Upload size={15}/>{busy?'Importando y compilando…':'Importar como borrador'}</Button></form>
  </section>
 </div></>}
 {activeTab==='students'&&<div className="admin-two-columns">
  <section className="admin-card admin-established">
   <div className="admin-card-header"><div><span className="eyebrow">COMUNIDAD ESTABLECIDA</span><h2><Users size={20}/>Alumnos y asignaciones</h2></div><span className="admin-count-badge">{students.length} {students.length===1?'alumno':'alumnos'}</span></div>
   
   {pendingRequests.length>0&&<div className="mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800">
    <div className="flex items-center gap-2 font-semibold text-sm text-amber-900 dark:text-amber-200 mb-2">
     <Clock size={16}/> Solicitudes de inscripción a asignaturas ({pendingRequests.length})
    </div>
    <p className="text-xs text-amber-800 dark:text-amber-300 mb-3 leading-relaxed">Alumnos que iniciaron sesión y esperan tu aprobación para inscribirse en su materia:</p>
    <div className="grid gap-2">
     {pendingRequests.map(req=>{const subj=data.subjects.find(s=>s.id===req.subjectId);return <div key={req.id} className="flex items-center justify-between p-2.5 rounded bg-white dark:bg-stone-900 border text-xs"><div><strong>{req.userName}</strong> <span className="text-muted-foreground">({req.username})</span><p className="text-muted-foreground mt-0.5">Asignatura: <span className="font-medium text-foreground">{subj?.name??req.subjectId}</span> ({subj?.code})</p></div><div className="flex gap-1.5"><Button size="sm" disabled={busy} onClick={()=>mutate({action:'approveJoinRequest',requestId:req.id},`Inscripción aceptada para ${req.userName}.`)}><CheckCircle2 size={13}/>Aceptar</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>mutate({action:'rejectJoinRequest',requestId:req.id},'Solicitud rechazada.')}>Rechazar</Button></div></div>;})}
    </div>
   </div>}

   <label>Alumno<select value={student} onChange={e=>{setStudent(e.target.value);setAssigned(data.enrollments.filter(a=>a.userId===e.target.value).map(a=>a.subjectId));}}><option value="">Seleccionar alumno para gestionar sus materias</option>{students.map(u=><option key={u.id} value={u.id}>{u.name} · {u.username}</option>)}</select></label>
   {student?<><div className="assignment-list">{data.subjects.map(s=>{const isBanned=(data.bans??[]).some(b=>b.userId===student&&b.subjectId===s.id);return <div key={s.id} className={`assignment-row ${isBanned?'is-banned':''}`}><label className="checkbox-label"><input type="checkbox" checked={assigned.includes(s.id)} onChange={e=>setAssigned(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/><span><strong>{s.name}</strong><small>{data.institutions.find(i=>i.id===s.institutionId)?.shortName} · {s.code}</small></span></label>{isBanned&&<span className="status-badge draft"><ShieldAlert size={12}/>Baneado en esta materia</span>}</div>;})}</div><Button disabled={busy} onClick={()=>mutate({action:'assign',userId:student,subjectIds:assigned},'Asignaciones guardadas. El alumno verá únicamente estas materias.')}><Save size={15}/>Guardar asignaciones</Button></>:<p className="admin-help">Selecciona un alumno para definir qué materias puede consultar.</p>}
   <div className="admin-list student-list">{students.map(u=>{const userBans=(data.bans??[]).filter(b=>b.userId===u.id);return <div key={u.id} className={student===u.id?'is-active':''}><span className="stat-icon sage"><Users size={16}/></span><div><strong>{u.name}</strong><p>{u.username} · {data.enrollments.filter(a=>a.userId===u.id).length} materias asignadas {userBans.length>0&&<span className="text-red-500 font-semibold">({userBans.length} baneos)</span>}</p></div><div className="flex gap-1.5"><Button variant="outline" size="sm" onClick={()=>{setStudent(u.id);setAssigned(data.enrollments.filter(a=>a.userId===u.id).map(a=>a.subjectId));setBanSubject('');setBanReason('');}}>Gestionar</Button><Button variant="ghost" size="sm" onClick={()=>{setResetUserId(u.id);setNewPassword('');}} title="Restablecer contraseña"><KeyRound size={14}/>Clave</Button></div></div>;})}</div>
   {resetUserId&&students.some(s=>s.id===resetUserId)&&(()=>{const targetUser=students.find(s=>s.id===resetUserId);return <div className="mt-4 p-4 rounded-lg border bg-stone-50 dark:bg-stone-900 flex flex-col gap-2"><strong className="text-xs font-semibold">Restablecer contraseña para el alumno {targetUser?.name}:</strong><div className="flex gap-2"><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Nueva contraseña (mínimo 10 caracteres)" className="text-xs p-2 border rounded flex-1 bg-background" minLength={10}/><Button size="sm" disabled={busy||newPassword.length<10} onClick={async()=>{if(await mutate({action:'resetPassword',userId:resetUserId,password:newPassword},`Contraseña restablecida para el alumno ${targetUser?.name}.`)){setResetUserId('');setNewPassword('');}}}><Save size={14}/>Guardar clave</Button><Button size="sm" variant="ghost" onClick={()=>{setResetUserId('');setNewPassword('');}}>Cancelar</Button></div></div>;})()}
  </section>
  <div className="admin-create-stack">
   {student&&<section className="admin-card admin-moderation">
    <div className="admin-card-header"><div><span className="eyebrow">CONTROL DE ACCESO POR MATERIA (RBAC)</span><h2><Ban size={19}/>Moderar alumno: {students.find(u=>u.id===student)?.name}</h2></div></div>
    <p className="admin-help">Aplica un baneo temporal o disciplinario restringiendo el acceso del alumno a una materia específica sin revocar su matrícula.</p>
    <div className="moderation-ban-form">
     <div className="form-grid">
      <label>Materia a moderar<select value={banSubject} onChange={e=>setBanSubject(e.target.value)}><option value="">Seleccionar materia</option>{data.subjects.filter(s=>assigned.includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></label>
      <label>Motivo del baneo (opcional)<input value={banReason} onChange={e=>setBanReason(e.target.value)} placeholder="Ej. Falta de entrega, conducta o sanción" maxLength={200}/></label>
     </div>
     <div className="flex gap-2 mt-2">
      <Button disabled={busy||!banSubject} onClick={async()=>{if(await mutate({action:'banStudent',userId:student,subjectId:banSubject,reason:banReason},'Alumno baneado de la materia.')){setBanReason('');setBanSubject('');}}}><ShieldAlert size={14}/>Banear de la materia</Button>
     </div>
    </div>
    {(()=>{const studentBans=(data.bans??[]).filter(b=>b.userId===student);return studentBans.length>0?<div className="mt-4 border-t pt-3"><strong className="text-xs font-semibold block mb-2">Materias bloqueadas actualmente para este alumno:</strong><div className="admin-list">{studentBans.map(b=>{const subj=data.subjects.find(s=>s.id===b.subjectId);return <div key={b.subjectId} className="flex items-center justify-between py-2 border-b"><div><strong>{subj?.name??b.subjectId}</strong><p className="text-xs text-muted-foreground">{b.reason?`Motivo: ${b.reason} · `:''}Fecha: {new Date(b.bannedAt).toLocaleDateString()}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={()=>mutate({action:'unbanStudent',userId:student,subjectId:b.subjectId},'Baneo removido con éxito.')}><ShieldCheck size={14}/>Levantar baneo</Button></div>;})}</div></div>:null;})()}
   </section>}
   <section className="admin-card admin-create">
    <div className="admin-card-header"><div><span className="eyebrow">AÑADIR INDIVIDUALMENTE</span><h2><Plus size={19}/>Crear cuenta de alumno</h2></div></div>
    <p className="admin-help">Asigna obligatoriamente una institución y al menos una materia (Principio de mínimo privilegio).</p>
    <form onSubmit={async e=>{
      const node=e.currentTarget,input=form(e);
      const instId=newStudentInstitution||(data.institutions.length===1?data.institutions[0].id:'');
      if(!instId&&newStudentSubjectIds.length===0){
        setError('Debes asignar al alumno a una institución o al menos a una materia.');
        return;
      }
      if(newStudentSubjectIds.length===0){
        setError('Debes seleccionar al menos una materia para matricular al alumno.');
        return;
      }
      if(await mutate({...input,action:'student',institutionId:instId,subjectIds:newStudentSubjectIds},'Cuenta de alumno creada y matriculada correctamente.')){
        node.reset();
        setNewStudentSubjectIds([]);
      }
    }}>
      <label>Nombre completo<input name="name" required maxLength={100} autoComplete="off" placeholder="Ej. Carlos Mendoza"/></label>
      <label>Usuario o correo<input name="username" required minLength={3} maxLength={100} autoComplete="off" placeholder="carlos.mendoza@correo.com"/></label>
      <label>Contraseña inicial<input name="password" type="password" required minLength={10} maxLength={256} autoComplete="new-password" placeholder="Mínimo 10 caracteres"/><small>Mínimo 10 caracteres. Comunica las credenciales al alumno por tu canal habitual.</small></label>
      <label>Institución asignada
        <select value={newStudentInstitution||(data.institutions.length===1?data.institutions[0].id:'')} onChange={e=>{
          setNewStudentInstitution(e.target.value);
          setNewStudentSubjectIds([]);
        }} required>
          {data.institutions.length>1&&<option value="">Seleccionar institución</option>}
          {data.institutions.map(i=><option key={i.id} value={i.id}>{i.name} ({i.shortName})</option>)}
        </select>
      </label>
      {(()=>{
        const currentTargetInst=newStudentInstitution||(data.institutions.length===1?data.institutions[0].id:'');
        const availSubs=currentTargetInst?data.subjects.filter(s=>s.institutionId===currentTargetInst):data.subjects;
        return <fieldset className="mt-2 p-3 border rounded-lg bg-stone-50 dark:bg-stone-900/40">
          <legend className="text-xs font-semibold px-1">Materias a matricular (mínimo 1 requerida)</legend>
          {availSubs.length>0?<div className="grid gap-2 mt-1">
            {availSubs.map(s=><label key={s.id} className="checkbox-label text-xs flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={newStudentSubjectIds.includes(s.id)} onChange={ev=>setNewStudentSubjectIds(ids=>ev.target.checked?[...ids,s.id]:ids.filter(x=>x!==s.id))}/>
              <span><strong>{s.name}</strong> <span className="text-muted-foreground">({s.code})</span></span>
            </label>)}
          </div>:<p className="text-xs text-muted-foreground">Esta institución no tiene materias registradas.</p>}
        </fieldset>;
      })()}
      <Button disabled={busy}><Plus size={15}/>Crear alumno</Button>
    </form>
   </section>
   <StudentImport subjects={data.subjects} onImported={async()=>{await Promise.all([refresh(),onCatalogChange()]);setStudent('');setAssigned([]);}}/>
  </div>
 </div>}
 {activeTab==='teachers'&&isAdmin&&<div className="admin-two-columns">
  <section className="admin-card admin-established">
   <div className="admin-card-header"><div><span className="eyebrow">EQUIPO DEL CAMPUS</span><h2><GraduationCap size={20}/>Profesores y Administradores</h2></div><span className="admin-count-badge">{teachers.length + admins.length} usuarios</span></div>
   <p className="admin-help">Docentes autorizados para impartir y gestionar clases en el campus.</p>
   <div className="admin-list">
    {admins.map(a=><div key={a.id} className="is-active"><span className="stat-icon sand"><Shield size={16}/></span><div><strong>{a.name}</strong><p>{a.username} · <span className="font-semibold text-primary">Super Administrador (Acceso global)</span></p></div><Button variant="outline" size="sm" onClick={()=>{setResetUserId(a.id);setNewPassword('');}}><KeyRound size={14}/>Clave</Button></div>)}
    {teachers.map(t=>{
      const userInsts=(data.institutionMembers??[]).filter(im=>im.userId===t.id).map(im=>data.institutions.find(i=>i.id===im.institutionId)?.shortName).filter(Boolean);
      const userSubs=data.enrollments.filter(e=>e.userId===t.id).length;
      const instLabel=userInsts.length>0?userInsts.join(', '):'Sin institución asignada';
      return <div key={t.id}><span className="stat-icon sage"><GraduationCap size={16}/></span><div><strong>{t.name}</strong><p>{t.username} · Docente · <span className="font-medium text-foreground">{instLabel}</span> {userSubs>0?`(${userSubs} ${userSubs===1?'materia':'materias'})`:''}</p></div><Button variant="outline" size="sm" onClick={()=>{setResetUserId(t.id);setNewPassword('');}}><KeyRound size={14}/>Clave</Button></div>;
    })}
   </div>
   {resetUserId&&(teachers.some(t=>t.id===resetUserId)||admins.some(a=>a.id===resetUserId))&&(()=>{const targetUser=data.users.find(u=>u.id===resetUserId);return <div className="mt-4 p-4 rounded-lg border bg-stone-50 dark:bg-stone-900 flex flex-col gap-2"><strong className="text-xs font-semibold">Restablecer contraseña para {targetUser?.name}:</strong><div className="flex gap-2"><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Nueva contraseña (mínimo 10 caracteres)" className="text-xs p-2 border rounded flex-1 bg-background" minLength={10}/><Button size="sm" disabled={busy||newPassword.length<10} onClick={async()=>{if(await mutate({action:'resetPassword',userId:resetUserId,password:newPassword},`Contraseña actualizada para ${targetUser?.name}.`)){setResetUserId('');setNewPassword('');}}}><Save size={14}/>Guardar clave</Button><Button size="sm" variant="ghost" onClick={()=>{setResetUserId('');setNewPassword('');}}>Cancelar</Button></div></div>;})()}
  </section>
  <section className="admin-card admin-create">
   <div className="admin-card-header"><div><span className="eyebrow">NUEVO INTEGRANTE</span><h2><Plus size={19}/>Registrar nuevo profesor</h2></div></div>
   <p className="admin-help">Crea una cuenta docente asignándole una institución o materias específicas (Principio de mínimo privilegio: solo tendrá acceso a su institución asignada).</p>
   <form onSubmit={async e=>{
     const node=e.currentTarget,input=form(e);
     if(!teacherInstitution&&teacherSubjectIds.length===0){
       setError('Debes asignar al docente a una institución o al menos a una materia.');
       return;
     }
     if(await mutate({...input,action:'teacher',institutionId:teacherInstitution,subjectIds:teacherSubjectIds},'Profesor registrado y asignado con éxito.')){
       node.reset();
       setTeacherInstitution('');
       setTeacherSubjectIds([]);
     }
   }}>
     <label>Nombre completo<input name="name" required maxLength={100} placeholder="Ej. Prof. Andrea Gómez" autoComplete="off"/></label>
     <label>Correo o usuario docente<input name="username" required minLength={3} maxLength={100} placeholder="andrea.gomez@campus.edu" autoComplete="off"/></label>
     <label>Contraseña inicial<input name="password" type="password" required minLength={10} maxLength={256} placeholder="Mínimo 10 caracteres" autoComplete="new-password"/><small>Mínimo 10 caracteres. Entrega las credenciales al docente para su primer ingreso.</small></label>
     <label>Institución asignada
       <select value={teacherInstitution} onChange={e=>{
         setTeacherInstitution(e.target.value);
         setTeacherSubjectIds([]);
       }} required>
         <option value="">Seleccionar institución asignada</option>
         {data.institutions.map(i=><option key={i.id} value={i.id}>{i.name} ({i.shortName})</option>)}
       </select>
     </label>
     {teacherInstitution&&(()=>{
       const availSubs=data.subjects.filter(s=>s.institutionId===teacherInstitution);
       return <fieldset className="mt-2 p-3 border rounded-lg bg-stone-50 dark:bg-stone-900/40">
         <legend className="text-xs font-semibold px-1">Materias asignadas (opcional: si no marcas ninguna, tendrá acceso a todas las de la institución)</legend>
         {availSubs.length>0?<div className="grid gap-2 mt-1">
           {availSubs.map(s=><label key={s.id} className="checkbox-label text-xs flex items-center gap-2 cursor-pointer">
             <input type="checkbox" checked={teacherSubjectIds.includes(s.id)} onChange={ev=>setTeacherSubjectIds(ids=>ev.target.checked?[...ids,s.id]:ids.filter(x=>x!==s.id))}/>
             <span><strong>{s.name}</strong> <span className="text-muted-foreground">({s.code})</span></span>
           </label>)}
         </div>:<p className="text-xs text-muted-foreground">Esta institución aún no tiene materias registradas.</p>}
       </fieldset>;
     })()}
     <Button disabled={busy}><Plus size={15}/>Registrar profesor</Button>
   </form>
  </section>
 </div>}
 </main>;
}
