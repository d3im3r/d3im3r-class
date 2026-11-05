'use client';
import {useState,useEffect,useContext} from 'react';
import katex from 'katex';
import {ResourceToolsContext} from '@/features/tools/components/resource-tools-context';
import {Lightbulb,BookOpen,CheckCircle2,TriangleAlert,FlaskConical,Scale,HelpCircle,Puzzle,Workflow,FileText,ExternalLink} from 'lucide-react';
import type {Block} from '@/features/catalog/model/types';
import {TikZDiagram} from './tikz-diagram';
import {CodeBlock} from './code-block';
import {InlineText,RichText} from './rich-text';
const styles:Record<string,{kind:string;title:string;icon:typeof Lightbulb}>={
 Idea:{kind:'idea',title:'Idea clave',icon:Lightbulb},
 DefBlock:{kind:'definition',title:'Definición',icon:BookOpen},
 Result:{kind:'result',title:'Resultado',icon:CheckCircle2},
 Practice:{kind:'practice',title:'Actividad práctica',icon:FlaskConical},
 Warning:{kind:'warning',title:'Atención',icon:TriangleAlert},
 Compare:{kind:'compare',title:'Comparación',icon:Scale},
 Question:{kind:'question',title:'Pregunta guía',icon:HelpCircle},
 ExampleBlock:{kind:'example',title:'Ejemplo',icon:Puzzle},
 alertblock:{kind:'warning',title:'Atención',icon:TriangleAlert},
 exampleblock:{kind:'example',title:'Ejemplo',icon:Puzzle},
};
export function calloutStyle(block:Block){
 if(block.variant&&styles[block.variant])return styles[block.variant];
 const title=(block.title??'').toLowerCase();
 if(/pregunta|reflexión/.test(title))return styles.Question;
 if(/idea|clave|regla/.test(title))return styles.Idea;
 if(/práctica|actividad|ejercicio/.test(title))return styles.Practice;
 if(/advertencia|atención|cuidado|error/.test(title))return styles.Warning;
 if(/resultado|conclusión/.test(title))return styles.Result;
 if(/definición|concepto/.test(title))return styles.DefBlock;
 if(/ejemplo/.test(title))return styles.ExampleBlock;
 if(/comparación|diferencia/.test(title))return styles.Compare;
 return {kind:'note',title:'Nota',icon:BookOpen};
}
function Figure({block}:{block:Block}){
 const [failed,setFailed]=useState(false);const canTest=useContext(ResourceToolsContext);
 useEffect(()=>{setFailed(false);},[block.asset]);
 const isDiagram=block.type==='diagram';
 const inspect=<details className="diagram-source"><summary><Workflow size={13}/>Ver código y revisar recurso</summary><pre>{block.content}</pre><div style={{display:'flex',gap:'8px',marginTop:'8px',flexWrap:'wrap',justifyContent:'center'}}>{canTest&&<button type="button" className="resource-inspect" onClick={event=>{event.currentTarget.closest("dialog")?.close();window.dispatchEvent(new CustomEvent("aula:inspect-resource",{detail:block.content}));}}>Abrir en herramientas</button>}{isDiagram&&<a href="https://tikz.dev/" target="_blank" rel="noopener noreferrer" className="resource-inspect" style={{display:'inline-flex',alignItems:'center',gap:'4px'}}>Documentación en tikz.dev <ExternalLink size={11}/></a>}</div></details>;

 if(isDiagram){
  if(block.asset&&!failed){
   return <figure className="lesson-figure diagram-figure"><img src={block.asset} alt="Diagrama de la clase" loading="lazy" onError={()=>setFailed(true)}/>{inspect}</figure>;
  }
  if(block.content&&block.content.trim()){
   return <figure className="lesson-figure diagram-figure"><TikZDiagram code={block.content}/>{inspect}</figure>;
  }
  return <div className="resource-pending"><p><FileText size={17}/> No se pudo generar o cargar este diagrama. Consulta el PDF original o informa a tu docente.</p>{inspect}</div>;
 }

 if(!block.asset||failed)return <div className="resource-pending"><p><FileText size={17}/> No se pudo cargar esta imagen. {canTest?'Consulta el PDF original o revisa el código del recurso.':'Consulta el PDF original o informa a tu docente.'}</p>{canTest&&inspect}</div>;
 return <figure className="lesson-figure"><img src={block.asset} alt={block.content.split('/').pop()?.replace(/\.[^.]+$/,'')??'Ilustración de la clase'} loading="lazy" onError={()=>setFailed(true)}/>{canTest&&inspect}</figure>;
}
export function ContentBlock({block}:{block:Block}){
 if(block.type==='code')return <CodeBlock content={block.content} language={block.language}/>;
 if(block.type==='math')return <div className="math-block" dangerouslySetInnerHTML={{__html:katex.renderToString(block.content,{throwOnError:false,trust:false,displayMode:true})}}/>;
 if(block.type==='image'||block.type==='diagram')return <Figure block={block}/>;
 if(block.type==='list'){const List=block.variant==='enumerate'?'ol':'ul';return <List className="lesson-list" {...(block.variant==='enumerate'?{start:block.start}: {})}>{block.items?.map((item,i)=><li key={i}>{item.map((b,j)=><ContentBlock key={j} block={b}/>)}</li>)}</List>;}
 if(block.type==='table')return <div className="lesson-table-wrap"><table className="lesson-table"><thead><tr>{block.rows?.[0]?.map((cell,i)=><th scope="col" key={i}><InlineText text={cell}/></th>)}</tr></thead><tbody>{block.rows?.slice(1).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><InlineText text={cell}/></td>)}</tr>)}</tbody></table></div>;
 if(block.type==='callout'){const style=calloutStyle(block),Icon=style.icon;const title=block.title===block.variant?style.title:block.title??style.title;return <aside className={`teaching-block teaching-${style.kind}`}><div className="teaching-title"><Icon size={19}/><strong>{title}</strong></div><div className="teaching-body">{block.children?.length?block.children.map((b,i)=><ContentBlock key={i} block={b}/>):<RichText text={block.content}/>}</div></aside>;}
 return <RichText text={block.content}/>;
}
