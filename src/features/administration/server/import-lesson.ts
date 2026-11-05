import {existsSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseLatex,extractLatexMetadata} from '@/features/latex-import/lib/parser';
import type {Subject,Lesson,Block} from '@/features/catalog/model/types';
import type {User} from '@/features/auth/types';
import {db,dataDirectory,transaction,lessonRecord,userAccessibleSubjectIds,getPgPool} from './database';
import {sharedImage,cachedDiagramPath,cacheDiagram} from './shared-resource';
import {AppError,text} from '@/features/auth/server/auth';
type Resource={key:string;name:string;path:string;mime:string};
const types:Record<string,string>={'.pdf':'application/pdf','.tex':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
function cropSvgViewBox(svg: string): string {
 const coords: [number, number][] = [];
 const pathMatches = svg.matchAll(/\bd="([^"]+)"/g);
 for (const m of pathMatches) {
  const numbers = m[1].match(/-?[\d.]+/g);
  if (numbers) {
   for (let i = 0; i < numbers.length - 1; i += 2) {
    const x = parseFloat(numbers[i]), y = parseFloat(numbers[i + 1]);
    if (!isNaN(x) && !isNaN(y)) coords.push([x, y]);
   }
  }
 }
 const textMatches = svg.matchAll(/x="([^"]+)"\s+y="([^"]+)"/g);
 for (const m of textMatches) {
  const x = parseFloat(m[1]), y = parseFloat(m[2]);
  if (!isNaN(x) && !isNaN(y)) coords.push([x, y]);
 }
 if (!coords.length) return svg;
 const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
 const minX = Math.min(...xs) - 8, maxX = Math.max(...xs) + 8;
 const minY = Math.min(...ys) - 8, maxY = Math.max(...ys) + 8;
 const width = Math.max(10, maxX - minX), height = Math.max(10, maxY - minY);
 return svg
  .replace(/viewBox="[^"]+"/, `viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}"`)
  .replace(/width="[^"]+"/, `width="${width.toFixed(2)}"`)
  .replace(/height="[^"]+"/, `height="${height.toFixed(2)}"`);
}

export async function compileTikzWithTikzjax(figures: string[], output: string): Promise<{ results: Record<string, string>; errors: { hash: string; message: string; log?: string; line?: number }[] }> {
 const results: Record<string, string> = {};
 const errors: { hash: string; message: string; log?: string; line?: number }[] = [];
 let preambleColors = '';
 try {
  const p = path.join(process.cwd(), 'content/resources/latex/diagram-preamble.tex');
  if (existsSync(p)) {
   const c = await readFile(p, 'utf8');
   preambleColors = c.split('\n').filter(l => l.startsWith('\\definecolor') || l.startsWith('\\usetikzlibrary')).join('\n');
  }
 } catch {}

 const tikzjax = (await import('node-tikzjax')).default;

 for (const source of figures) {
  const hash = createHash('sha256').update(source).digest('hex');
  const cached = cachedDiagramPath(hash);
  if (cached) {
   results[hash] = cached;
   continue;
  }
  if (/\b(?:input|write|openin|openout|read|catcode)\b/i.test(source) || /\^\^/.test(source)) {
   errors.push({ hash, message: 'Diagrama 1: comandos que requieren revisión: input' });
   continue;
  }
  try {
   const full = `\\begin{document}\n${preambleColors}\n${source}\n\\end{document}`;
   const svg = cropSvgViewBox(await tikzjax(full));
   const dest = path.join(output, `${hash}.svg`);
   await writeFile(dest, svg);
   const cachedDest = cacheDiagram(hash, dest);
   try {
    const inPublic = path.join(process.cwd(), 'public/assets/diagrams', `${hash}.svg`);
    await writeFile(inPublic, svg);
   } catch {}
   results[hash] = cachedDest;
  } catch (err) {
   errors.push({
    hash,
    message: err instanceof Error ? err.message : 'Error al compilar diagrama con TikZJax',
   });
  }
 }
 return { results, errors };
}

export function compileFigures(figures:string[],output:string):Promise<{results:Record<string,string>;errors:{hash:string;message:string;log?:string;line?:number}[]}>{
 const cachedResults:Record<string,string>={},pending:string[]=[];
 for(const source of new Set(figures)){
  const hash=createHash('sha256').update(source).digest('hex'),cached=cachedDiagramPath(hash);
  if(cached)cachedResults[hash]=cached;else pending.push(source);
 }
 if(!pending.length)return Promise.resolve({results:cachedResults,errors:[]});
 return new Promise((resolve,reject)=>{
  const child=spawn('python3',['scripts/compile-upload.py'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
  let result='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new AppError('La compilación superó el tiempo permitido. Reduce la cantidad de diagramas.'));},180000);
  child.stdout.on('data',data=>{result+=data.toString();});
  child.stderr.on('data',()=>{});
  child.on('error',async()=>{
   clearTimeout(timer);
   try{
    const fallback=await compileTikzWithTikzjax(pending,output);
    resolve({results:{...cachedResults,...fallback.results},errors:fallback.errors});
   }catch{
    resolve({results:cachedResults,errors:pending.map(source=>({hash:createHash('sha256').update(source).digest('hex'),message:'No está disponible el compilador de diagramas.'}))});
   }
  });
  child.on('close',async(code)=>{
   clearTimeout(timer);
   if(code!==0){
    try{
     const fallback=await compileTikzWithTikzjax(pending,output);
     resolve({results:{...cachedResults,...fallback.results},errors:fallback.errors});
     return;
    }catch{
     reject(new AppError('No se pudo procesar la compilación de diagramas.'));
     return;
    }
   }
   try{
    const parsed=JSON.parse(result) as {results:Record<string,string>;errors:{hash:string;message:string;log?:string;line?:number}[]};
    for(const [hash,file] of Object.entries(parsed.results))cachedResults[hash]=cacheDiagram(hash,file);
    if(parsed.errors.length){
     const failedHashes=new Set(parsed.errors.map(e=>e.hash));
     const failedSources=pending.filter(s=>failedHashes.has(createHash('sha256').update(s).digest('hex')));
     if(failedSources.length){
      try{
       const fallback=await compileTikzWithTikzjax(failedSources,output);
       for(const [h,f] of Object.entries(fallback.results))cachedResults[h]=f;
       const stillFailed=parsed.errors.filter(e=>!fallback.results[e.hash]);
       resolve({results:cachedResults,errors:stillFailed});
       return;
      }catch{}
     }
    }
    resolve({results:cachedResults,errors:parsed.errors});
   }catch{
    try{
     const fallback=await compileTikzWithTikzjax(pending,output);
     resolve({results:{...cachedResults,...fallback.results},errors:fallback.errors});
    }catch{
     reject(new AppError('La compilación no produjo un resultado válido.'));
    }
   }
  });
  child.stdin.end(JSON.stringify({figures:pending,output}));
 });
}
export async function importLesson(form:FormData,actor?:User){
 const subjectId=text(form.get('subjectId'),'Materia');
 if(actor&&actor.role==='teacher'){
  const allowed=userAccessibleSubjectIds(actor);
  if(!allowed||!allowed.has(subjectId))throw new AppError('No tienes permiso para importar clases en esta materia.',403);
 }
 const row=db().prepare('SELECT data FROM subjects WHERE id=?').get(subjectId);if(!row)throw new AppError('Materia no encontrada.');const subject=JSON.parse(row.data as string) as Subject;
 const rawTopic=typeof form.get('topicId')==='string'?String(form.get('topicId')).trim():'';
 let topicId=rawTopic,createdGeneralTopic=false;
 if(!topicId||(!subject.topics.length&&topicId==='general')){
  if(subject.topics.length){topicId=subject.topics[0].id;}
  else{topicId='general';subject.topics.push({id:'general',name:'General'});createdGeneralTopic=true;}
 }else if(!subject.topics.some(t=>t.id===topicId))throw new AppError('Selecciona un tema de la materia.');
 const rawTitle=typeof form.get('title')==='string'?String(form.get('title')).trim():'',rawSubtitle=typeof form.get('subtitle')==='string'?String(form.get('subtitle')).trim():'';
 const existingId=form.get('lessonId');const existing=typeof existingId==='string'&&existingId?lessonRecord(existingId):undefined;if(existingId&&!existing)throw new AppError('Clase no encontrada.',404);if(existing&&existing.subject_id!==subjectId)throw new AppError('La clase debe conservar su materia.');
 const tex=form.get('source'),rawPdf=form.get('pdf');if(!(tex instanceof File)||!tex.name.toLowerCase().endsWith('.tex')||tex.size>2*1024*1024)throw new AppError('Selecciona un archivo .tex de hasta 2 MB.');
 const allExtras=form.getAll('images').filter((f):f is File=>f instanceof File&&f.size>0);
 const extraPdfs=allExtras.filter(f=>f.name.toLowerCase().endsWith('.pdf'));
 const extras=allExtras.filter(f=>!f.name.toLowerCase().endsWith('.pdf'));
 if(extraPdfs.length+(rawPdf instanceof File&&rawPdf.size>0?1:0)>1)throw new AppError('Solo puedes adjuntar un archivo PDF por clase.');
 const pdf=rawPdf instanceof File&&rawPdf.size>0?rawPdf:extraPdfs[0];
 if(extras.length>30)throw new AppError('Puedes cargar hasta 30 imágenes por clase.');
 const uploads=[tex,...(pdf instanceof File&&pdf.size>0?[pdf]:[]),...extras];if(uploads.reduce((n,f)=>n+f.size,0)>35*1024*1024)throw new AppError('El total de archivos debe ser menor a 35 MB.');
 if(pdf instanceof File&&pdf.size>0&&(!pdf.name.toLowerCase().endsWith('.pdf')||!(await pdf.text()).startsWith('%PDF-')))throw new AppError('El PDF no es válido.');
 const names=new Set<string>();for(const f of uploads){const name=path.basename(f.name.replace(/\\/g,'/')).toLowerCase();if(names.has(name))throw new AppError('Los archivos de una clase deben tener nombres diferentes.');names.add(name);if(!types[path.extname(name)]||f.size>20*1024*1024)throw new AppError('Formato o tamaño de archivo no admitido. Usa .tex, .pdf, PNG, JPG o WebP.');}
 const source=await tex.text();if(!source.includes('\\begin{document}'))throw new AppError('El archivo debe contener un documento LaTeX completo.');let parsed;try{parsed=parseLatex(source);}catch{throw new AppError('No se pudo interpretar el .tex. Revisa llaves y entornos sin cerrar.');}if(!parsed.frames.length)throw new AppError('No se encontraron diapositivas frame en el documento.');
 const meta=extractLatexMetadata(source,tex.name);
 const title=(rawTitle||meta.title||parsed.frames[0]?.title||'Nueva clase').slice(0,150),subtitle=(rawSubtitle||meta.subtitle).slice(0,200);
 const id=existing?.id??randomUUID(),revision=(existing?.revision??0)+1,folder=path.join(dataDirectory(),'uploads',id,randomUUID());await mkdir(folder,{recursive:true,mode:0o700});const resources:Resource[]=[];
 const previousLesson=existing?JSON.parse(existing.data) as Lesson:undefined;
 const previousResources=existing?(db().prepare('SELECT key,name,path,mime FROM resources WHERE lesson_id=?').all(id) as Resource[]).filter(r=>existsSync(r.path)):[];
 async function register(file:File){
  const name=path.basename(file.name.replace(/\\/g,'/')),ext=path.extname(name).toLowerCase(),bytes=Buffer.from(await file.arrayBuffer());
  const key=createHash('sha256').update(name.toLowerCase()).update('\0').update(bytes).digest('hex').slice(0,24);
  const reused=previousResources.find(r=>r.key===key&&existsSync(r.path));
  const dest=reused?reused.path:path.join(folder,key+ext);
  if(!reused)await writeFile(dest,bytes,{mode:0o600});
  const resource={key,name,path:dest,mime:types[ext]};resources.push(resource);return `/api/materials/${id}/${key}`;
 }
 const sourceUrl=await register(tex);
 let pdfUrl='';
 if(pdf instanceof File&&pdf.size>0){pdfUrl=await register(pdf);}
 else if(previousLesson?.pdf){const prevKey=previousLesson.pdf.split('/').at(-1),prevPdf=previousResources.find(r=>r.key===prevKey&&r.mime==='application/pdf');if(prevPdf){resources.push(prevPdf);pdfUrl=`/api/materials/${id}/${prevPdf.key}`;}}
 const images=new Map<string,string>();for(const f of extras)images.set(path.basename(f.name.replace(/\\/g,'/')).toLowerCase(),await register(f));
 const figures:string[]=[];function walk(blocks:Block[],action:(b:Block)=>void){for(const b of blocks){action(b);if(b.children)walk(b.children,action);if(b.items)for(const item of b.items)walk(item,action);}}
 const diagnostics=new Set(parsed.diagnostics);
 for(const f of parsed.frames)walk(f.blocks,b=>{if(b.type==='diagram')figures.push(b.content);});if(figures.length>60)throw new AppError('Esta versión permite hasta 60 diagramas por clase.');
 const compiled=figures.length?await compileFigures([...new Set(figures)],folder):{results:{},errors:[]};const figureUrls:Record<string,string>={};
 for(const [hash,file] of Object.entries(compiled.results)){const key='diag-'+hash.slice(0,20);resources.push({key,name:'diagrama-'+hash.slice(0,8)+'.svg',path:file,mime:'image/svg+xml'});figureUrls[hash]=`/api/materials/${id}/${key}`;}
 for(const error of compiled.errors)diagnostics.add(error.message);
 for(const f of parsed.frames)walk(f.blocks,b=>{if(b.type==='diagram')b.asset=figureUrls[createHash('sha256').update(b.content).digest('hex')];if(b.type==='image'){const name=path.basename(b.content.replace(/\\/g,'/')).toLowerCase();b.asset=images.get(name);if(!b.asset){const prevImg=previousResources.find(r=>r.name.toLowerCase()===name&&r.mime.startsWith('image/'));if(prevImg){resources.push(prevImg);b.asset=`/api/materials/${id}/${prevImg.key}`;images.set(name,b.asset);}else{const shared=sharedImage(b.content);if(shared){resources.push(shared);b.asset=`/api/materials/${id}/${shared.key}`;images.set(name,b.asset);}else diagnostics.add(`Falta la imagen: ${b.content}`);}}}});
 if(!pdfUrl)diagnostics.add('No se adjuntó el PDF original.');
 const lesson:Lesson={id,title,subtitle,institutionId:subject.institutionId,subjectId,topicId,source:sourceUrl,pdf:pdfUrl,frames:parsed.frames,diagnostics:[...diagnostics]};
 transaction(()=>{const latest=lessonRecord(id);if(existing&&latest?.revision!==existing.revision)throw new AppError('La clase cambió durante la importación. Vuelve a intentarlo.',409);if(createdGeneralTopic)db().prepare('UPDATE subjects SET data=? WHERE id=?').run(JSON.stringify(subject),subject.id);db().prepare("INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES (?,?,'draft',?,0,?) ON CONFLICT(id) DO UPDATE SET status='draft',revision=excluded.revision,reviewed=0,data=excluded.data").run(id,subjectId,revision,JSON.stringify(lesson));if(existing)db().prepare('DELETE FROM progress WHERE lesson_id=?').run(id);db().prepare('DELETE FROM resources WHERE lesson_id=?').run(id);for(const r of resources)db().prepare('INSERT OR REPLACE INTO resources VALUES (?,?,?,?,?)').run(id,r.key,r.name,r.path,r.mime);});
 const pool=getPgPool();
 if(pool){
  if(createdGeneralTopic){
   pool.query('UPDATE subjects SET data=$1 WHERE id=$2',[JSON.stringify(subject),subject.id]).catch(console.error);
  }
  pool.query("INSERT INTO lessons(id,subject_id,status,revision,reviewed,data) VALUES ($1,$2,'draft',$3,0,$4) ON CONFLICT(id) DO UPDATE SET status='draft',revision=EXCLUDED.revision,reviewed=0,data=EXCLUDED.data",[id,subjectId,revision,JSON.stringify(lesson)]).then(()=>{
   for(const r of resources){
    pool.query('INSERT INTO resources(lesson_id,key,name,path,mime) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(lesson_id,key) DO UPDATE SET name=EXCLUDED.name,path=EXCLUDED.path,mime=EXCLUDED.mime',[id,r.key,r.name,r.path,r.mime]).catch(console.error);
   }
  }).catch(console.error);
 }
 return {id,frames:lesson.frames.length,diagnostics:lesson.diagnostics};
}
