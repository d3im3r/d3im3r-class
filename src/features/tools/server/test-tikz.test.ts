import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {testTikz,diagnosticHints} from './test-tikz';

function checkCompilerAvailable():boolean{
 try{
  const xelatex=spawnSync('xelatex',['--version'],{stdio:'ignore'});
  const dvisvgm=spawnSync('dvisvgm',['--version'],{stdio:'ignore'});
  return xelatex.status===0&&dvisvgm.status===0;
 }catch{
  return false;
 }
}

test('TikZ: genera SVG, informa sintaxis y rechaza comandos restringidos',async()=>{
 const hasCompiler=checkCompilerAvailable();
 if(hasCompiler){
  const good=await testTikz(String.raw`\begin{tikzpicture}\node[draw] {Prueba};\end{tikzpicture}`);
  assert.equal(good.ok,true);
  assert.match(good.svg??'',/<svg/);

  const multiline=await testTikz(String.raw`\begin{tikzpicture}[node distance=2cm,
% text width=2cm,
every node/.style={align=center}]\node {Interfaz\\dinámica};\end{tikzpicture}`);
  assert.equal(multiline.ok,true);

  const bad=await testTikz('\\begin{tikzpicture}[\nnode distance=2cm,\n\n]\n\\node {Prueba};\n\\end{tikzpicture}');
  assert.equal(bad.ok,false);
  assert.match(bad.message,/Paragraph ended/);
  assert.ok(bad.log);
  assert.ok(bad.line);
  assert.ok(bad.hints.length);
 }else{
  const res=await testTikz(String.raw`\begin{tikzpicture}\node[draw] {Prueba};\end{tikzpicture}`);
  if(!res.ok){
   assert.match(res.message,/XeLaTeX o dvisvgm no están disponibles|No está disponible el compilador/);
  }else{
   assert.match(res.svg??'',/<svg/);
  }
 }

 const forbidden=await testTikz(String.raw`\begin{tikzpicture}\input{secreto}\end{tikzpicture}`);
 assert.equal(forbidden.ok,false);
 assert.match(forbidden.message,/input/);
 assert.equal(forbidden.svg,undefined);

 await assert.rejects(()=>testTikz('sin entorno'),/entorno completo/);
});

test('TikZ: orienta sobre comandos y puntos y coma',()=>{
 assert.ok(diagnosticHints('Undefined control sequence','').length);
 assert.ok(diagnosticHints('giving up; semicolon','').length);
});
