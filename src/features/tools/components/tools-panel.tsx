'use client';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Wrench,
  Play,
  Download,
  Copy,
  ExternalLink,
  Terminal,
  Code2,
  Trash2,
  Layers,
  LayoutTemplate,
  Eye,
  FileCode,
  Check,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Block, Catalog } from '@/features/catalog/model/types';
import {
  runPython,
  runJavaScript,
  buildSandboxDocument,
  DEFAULT_JS_DOM_TEMPLATE,
  getLanguageCategory,
  type RunResult,
} from '../lib/code-runner';

const CodeEditor = dynamic(() => import('./code-editor'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">Cargando editor…</p>,
});

const exampleTikz = String.raw`\begin{tikzpicture}[node distance=2cm]
\node[draw, rounded corners, fill=IdeaBody] (a) {Entrada};
\node[draw, rounded corners, fill=ResultBody, right=of a] (b) {Resultado};
\draw[->, thick] (a) -- (b);
\end{tikzpicture}`;

const examplePython = `import numpy as np

# Demostración: Rotaciones elementales en 3D
def Rx(theta_deg):
    t = np.deg2rad(theta_deg)
    c, s = np.cos(t), np.sin(t)
    return np.array([
        [1, 0, 0],
        [0, c, -s],
        [0, s, c]
    ])

def Ry(theta_deg):
    t = np.deg2rad(theta_deg)
    c, s = np.cos(t), np.sin(t)
    return np.array([
        [c, 0, s],
        [0, 1, 0],
        [-s, 0, c]
    ])

# Vector inicial p = [0, 0, 1]
p = np.array([0.0, 0.0, 1.0])

# Secuencia A vs Secuencia B
RA = Ry(90) @ Rx(90)
RB = Rx(90) @ Ry(90)

pA = RA @ p
pB = RB @ p

print("Matriz RA (Ry luego Rx):\\n", RA)
print("Matriz RB (Rx luego Ry):\\n", RB)
print("Vector pA resultante:", pA)
print("Vector pB resultante:", pB)
print("¿Son iguales RA y RB?", np.allclose(RA, RB))
`;

const exampleJs = `// Laboratorio interactivo JavaScript
const button = document.getElementById('miBoton');
const output = document.getElementById('salida');

console.log('Laboratorio JS iniciado correctamente.');

if (button && output) {
  let contador = 0;
  button.onclick = () => {
    contador++;
    output.innerText = \`¡Clic número \${contador} registrado con éxito!\`;
    console.log(\`Evento de clic registrado: \${contador}\`);
  };
}
`;

type TikzResult = {
  ok: boolean;
  svg?: string;
  message: string;
  log?: string;
  line?: number;
  hints: string[];
};

