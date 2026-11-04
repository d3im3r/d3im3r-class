'use client';
import {palettes,isPalette} from './catalog';
import {useTheme} from './theme-provider';
export function ThemeSelector(){const {palette,selectPalette}=useTheme();return <select aria-label="Tema de color" title="Tema de color" className="theme-selector" value={palette} onChange={event=>{if(isPalette(event.target.value))selectPalette(event.target.value);}}>{palettes.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>;}
