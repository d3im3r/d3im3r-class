import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {themeScript} from './theme-script';
function boot(values:Record<string,string>,dark=false,blocked=false){const document={documentElement:{dataset:{} as Record<string,string>,style:{} as Record<string,string>}};vm.runInNewContext(themeScript,{document,localStorage:{getItem:(key:string)=>{if(blocked)throw Error();return values[key]??null;}},matchMedia:()=>({matches:dark})});return document.documentElement;}
test('restaura paleta y modo de forma independiente antes de pintar',()=>{const root=boot({'aula-palette':'clean-slate','aula-theme':'light'},true);assert.equal(root.dataset.palette,'clean-slate');assert.equal(root.dataset.theme,'light');assert.equal(root.style.colorScheme,'light');});
test('descarta paletas no válidas y usa el modo del sistema sin almacenamiento',()=>{const root=boot({'aula-palette':'no-valido'},true);assert.equal(root.dataset.palette,'tweakcn');assert.equal(root.dataset.theme,'dark');assert.doesNotThrow(()=>boot({},false,true));});
