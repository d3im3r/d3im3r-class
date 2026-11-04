import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compileFigures} from '@/features/administration/server/import-lesson';
import {AppError} from '@/features/auth/server/auth';
let running=false;
export async function testTikz(source:unknown){
 if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>50000)throw new AppError('Introduce un diagrama TikZ de hasta 50 KB.');
 if(!source.includes('\\begin{tikzpicture}')||!source.includes('\\end{tikzpicture}'))throw new AppError('Incluye el entorno completo: \\begin{tikzpicture} … \\end{tikzpicture}.');
 if(running)throw new AppError('El compilador está ocupado. Inténtalo de nuevo en unos segundos.',429);
 running=true;let folder:string|undefined;
 try{folder=await mkdtemp(path.join(tmpdir(),'aula-tikz-test-'));const result=await compileFigures([source],folder);const file=Object.values(result.results)[0];const error=result.errors[0];return {ok:!!file,svg:file?await readFile(file,'utf8'):undefined,message:file?'Diagrama generado correctamente.':error?.message??'No se generó el diagrama.',line:error?.line,log:error?.log?.replaceAll(folder,'[temporal]'),hints:!file?diagnosticHints(error?.message??'',source):[]};}
 finally{running=false;if(folder)await rm(folder,{recursive:true,force:true});}
}
export function diagnosticHints(message:string,source:string){const hints:string[]=[];
 if(/Paragraph ended/.test(message))hints.push('Hay un salto de párrafo dentro de una opción o argumento de TikZ. Revisa las líneas vacías, especialmente entre los corchetes de tikzpicture, node y draw.');
 if(/Undefined control sequence|comandos que requieren/.test(message))hints.push('Comprueba el nombre del comando. Las macros definidas sólo en tu documento no están disponibles en el compilador compartido.');
 if(/color|Undefined color/i.test(message))hints.push('Comprueba que el color exista en el preámbulo compartido.');
 if(/giving up|semicolon/i.test(message))hints.push('Comprueba el punto y coma al final de cada instrucción de dibujo.');
 if(/\n\s*\n/.test(source))hints.push('El código contiene líneas vacías. Dentro de las opciones TikZ pueden convertirse en un párrafo inesperado.');
 return hints;
}
