import type {Block} from '@/features/catalog/model/types';
export type SlidePage={start:number;end:number;offset:number};
export function slideUnits(blocks:Block[],compact:boolean):Block[]{
 const result:Block[]=[];
 for(const block of blocks){
  if(block.type==='list'&&block.items){block.items.forEach((item,index)=>result.push({...block,items:[item],start:(block.start??1)+index}));}
  else if(block.type==='text'){const paragraphs=block.content.split(/\n\s*\n/).filter(s=>s.trim());for(const content of paragraphs)result.push({...block,content});}
  else if(block.type==='code'){const lines=block.content.split('\n'),step=compact?10:22;for(let i=0;i<lines.length;i+=step)result.push({...block,content:lines.slice(i,i+step).join('\n')});}
  else if(block.type==='table'&&block.rows&&block.rows.length>1){const step=compact?4:10;for(let i=1;i<block.rows.length;i+=step)result.push({...block,rows:[block.rows[0],...block.rows.slice(i,i+step)]});}
  else if(block.type==='callout'&&compact&&block.children&&block.children.length>1){for(const [index,child] of slideUnits(block.children,compact).entries())result.push({...block,title:index?`${block.title??'Nota'} (continuación)`:block.title,children:[child]});}
  else result.push(block);
 }
 return result;
}
export function groupSlidePages(units:{top:number;height:number}[],space:number):SlidePage[]{
 if(!units.length)return [{start:0,end:0,offset:0}];const pages:SlidePage[]=[];let start=0;
 for(let i=1;i<units.length;i++)if(units[i].top+units[i].height-units[start].top>space){pages.push({start,end:i,offset:units[start].top});start=i;}
 pages.push({start,end:units.length,offset:units[start].top});return pages;
}
