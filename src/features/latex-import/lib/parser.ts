import type { Block, Frame } from '../../catalog/model/types';
const codeLanguages: Record<string,string> = {bash:'bash',console:'text',python:'python',html:'html',css:'css',javascript:'javascript',cpp:'cpp',sql:'sql',java:'java',mongodb:'json'};
export function group(source:string,start:number,open='{',close='}') {
 let depth=0;
 for(let i=start;i<source.length;i++){
  if(source[i]==='\\'){i++;continue;}
  if(source[i]===open)depth++;
  if(source[i]===close&&--depth===0)return {value:source.slice(start+1,i),end:i+1};
 }
 throw new Error(`Grupo sin cerrar en posición ${start}`);
}
export function cleanLayout(input:string){
 return input.replace(/(?<!\\)%[^\n]*/g,'')
  .replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g,'')
  .replace(/\\(?:begin|end)\{(?:center|columns|column)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?/g,'')
  .replace(/\\(?:centering|tiny|small|large|Large|LARGE|huge|Huge|footnotesize|scriptsize|normalsize|medskip|bigskip|pause)\b/g,'')
  .replace(/\\texorpdfstring\{([^{}]*)\}\{([^{}]*)\}/g,'$2').trim();
}
export function plain(input:string):string{
 let s=cleanLayout(input).replace(/\\(?:begin|end)\{(?:itemize|enumerate|tabular)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?/g,'').replace(/\\item(?:\[[^\]]*\])?\s*/g,'\n• ').replace(/\\\\/g,'\n').replace(/\\(?:toprule|midrule|bottomrule)\b/g,'');
 for(let i=0;i<5;i++)s=s.replace(/\\(?:textbf|texttt|textit|emph|alert|underline|text|url)\{([^{}]*)\}/g,'$1');
 for(let i=0;i<5;i++)s=s.replace(/\\texorpdfstring\{([^{}]*)\}\{([^{}]*)\}/g,'$2');
 return s.replace(/\\([_%&#$])/g,'$1').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function environmentEnd(source:string,env:string,start:number){
 const expression=/\\(begin|end)\{([^}]+)\}/g;expression.lastIndex=start;let depth=1,m;
 while((m=expression.exec(source))){if(m[2]!==env)continue;depth+=m[1]==='begin'?1:-1;if(depth===0)return {start:m.index,end:expression.lastIndex};}
 return null;
}
function listItems(body:string){
 const tokens=/\\(?:begin|end)\{(?:itemize|enumerate)\}|\\item(?:\[[^\]]*\])?/g;let depth=0,start=-1,m;const items:string[]=[];
 while((m=tokens.exec(body))){if(m[0].startsWith('\\begin'))depth++;else if(m[0].startsWith('\\end'))depth--;else if(depth===0){if(start>=0)items.push(body.slice(start,m.index));start=tokens.lastIndex;}}
 if(start>=0)items.push(body.slice(start));return items;
}
const mathEnvs = new Set(['align','align*','gather','gather*','equation','equation*','multline','multline*','alignat','alignat*']);
export function parseBlocks(source:string,diagnostics:Set<string>):Block[]{
 const blocks:Block[]=[];let cursor=0;
 // Inline $...$ remains in its paragraph; only display math becomes a standalone block.
 const token=/\\begin\{([a-zA-Z]+code(?:dark)?|minted|tikzpicture|block|alertblock|exampleblock|itemize|enumerate|tabular|algorithm|algorithmic|align\*?|gather\*?|equation\*?|multline\*?|alignat\*?)\}|\\(Idea|Practice|DefBlock|Result|Warning|Compare|Question|ExampleBlock)\b|\\\[|\$\$|\\(?:smartimage|includegraphics)\b/g;let m;
 const addText=(s:string)=>{const content=cleanLayout(s);if(content)blocks.push({type:'text',content});};
 while((m=token.exec(source))){
  addText(source.slice(cursor,m.index));let end=token.lastIndex;
  if(m[1]){
   const env=m[1],stop=environmentEnd(source,env,end);
   if(!stop){diagnostics.add(`Entorno sin cerrar: ${env}`);cursor=end;continue;}
   let body=source.slice(end,stop.start);
   if(env==='tikzpicture')blocks.push({type:'diagram',content:source.slice(m.index,stop.end)});
   else if(mathEnvs.has(env)){
    blocks.push({type:'math',content:source.slice(m.index,stop.end),variant:'display'});
   }else if(env==='algorithm'||env==='algorithmic'){
    body=body.replace(/^\s*\[[^\]]*\]/,'');
    let title='Algoritmo';
    const captionMatch=body.match(/\\caption\{([^}]+)\}/);
    if(captionMatch){
     title=`Algoritmo: ${plain(captionMatch[1])}`;
     body=body.replace(/\\caption\{[^}]+\}/g,'');
    }
    const rawSteps=body.replace(/\\(?:begin|end)\{(?:algorithm|algorithmic)\}(?:\[[^\]]*\])?/g,'')
     .split(/\\(?:State|Statex)\b/)
     .map(s=>cleanLayout(s))
     .filter(Boolean);
    const items=rawSteps.length?rawSteps.map(step=>[{type:'text' as const,content:step}]):[[{type:'text' as const,content:cleanLayout(body)}]];
    blocks.push({
     type:'callout',
     title,
     variant:'Practice',
     content:'',
     children:[{type:'list',content:'',variant:'enumerate',items}]
    });
   }else if(env==='itemize'||env==='enumerate')blocks.push({type:'list',content:'',variant:env,items:listItems(body).map(item=>parseBlocks(item,diagnostics))});
   else if(env==='tabular'){
    let i=body.search(/\S/);if(body[i]==='{')body=body.slice(group(body,i).end);
    body=body.replace(/\\(?:toprule|midrule|bottomrule|hline)\b/g,'');
    blocks.push({type:'table',content:'',rows:body.split(/\\\\(?:\[[^\]]*\])?/).filter(r=>r.trim()).map(r=>r.split(/(?<!\\)&/).map(c=>c.trim()))});
   }else if(['block','alertblock','exampleblock'].includes(env)){
    const i=body.search(/\S/);let title='Nota';if(body[i]==='{'){const g=group(body,i);title=plain(g.value);body=body.slice(g.end);}
    blocks.push({type:'callout',title,variant:env,content:cleanLayout(body),children:parseBlocks(body,diagnostics)});
   }else{
    let language=codeLanguages[env.replace(/codedark$|code$/,'')]??'text';
    if(env==='minted'){const opt=body.match(/^\s*\[[^\]]*\]/);if(opt)body=body.slice(opt[0].length);const i=body.search(/\S/);if(body[i]==='{'){const g=group(body,i);language=g.value;body=body.slice(g.end);}}
    const lines=body.replace(/^\n|\s+$/g,'').split('\n');const indent=Math.min(...lines.filter(l=>l.trim()).map(l=>l.match(/^\s*/)![0].length));
    blocks.push({type:'code',language,content:lines.map(l=>l.slice(Number.isFinite(indent)?indent:0)).join('\n')});
   }end=stop.end;
  }else if(m[2]){
   let i=end;while(i<source.length&&/\s/.test(source[i]))i++;let title=m[2];
   if(source[i]==='['){const g=group(source,i,'[',']');title=plain(g.value);i=g.end;}
   while(i<source.length&&/\s/.test(source[i]))i++;
   if(source[i]==='{'){const g=group(source,i);blocks.push({type:'callout',title,variant:m[2],content:cleanLayout(g.value),children:parseBlocks(g.value,diagnostics)});end=g.end;}
  }else if(/smartimage|includegraphics/.test(m[0])){
   let i=end;while(i<source.length&&/\s/.test(source[i]))i++;if(source[i]==='[')i=group(source,i,'[',']').end;
   while(i<source.length&&/\s/.test(source[i]))i++;
   if(source[i]==='{'){const g=group(source,i);blocks.push({type:'image',content:g.value});end=g.end;}
  }else{
   const closing=m[0]==='\\['?'\\]':m[0],stop=source.indexOf(closing,end);
   if(stop>=0){blocks.push({type:'math',content:source.slice(end,stop).trim(),variant:'display'});end=stop+closing.length;}
  }
  cursor=end;token.lastIndex=end;
 }
 addText(source.slice(cursor));return blocks;
}
export function parseLatex(source:string){
 const frames:Frame[]=[];const diagnostics=new Set<string>();let section='Introducción';
 const protectedSource=source.replace(/\\begin\{([a-zA-Z]+code(?:dark)?|minted|tikzpicture)\}[\s\S]*?\\end\{\1\}|(?<!\\)%[^\n]*/g,m=>m.startsWith('%')?' '.repeat(m.length):m);
 const token=/\\section\*?(?:\[[^\]]*\])?\s*\{|\\begin\{frame\}(?:\[[^\]]*\])?/g;let m;
 while((m=token.exec(protectedSource))){
  if(m[0].startsWith('\\section')){const g=group(protectedSource,token.lastIndex-1);section=plain(g.value);token.lastIndex=g.end;continue;}
  let i=token.lastIndex;while(i<protectedSource.length&&/\s/.test(protectedSource[i]))i++;
  let title='Contenido';if(protectedSource[i]==='{'){const g=group(protectedSource,i);title=plain(g.value);i=g.end;}
  const end=protectedSource.indexOf('\\end{frame}',i);if(end<0){diagnostics.add('Frame sin cerrar');break;}
  frames.push({id:`frame-${frames.length+1}`,title,section,line:source.slice(0,m.index).split('\n').length,blocks:parseBlocks(protectedSource.slice(i,end),diagnostics)});
  token.lastIndex=end+'\\end{frame}'.length;
 }
 return {frames,diagnostics:[...diagnostics]};
}
export function extractLatexMetadata(source:string,fallbackName='Nueva clase'){
 const stripped=source.replace(/(?<!\\)%[^\n]*/g,'');
 let sectionTitle='',sectionSubtitle='',docTitle='',docSubtitle='';
 const secMatch=/\\SectionSlide\b/.exec(stripped);
 if(secMatch){
  let i=secMatch.index+secMatch[0].length;while(i<stripped.length&&/\s/.test(stripped[i]))i++;
  if(stripped[i]==='{'){try{const g1=group(stripped,i);sectionTitle=plain(g1.value);i=g1.end;while(i<stripped.length&&/\s/.test(stripped[i]))i++;if(stripped[i]==='{')sectionSubtitle=plain(group(stripped,i).value);}catch{}}
 }
 const subMatch=/\\subtitle(?:\[[^\]]*\])?\s*\{/.exec(stripped);
 if(subMatch){try{docSubtitle=plain(group(stripped,subMatch.index+subMatch[0].length-1).value);}catch{}}
 const titleMatch=/\\title(?:\[[^\]]*\])?\s*\{/.exec(stripped);
 if(titleMatch){try{const raw=group(stripped,titleMatch.index+titleMatch[0].length-1).value;if(!raw.includes('\\CourseName'))docTitle=plain(raw);}catch{}}
 const fallback=fallbackName.replace(/\.tex$/i,'').replace(/[-_]+/g,' ').trim()||'Nueva clase';
 const title=(sectionTitle||docSubtitle||docTitle||fallback).slice(0,150);
 const subtitle=(sectionSubtitle||(docSubtitle&&docSubtitle!==title?docSubtitle:'')).slice(0,200);
 return {title,subtitle};
}
