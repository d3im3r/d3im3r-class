'use client';
import {Moon,Sun} from 'lucide-react';
import {ThemeSelector} from './theme-selector';
import {useTheme} from './theme-provider';
export function ThemeToggle(){const {theme,toggle}=useTheme();const label=theme==='dark'?'Activar modo claro':'Activar modo oscuro';return <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label} aria-pressed={theme==='dark'}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;}

export function ThemeControls(){return <div className="theme-controls"><ThemeSelector/><ThemeToggle/></div>;}
