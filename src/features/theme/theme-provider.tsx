'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {isPalette,type Palette} from './catalog';
type Theme='light'|'dark';
const ThemeContext=createContext<{theme:Theme;toggle:()=>void;palette:Palette;selectPalette:(value:Palette)=>void}>({theme:'light',toggle:()=>{},palette:'tweakcn',selectPalette:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){
 const [theme,setTheme]=useState<Theme>('light'),[palette,setPalette]=useState<Palette>('tweakcn');
 useEffect(()=>{
  setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');const value=document.documentElement.dataset.palette;setPalette(isPalette(value)?value:'tweakcn');
  const system=matchMedia('(prefers-color-scheme: dark)');
  const apply=(value:Theme)=>{document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;setTheme(value);};
  const change=()=>{let saved:string|null=null;try{saved=localStorage.getItem('aula-theme');}catch{}if(saved!=='light'&&saved!=='dark')apply(system.matches?'dark':'light');};
  const sync=(event:StorageEvent)=>{if(event.key==='aula-theme')apply(event.newValue==='dark'?'dark':event.newValue==='light'?'light':system.matches?'dark':'light');if(event.key==='aula-palette'){const next=isPalette(event.newValue)?event.newValue:'tweakcn';document.documentElement.dataset.palette=next;setPalette(next);}};
  system.addEventListener('change',change);window.addEventListener('storage',sync);
  return()=>{system.removeEventListener('change',change);window.removeEventListener('storage',sync);};
 },[]);
 function toggle(){const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;document.documentElement.style.colorScheme=next;setTheme(next);try{localStorage.setItem('aula-theme',next);}catch{}}
 function selectPalette(value:Palette){if(!isPalette(value))return;document.documentElement.dataset.palette=value;setPalette(value);try{localStorage.setItem('aula-palette',value);}catch{}}
 return <ThemeContext.Provider value={{theme,toggle,palette,selectPalette}}>{children}</ThemeContext.Provider>;
}
export function useTheme(){return useContext(ThemeContext);}
