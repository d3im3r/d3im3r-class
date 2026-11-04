import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseLatex} from '../src/features/latex-import/lib/parser';
import type {Block} from '../src/features/catalog/model/types';
const catalog=JSON.parse(await readFile('content/catalog.json','utf8'));
const images=await readdir('content/materials/assets/teaching');
let diagrams:Record<string,string>={};try{diagrams=JSON.parse(await readFile('content/resources/diagram-manifest.json','utf8'));}catch{}
function resolve(blocks:Block[],diagnostics:Set<string>){for(const b of blocks){
 if(b.type==='image'){const name=images.find(n=>n.toLowerCase()===path.basename(b.content).toLowerCase());if(name)b.asset='/assets/teaching/'+name;else diagnostics.add(`Imagen no encontrada: ${b.content}`);}
 if(b.type==='diagram'){b.asset=diagrams[createHash('sha256').update(b.content).digest('hex')];if(!b.asset)diagnostics.add('Algunos diagramas TikZ están pendientes de compilar.');}
 if(b.children)resolve(b.children,diagnostics);if(b.items)for(const item of b.items)resolve(item,diagnostics);
}}
for(const lesson of catalog.lessons){
 const source=await readFile(lesson.source,'utf8');const parsed=parseLatex(source);const diagnostics=new Set(parsed.diagnostics);
 for(const frame of parsed.frames)resolve(frame.blocks,diagnostics);
 Object.assign(lesson,parsed,{diagnostics:[...diagnostics]});
 await writeFile(`content/materials/resources/${lesson.id}.tex`,source);
 console.log(`${lesson.title}: ${lesson.frames.length} bloques, ${lesson.diagnostics.length} avisos`);
}
await writeFile('content/generated.json',JSON.stringify(catalog,null,2));