export function ToolsPanel({
  catalog,
  seed,
  initialLanguage,
}: {
  catalog: Catalog;
  seed?: string;
  initialLanguage?: string;
}) {
  // Determinar pestaña inicial según el código recibido
  const initialCategory = useMemo(() => {
    if (initialLanguage) {
      const cat = getLanguageCategory(initialLanguage);
      if (cat === 'python') return 'python';
      if (cat === 'javascript' || cat === 'html') return 'javascript';
      if (cat === 'tikz') return 'tikz';
    }
    if (seed) {
      if (seed.includes('\\begin{tikzpicture}') || seed.includes('\\draw') || seed.includes('\\node')) {
        return 'tikz';
      }
      if (seed.includes('def ') || seed.includes('import ') || seed.includes('numpy') || seed.includes('np.')) {
        return 'python';
      }
      if (seed.includes('console.') || seed.includes('document.') || seed.includes('function ')) {
        return 'javascript';
      }
    }
    return 'python';
  }, [seed, initialLanguage]);

  const [activeTab, setActiveTab] = useState<'python' | 'javascript' | 'tikz'>(initialCategory);

  // ----------------------------------------
  // Estado: Laboratorio Python
  // ----------------------------------------
  const [pythonCode, setPythonCode] = useState(
    initialCategory === 'python' && seed ? seed : examplePython
  );
  const [pythonRunning, setPythonRunning] = useState(false);
  const [pythonStatus, setPythonStatus] = useState('');
  const [pythonResult, setPythonResult] = useState<RunResult | null>(null);

  const runPythonCode = async () => {
    if (pythonRunning) return;
    setPythonRunning(true);
    setPythonResult(null);
    setPythonStatus('Iniciando entorno Python...');
    try {
      const res = await runPython(pythonCode, (st) => setPythonStatus(st));
      setPythonResult(res);
      if (res.success) {
        toast.success(`Ejecutado con éxito en ${res.executionTimeMs ?? 0}ms`);
      } else {
        toast.error('Error durante la ejecución del script.');
      }
    } catch (err) {
      setPythonResult({
        success: false,
        output: [],
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error('Fallo al inicializar Pyodide.');
    } finally {
      setPythonRunning(false);
      setPythonStatus('');
    }
  };

  // ----------------------------------------
  // Estado: Laboratorio JavaScript / Web
  // ----------------------------------------
  const [jsCode, setJsCode] = useState(
    initialCategory === 'javascript' && seed ? seed : exampleJs
  );
  const [jsDom, setJsDom] = useState(DEFAULT_JS_DOM_TEMPLATE);
  const [jsSubTab, setJsSubTab] = useState<'js' | 'dom' | 'preview'>('js');
  const [jsResult, setJsResult] = useState<RunResult | null>(null);
  const sandboxId = useRef(`sb-tool-${Math.random().toString(36).slice(2, 8)}`);
  const [compiledJsDoc, setCompiledJsDoc] = useState('');

  // Escuchar logs del iframe de JS
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (
        e.data &&
        typeof e.data === 'object' &&
        e.data.type === 'aula-runner-log' &&
        e.data.sandboxId === sandboxId.current
      ) {
        const prefix = e.data.level === 'error' ? '✖ ' : e.data.level === 'warn' ? '⚠ ' : '';
        const line = `${prefix}${e.data.message}`;
        setJsResult((prev) => {
          const currentOutputs = prev?.output ?? [];
          return {
            success: prev ? prev.success && e.data.level !== 'error' : e.data.level !== 'error',
            output: [...currentOutputs, line],
            error: e.data.level === 'error' ? e.data.message : prev?.error,
          };
        });
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  const runJsCode = useCallback(() => {
    const start = performance.now();
    setJsResult({ success: true, output: [] });
    const doc = buildSandboxDocument({
      html: jsDom,
      js: jsCode,
      sandboxId: sandboxId.current,
    });
    setCompiledJsDoc('');
    setTimeout(() => {
      setCompiledJsDoc(doc);
      setJsResult((prev) => ({
        success: prev?.success ?? true,
        output: prev?.output ?? [],
        executionTimeMs: Math.round(performance.now() - start),
      }));
      toast.success('Entorno web recargado.');
    }, 50);
  }, [jsDom, jsCode]);

  // ----------------------------------------
  // Estado: Laboratorio TikZ
  // ----------------------------------------
  const [tikzSource, setTikzSource] = useState(
    initialCategory === 'tikz' && seed ? seed : exampleTikz
  );
  const [tikzInitial, setTikzInitial] = useState(tikzSource);
  const [tikzVersion, setTikzVersion] = useState(0);
  const [tikzResult, setTikzResult] = useState<TikzResult | null>(null);
  const [tikzBusy, setTikzBusy] = useState(false);
  const [tikzError, setTikzError] = useState('');
  const [tikzSelected, setTikzSelected] = useState('');
  const [tikzLessonId, setTikzLessonId] = useState('');
  const [testedTikzSource, setTestedTikzSource] = useState('');

  const resources = useMemo(() => {
    const items: { id: string; lessonId: string; label: string; block: Block }[] = [];
    for (const lesson of catalog.lessons) {
      let n = 0;
      function walk(blocks: Block[]) {
        for (const block of blocks) {
          if (block.type === 'diagram' || block.type === 'image')
            items.push({
              id: `${lesson.id}-${n++}`,
              lessonId: lesson.id,
              label: `${lesson.title} · ${block.type === 'diagram' ? 'TikZ' : 'Imagen'} ${n}${!block.asset ? ' · Sin generar' : ''}`,
              block,
            });
          if (block.children) walk(block.children);
          for (const item of block.items ?? []) walk(item);
        }
      }
      for (const frame of lesson.frames) walk(frame.blocks);
    }
    return items;
  }, [catalog]);

  useEffect(() => {
    if (!seed || initialCategory !== 'tikz') return;
    const r = resources.find((res) => res.block.content === seed);
    if (r) {
      setTikzSelected(r.id);
      setTikzLessonId(r.lessonId);
    }
  }, [seed, initialCategory, resources]);

  const currentResource = resources.find((r) => r.id === tikzSelected);
  const currentLesson = catalog.lessons.find((l) => l.id === tikzLessonId);
  const tikzStale = !!tikzResult && testedTikzSource !== tikzSource;

  function loadTikz(value: string) {
    setTikzInitial(value);
    setTikzSource(value);
    setTikzVersion((v) => v + 1);
    setTikzResult(null);
    setTikzError('');
  }

  async function compileTikz() {
    setTikzBusy(true);
    setTikzError('');
    setTikzResult(null);
    const code = tikzSource;
    const toastId = toast.loading('Compilando código TikZ con LaTeX vectorial…');
    try {
      const response = await fetch('/api/tools/tikz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTestedTikzSource(code);
      setTikzResult(data);
      if (data.ok) {
        toast.success('Diagrama generado correctamente.', { id: toastId });
      } else {
        toast.error(data.message || 'Error en la sintaxis de TikZ.', { id: toastId });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo probar el diagrama.';
      setTikzError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setTikzBusy(false);
    }
  }

  return (
    <main className="dashboard tools-page">
      <div className="eyebrow">ESPACIO DE HERRAMIENTAS Y LABORATORIO</div>
      <h1>
        <Wrench />
        Zona de Herramientas
      </h1>
      <p>
        Entorno dedicado para ejecutar código interactivo (Python y JavaScript) y compilar diagramas
        vectoriales TikZ sin sobrecargar el visor de clases.
      </p>

      {/* Selector de Herramienta / Laboratorio */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          margin: '20px 0 16px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '12px',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant={activeTab === 'python' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('python')}
        >
          <Terminal size={15} />
          Laboratorio Python (NumPy)
        </Button>
        <Button
          variant={activeTab === 'javascript' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('javascript')}
        >
          <Code2 size={15} />
          Laboratorio Web / JavaScript
        </Button>
        <Button
          variant={activeTab === 'tikz' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('tikz')}
        >
          <Layers size={15} />
          Compilador TikZ (LaTeX)
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 1: LABORATORIO PYTHON */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'python' && (
        <section className="admin-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Terminal size={18} />
                Laboratorio Científico Python (Pyodide WASM + NumPy)
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                Ejecuta algoritmos, transformaciones matriciales 3D y simulaciones en el navegador.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPythonCode(examplePython)}
                title="Cargar ejemplo de rotaciones matriciales"
              >
                <RotateCcw size={14} />
                Ejemplo
              </Button>
            </div>
          </div>

          <div className="tools-editor-heading">
            <label>Editor Python · {pythonCode.split('\n').length} líneas</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pythonCode);
                    toast.success('Código Python copiado al portapapeles.');
                  } catch {
                    toast.error('No se pudo copiar el código.');
                  }
                }}
              >
                <Copy size={14} />
                Copiar
              </Button>
            </div>
          </div>

          <CodeEditor initial={pythonCode} language="python" onChange={setPythonCode} />

          <div className="tools-actions" style={{ marginTop: '14px' }}>
            <Button disabled={pythonRunning || !pythonCode.trim()} onClick={runPythonCode}>
              <Play size={15} />
              {pythonRunning ? (pythonStatus || 'Ejecutando Python…') : 'Ejecutar (Ctrl+Enter)'}
            </Button>
            {pythonResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPythonResult(null)}
                title="Limpiar salida de consola"
              >
                <Trash2 size={14} />
                Limpiar consola
              </Button>
            )}
            {pythonResult?.executionTimeMs !== undefined && (
              <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: 'auto' }}>
                Tiempo: {pythonResult.executionTimeMs}ms
              </span>
            )}
          </div>

          {pythonResult && (
            <div
              style={{
                marginTop: '18px',
                borderRadius: '8px',
                background: 'var(--card-bg, #0f172a)',
                color: '#f8fafc',
                padding: '16px',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '8px',
                  fontSize: '12px',
                  color: '#94a3b8',
                }}
              >
                <span>SALIDA DE CONSOLA PYTHON</span>
                <span style={{ color: pythonResult.success ? '#4ade80' : '#f87171' }}>
                  {pythonResult.success ? '✔ Ejecutado con éxito' : '✖ Error'}
                </span>
              </div>
              {pythonResult.output.length > 0 ? (
                pythonResult.output.map((line, idx) => (
                  <pre
                    key={idx}
                    style={{
                      margin: '2px 0',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      color: line.startsWith('✖') ? '#f87171' : line.startsWith('⚠') ? '#facc15' : '#e2e8f0',
                    }}
                  >
                    {line}
                  </pre>
                ))
              ) : (
                <p style={{ margin: 0, color: '#94a3b8' }}>Sin salida impresa (usa print(...)).</p>
              )}
              {pythonResult.error && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    borderLeft: '3px solid #ef4444',
                    color: '#fca5a5',
                    fontSize: '12px',
                  }}
                >
                  {pythonResult.error}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 2: LABORATORIO JAVASCRIPT & WEB */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'javascript' && (
        <section className="admin-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Code2 size={18} />
                Laboratorio Interactivo JavaScript y Web DOM
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                Edita JavaScript y estructura HTML, con captura de consola y visualización en tiempo real.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button
                variant={jsSubTab === 'js' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setJsSubTab('js')}
              >
                <FileCode size={14} />
                JavaScript
              </Button>
              <Button
                variant={jsSubTab === 'dom' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setJsSubTab('dom')}
              >
                <LayoutTemplate size={14} />
                HTML (DOM)
              </Button>
              <Button
                variant={jsSubTab === 'preview' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setJsSubTab('preview');
                  runJsCode();
                }}
              >
                <Eye size={14} />
                Vista Previa
              </Button>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            {jsSubTab === 'js' && (
              <>
                <div className="tools-editor-heading">
                  <label>Código JavaScript</label>
                </div>
                <CodeEditor initial={jsCode} language="javascript" onChange={setJsCode} />
              </>
            )}

            {jsSubTab === 'dom' && (
              <>
                <div className="tools-editor-heading">
                  <label>Estructura HTML (DOM)</label>
                </div>
                <CodeEditor initial={jsDom} language="html" onChange={setJsDom} />
              </>
            )}

            {jsSubTab === 'preview' && (
              <div style={{ marginTop: '14px' }}>
                <div className="tools-editor-heading">
                  <label>Vista previa interactiva del Sandbox</label>
                </div>
                <iframe
                  title="JavaScript Sandbox"
                  srcDoc={compiledJsDoc}
                  sandbox="allow-scripts"
                  style={{
                    width: '100%',
                    height: '280px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: '#fff',
                  }}
                />
              </div>
            )}
          </div>

          <div className="tools-actions" style={{ marginTop: '14px' }}>
            <Button onClick={runJsCode}>
              <Play size={15} />
              Ejecutar / Recargar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(jsCode);
                  toast.success('Código JavaScript copiado.');
                } catch {
                  toast.error('No se pudo copiar.');
                }
              }}
            >
              <Copy size={14} />
              Copiar JS
            </Button>
            {jsResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setJsResult(null)}
                title="Limpiar consola"
              >
                <Trash2 size={14} />
                Limpiar logs
              </Button>
            )}
          </div>

          {jsResult && (
            <div
              style={{
                marginTop: '16px',
                borderRadius: '8px',
                background: 'var(--card-bg, #0f172a)',
                color: '#f8fafc',
                padding: '16px',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '8px',
                  fontSize: '12px',
                  color: '#94a3b8',
                }}
              >
                <span>CONSOLA JAVASCRIPT</span>
                {jsResult.executionTimeMs !== undefined && (
                  <span>{jsResult.executionTimeMs}ms</span>
                )}
              </div>
              {jsResult.output.length > 0 ? (
                jsResult.output.map((line, idx) => (
                  <pre
                    key={idx}
                    style={{
                      margin: '2px 0',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      color: line.startsWith('✖') ? '#f87171' : line.startsWith('⚠') ? '#facc15' : '#e2e8f0',
                    }}
                  >
                    {line}
                  </pre>
                ))
              ) : (
                <p style={{ margin: 0, color: '#94a3b8' }}>Sin logs de consola registrados.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 3: LABORATORIO TIKZ */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'tikz' && (
        <section className="admin-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <h2>Laboratorio TikZ (LaTeX Vectorial)</h2>
            <a
              href="https://tikz.dev/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'var(--primary)',
              }}
            >
              Documentación en TikZ.dev <ExternalLink size={12} />
            </a>
          </div>
          <p>
            Compila entornos tikzpicture con los estilos vectoriales de la plataforma. La prueba no
            modifica la clase; copia el código verificado a tu archivo .tex para importarlo.
          </p>

          <div className="tools-fields">
            <label>
              Clase
              <select
                value={tikzLessonId}
                onChange={(e) => {
                  setTikzLessonId(e.target.value);
                  setTikzSelected('');
                }}
              >
                <option value="">Seleccionar clase</option>
                {catalog.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recurso
              <select
                value={tikzSelected}
                onChange={(e) => {
                  const r = resources.find((item) => item.id === e.target.value);
                  setTikzSelected(e.target.value);
                  if (r) loadTikz(r.block.content);
                }}
              >
                <option value="">Seleccionar recurso de la clase</option>
                {resources
                  .filter((r) => r.lessonId === tikzLessonId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {currentLesson && (
            <details>
              <summary>Diagnóstico guardado de la importación ({currentLesson.diagnostics.length})</summary>
              {currentLesson.diagnostics.length ? (
                currentLesson.diagnostics.map((d, i) => <p key={i}>{d}</p>)
              ) : (
                <p>Sin avisos guardados. También puedes probar un recurso que falle al cargar.</p>
              )}
              <a href={currentLesson.source} download>
                Descargar fuente .tex
              </a>
            </details>
          )}

          {currentResource?.block.type === 'image' && (
            <div className="tools-resource-note">
              <p>
                Este recurso es una imagen. Revisa la ruta indicada abajo y el nombre del archivo.
              </p>
              <pre>{currentResource.block.content}</pre>
            </div>
          )}

          <div className="tools-editor-heading">
            <label>Código TikZ · {tikzSource.split('\n').length} líneas</label>
            <Button
              variant="outline"
              size="sm"
              disabled={tikzBusy}
              onClick={() => {
                setTikzSelected('');
                loadTikz(exampleTikz);
              }}
            >
              Cargar ejemplo
            </Button>
          </div>

          <CodeEditor key={tikzVersion} initial={tikzInitial} language="latex" onChange={setTikzSource} />

          <div className="tools-actions">
            <Button disabled={tikzBusy || !tikzSource.trim()} onClick={compileTikz}>
              <Play size={15} />
              {tikzBusy ? 'Compilando…' : 'Probar diagrama'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(tikzSource);
                  toast.success('Código TikZ copiado al portapapeles.');
                } catch {
                  setTikzError('No se pudo copiar. Selecciona y copia desde el editor.');
                }
              }}
            >
              <Copy size={15} />
              Copiar código
            </Button>
          </div>

          {tikzError && (
            <p role="alert" className="form-error">
              {tikzError}
            </p>
          )}

          {tikzResult && (
            <section className="tools-result" aria-label="Resultado de compilación">
              <p role="status" className={tikzResult.ok ? 'form-success' : 'form-error'}>
                {tikzResult.message}
                {tikzResult.line && ` Línea del diagrama: ${tikzResult.line}.`}
              </p>
              {tikzStale && <p>El código cambió. Vuelve a probarlo para actualizar este resultado.</p>}
              {tikzResult.hints.map((hint, i) => (
                <p key={i}>{hint}</p>
              ))}
              {tikzResult.svg && (
                <>
                  <div className="tools-diagram">
                    <img
                      alt="Vista previa del diagrama compilado"
                      src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(tikzResult.svg)))}`}
                    />
                  </div>
                  <a
                    download="diagrama.svg"
                    href={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(tikzResult.svg)))}`}
                  >
                    <Download size={15} /> Descargar SVG
                  </a>
                </>
              )}
              {tikzResult.log && (
                <details open={!tikzResult.ok}>
                  <summary>Registro del compilador</summary>
                  <pre>{tikzResult.log}</pre>
                </details>
              )}
            </section>
          )}
        </section>
      )}
    </main>
  );
}
