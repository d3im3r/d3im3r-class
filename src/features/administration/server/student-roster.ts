import ExcelJS from 'exceljs';
import {createHash,randomUUID,randomBytes,scrypt} from 'node:crypto';
import {db,transaction,syncBetterAuthUser,userAccessibleSubjectIds} from './database';
import {AppError} from '@/features/auth/server/auth';
import type {User} from '@/features/auth/types';
export type RosterRow={row:number;name:string;email:string;status:'ready'|'existing'|'error';issue?:string;identificationLength:number;warning?:string};
type PrivateRow=RosterRow&{identification:string};
export type RosterPreview={rows:RosterRow[];ready:number;existing:number;errors:number;total:number;fingerprint:string};
function archiveLimit(buffer:Buffer){
 if(buffer.length>2*1024*1024||buffer.readUInt32LE(0)!==0x04034b50)throw new AppError('Selecciona un archivo Excel .xlsx de hasta 2 MB.');
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new AppError('El archivo Excel no es válido.');const count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16),size=0;
 if(count>1000)throw new AppError('El archivo contiene demasiados elementos. Usa la plantilla de alumnos.');
 for(let i=0;i<count;i++){if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw new AppError('No se pudo leer el archivo Excel.');size+=buffer.readUInt32LE(offset+24);if(size>20*1024*1024)throw new AppError('El contenido del archivo Excel es demasiado grande.');offset+=46+buffer.readUInt16LE(offset+28)+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);}
}
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
function value(cell:ExcelJS.Cell,identifier=false){const raw=cell.value;if(raw===null||raw===undefined)return '';if(typeof raw==='string')return raw.trim();if(typeof raw==='number'){if(!Number.isSafeInteger(raw)||raw<0)throw new Error('Guarda la identificación como texto, sin decimales ni notación científica.');const str=String(raw);return identifier&&/^0+$/.test(cell.numFmt)?str.padStart(cell.numFmt.length,'0'):str;}if(typeof raw==='object'&&'richText'in raw)return raw.richText.map(s=>s.text).join('').trim();if(typeof raw==='object'&&'hyperlink'in raw&&!identifier)return String(raw.text??'').trim();throw new Error('Usa valores de texto, sin fórmulas ni fechas.');}
async function parseRoster(buffer:Buffer):Promise<{rows:PrivateRow[];fingerprint:string}>{
 if(buffer.length<22)throw new AppError('El archivo Excel está vacío o no es válido.');archiveLimit(buffer);const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);}catch{throw new AppError('No se pudo leer el .xlsx. Guarda el archivo nuevamente como Libro de Excel.');}
 const sheet=workbook.worksheets[0];if(!sheet)throw new AppError('El archivo no contiene hojas.');if(sheet.rowCount>501)throw new AppError('Importa un máximo de 500 alumnos por archivo.');
 const columns:Partial<Record<'name'|'email'|'identification',number>>={};sheet.getRow(1).eachCell((cell,index)=>{const header=normalize(cell.text);if(['nombre','nombrecompleto','nombres'].includes(header))columns.name=index;if(['correo','email','correoelectronico'].includes(header))columns.email=index;if(['identificacion','documento','cedula','dni'].includes(header))columns.identification=index;});
 if(!columns.name||!columns.email||!columns.identification)throw new AppError('La primera fila debe tener las columnas nombre, correo e identificación.');
 const rows:PrivateRow[]=[],emails=new Set<string>(),identifications=new Set<string>();
 for(let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber++){const row=sheet.getRow(rowNumber);if([columns.name,columns.email,columns.identification].every(column=>!row.getCell(column!).value))continue;
  let name='',email='',identification='',issue='',warning:string|undefined;
  try{name=value(row.getCell(columns.name));email=value(row.getCell(columns.email)).toLowerCase();identification=value(row.getCell(columns.identification),true);if(typeof row.getCell(columns.identification).value==='number')warning='Identificación numérica: comprueba que no faltan ceros iniciales en el archivo.';}catch(error){issue=error instanceof Error?error.message:'Fila no válida.';}
  if(!issue&&(!name||name.length>100))issue='El nombre es obligatorio y debe tener hasta 100 caracteres.';
  if(!issue&&(!/^[a-z0-9][a-z0-9._+\-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)||email.length>100))issue='El correo no es válido.';
  if(!issue&&(!/^[a-z0-9._-]{1,64}$/i.test(identification)))issue='La identificación es obligatoria: usa hasta 64 letras, números, puntos o guiones.';
  if(!issue&&emails.has(email))issue='El correo está repetido en el archivo.';
  if(!issue&&identifications.has(identification))issue='La identificación está repetida en el archivo.';
  const existing=email?db().prepare('SELECT role FROM users WHERE username=?').get(email):undefined;if(!issue&&(existing?.role==='teacher'||existing?.role==='admin'))issue='El correo ya pertenece a una cuenta docente o administrativa.';
  if(email)emails.add(email);if(identification)identifications.add(identification);
  rows.push({row:rowNumber,name,email,identification,identificationLength:identification.length,status:issue?'error':existing?'existing':'ready',issue:issue||undefined,warning});
 }
 if(!rows.length)throw new AppError('No se encontraron alumnos. Completa las filas debajo del encabezado.');return {rows,fingerprint:createHash('sha256').update(buffer).digest('hex')};
}
export async function previewRoster(buffer:Buffer):Promise<RosterPreview>{const {rows,fingerprint}=await parseRoster(buffer);return {rows:rows.map(({identification:_,...row})=>row),fingerprint,total:rows.length,ready:rows.filter(r=>r.status==='ready').length,existing:rows.filter(r=>r.status==='existing').length,errors:rows.filter(r=>r.status==='error').length};}
async function hashIdentification(value:string){const salt=randomBytes(16).toString('hex');const key=await new Promise<Buffer>((resolve,reject)=>scrypt(value,salt,64,(error,key)=>error?reject(error):resolve(key)));return salt+':'+key.toString('hex');}
export async function importRoster(buffer:Buffer,input:{fingerprint:string;subjectIds:string[];skipErrors:boolean;enrollExisting:boolean},actor?:User){
 const {rows,fingerprint}=await parseRoster(buffer);if(fingerprint!==input.fingerprint)throw new AppError('El archivo cambió. Revisa la vista previa nuevamente.',409);if(rows.some(r=>r.status==='error')&&!input.skipErrors)throw new AppError('Corrige las filas con errores o confirma que deseas omitirlas.');
 const ids=[...new Set(input.subjectIds)];if(ids.length>200||ids.some(id=>typeof id!=='string'||!db().prepare('SELECT id FROM subjects WHERE id=?').get(id)))throw new AppError('Selecciona materias válidas.');
 if(actor&&actor.role==='teacher'){
  const allowed=userAccessibleSubjectIds(actor);
  for(const id of ids){
   if(!allowed||!allowed.has(id))throw new AppError('No tienes permiso para matricular alumnos en materias que no impartes.',403);
  }
 }
 const ready=rows.filter(r=>r.status==='ready');if(!ready.length&&!(input.enrollExisting&&rows.some(r=>r.status==='existing')))throw new AppError('No hay alumnos nuevos para importar.');
 const hashes=new Map<number,string>();let next=0;await Promise.all(Array.from({length:Math.min(4,ready.length)},async()=>{while(next<ready.length){const row=ready[next++];hashes.set(row.row,await hashIdentification(row.identification));}}));
 return transaction(()=>{let created=0,enrolled=0;for(const row of rows){if(row.status==='error')continue;let user=db().prepare('SELECT id,role FROM users WHERE username=?').get(row.email);
  if(row.status==='ready'){if(user)throw new AppError('Un correo fue registrado durante la importación. Actualiza la vista previa.',409);const id=randomUUID(),hashed=hashes.get(row.row)!;db().prepare("INSERT INTO users(id,name,username,password,role) VALUES (?,?,?,?,'student')").run(id,row.name,row.email,hashed);syncBetterAuthUser(id,row.name,row.email,hashed,'student');user={id,role:'student'};created++;}
  else if(!input.enrollExisting)continue;
  if(!user||user.role!=='student')throw new AppError('Una cuenta cambió durante la importación. Revisa el archivo nuevamente.',409);
  for(const id of ids){const result=db().prepare('INSERT OR IGNORE INTO enrollments VALUES (?,?)').run(user.id as string,id);enrolled+=Number(result.changes);}
 }
 return {created,enrolled,skippedErrors:rows.filter(r=>r.status==='error').length,existing:rows.filter(r=>r.status==='existing').length};});
}
export async function rosterTemplate(){const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Alumnos');sheet.columns=[{header:'nombre',key:'name',width:35},{header:'correo',key:'email',width:38},{header:'identificacion',key:'identification',width:25}];sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}};sheet.getRow(1).height=25;sheet.getColumn(3).numFmt='@';sheet.autoFilter='A1:C1';const info=book.addWorksheet('Instrucciones');info.getColumn(1).width=100;info.addRows([['Completa la hoja Alumnos: una fila por estudiante.'],['nombre: nombre completo.'],['correo: será el usuario de acceso.'],['identificacion: será la contraseña inicial; guarda este dato como texto para conservar ceros iniciales.'],['No uses fórmulas. Máximo 500 alumnos por archivo.'],['Los correos existentes no se sobrescriben ni cambian su contraseña.']]);return book.xlsx.writeBuffer();}
