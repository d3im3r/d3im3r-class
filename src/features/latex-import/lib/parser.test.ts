import {test} from 'node:test';
import assert from 'node:assert/strict';
import {group,parseLatex} from './parser';
test('grupos anidados y llaves escapadas',()=>{assert.equal(group('{a {b} \\{ c}',0).value,'a {b} \\{ c');assert.throws(()=>group('{sin cerrar',0));});
test('conserva código verbatim con porcentajes y comandos',()=>{const {frames}=parseLatex('\\section{Código}\n\\begin{frame}[fragile]{Ejemplo}\n\\begin{pythoncode}\nx = 5 % 2\nprint("\\\\Idea{no interpretar}")\n\\end{pythoncode}\n\\Idea[Título]{Texto {anidado}}\\end{frame}');assert.equal(frames.length,1);assert.equal(frames[0].section,'Código');assert.equal(frames[0].blocks[0].type,'code');assert.match(frames[0].blocks[0].content,/5 % 2/);assert.equal(frames[0].blocks[1].title,'Título');});
test('ignora frames y secciones comentados',()=>{const result=parseLatex('% \\section{Ignorar}\n% \\begin{frame}{No}\\end{frame}\n\\section{Sí}\n\\begin{frame}{Real}Contenido\\end{frame}');assert.equal(result.frames.length,1);assert.equal(result.frames[0].section,'Sí');assert.equal(result.frames[0].line,4);});
test('conserva matemáticas, TikZ e imágenes para resolver recursos durante la importación',()=>{const result=parseLatex('\\begin{frame}{Gráfica}\\[x^2\\]\\begin{tikzpicture}\\node {A};\\end{tikzpicture}\\smartimage[4cm]{a.png}\\end{frame}');assert.deepEqual(result.frames[0].blocks.map(b=>b.type),['math','diagram','image']);assert.equal(result.diagnostics.length,0);});

test('mantiene matemáticas en línea dentro de la lectura',()=>{const {frames}=parseLatex(String.raw`\begin{frame}{Lectura}La pose es $(x,y,\theta)$ y la velocidad es $v$.\end{frame}`);assert.equal(frames[0].blocks.length,1);assert.equal(frames[0].blocks[0].type,'text');assert.match(frames[0].blocks[0].content,/La pose es \$\(x,y/);});
test('preserva listas anidadas y contenido estructurado de bloques docentes',()=>{const {frames}=parseLatex(String.raw`\begin{frame}{Práctica}\Practice{Pasos:\begin{enumerate}\item Primero \begin{itemize}\item Subpaso\end{itemize}\item Segundo\end{enumerate}}\end{frame}`);const callout=frames[0].blocks[0];assert.equal(callout.variant,'Practice');const list=callout.children?.[1];assert.equal(list?.type,'list');assert.equal(list?.items?.length,2);assert.equal(list?.items?.[0][1].type,'list');});
test('importa tablas con encabezados y celdas matemáticas',()=>{const {frames}=parseLatex(String.raw`\begin{frame}{Tabla}\begin{tabular}{cc}\toprule Variable & Valor \\ \midrule $v$ & $2$ \\ \bottomrule\end{tabular}\end{frame}`);assert.deepEqual(frames[0].blocks[0].rows,[['Variable','Valor'],['$v$','$2$']]);});
test('limpia títulos con texorpdfstring y formato anidado',()=>{const {frames}=parseLatex(String.raw`\begin{frame}{¿Qué es \texorpdfstring{\texttt{std\_msgs}}{std msgs}?}Texto\end{frame}`);assert.equal(frames[0].title,'¿Qué es std msgs?');});

test('conserva comentarios TikZ sin convertirlos en párrafos dentro de las opciones',()=>{const diagram=String.raw`\begin{tikzpicture}[node distance=1cm,
% text width=3cm,
every node/.style={font=\small}]
\node {Interfaz\\dinámica};
\end{tikzpicture}`;const result=parseLatex(`\\begin{frame}{Diagrama}${diagram}\\end{frame}`);assert.equal(result.frames[0].blocks[0].content,diagram);});

test('interpreta entornos align* y matemáticos display',()=>{const result=parseLatex(String.raw`\begin{frame}{Ecuaciones}\begin{align*}
a &= b + c \\
&= d
\end{align*}\end{frame}`);assert.equal(result.frames[0].blocks[0].type,'math');assert.equal(result.frames[0].blocks[0].variant,'display');assert.match(result.frames[0].blocks[0].content,/align\*/);});

test('interpreta entornos algorithm y algorithmic como callout estructurado',()=>{const result=parseLatex(String.raw`\begin{frame}{Algoritmo}\begin{algorithm}[H]
\caption{Actualización PI}
\begin{algorithmic}[1]
\State Medir velocidad $\omega_k$
\State Calcular $e_k = \omega_k$
\end{algorithmic}
\end{algorithm}\end{frame}`);assert.equal(result.frames[0].blocks[0].type,'callout');assert.equal(result.frames[0].blocks[0].title,'Algoritmo: Actualización PI');const list=result.frames[0].blocks[0].children?.[0];assert.equal(list?.type,'list');assert.equal(list?.items?.length,2);});
