'use client';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Wrench,
  Play,
  Copy,
  ExternalLink,
  Terminal,
  Code2,
  Trash2,
  LayoutTemplate,
  Eye,
  FileCode,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Catalog } from '@/features/catalog/model/types';
import {
  runPython,
  buildSandboxDocument,
  DEFAULT_JS_DOM_TEMPLATE,
  getLanguageCategory,
  type RunResult,
} from '../lib/code-runner';

const CodeEditor = dynamic(() => import('./code-editor'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">Cargando editor…</p>,
});

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

function CodePenInteractive() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = `
<p class="codepen" data-height="520" data-pen-title="Untitled" data-version="2" data-default-tab="html,result" data-slug-hash="dPWYOay" data-user="Deimer-Miranda" style="height: 520px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid var(--border); margin: 0; padding: 1em; border-radius: 8px;">
  <span>See the Pen <a href="https://codepen.io/editor/Deimer-Miranda/pen/01a1f3e2-8283-7ca7-ab31-a2a6fa2a5d5a">
  Untitled</a> by Deimer Miranda (<a href="https://codepen.io/Deimer-Miranda">@Deimer-Miranda</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
      `;
    }

    const scriptSrc = 'https://public.codepenassets.com/embed/index.js';
    let script = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      document.body.appendChild(script);
    } else if (typeof (window as any).__CPEmbed === 'function') {
      (window as any).__CPEmbed();
    }
  }, []);

  return (
    <div style={{ marginTop: '14px', width: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          minHeight: '520px',
          borderRadius: '8px',
          overflow: 'hidden',
          background: 'var(--card)',
        }}
      />
    </div>
  );
}

export function ToolsPanel({
  catalog,
  seed,
  initialLanguage,
}: {
  catalog: Catalog;
  seed?: string;
  initialLanguage?: string;
}) {
  // Determinar pestaña inicial según el lenguaje recibido
  const initialCategory = useMemo(() => {
    if (initialLanguage) {
      const cat = getLanguageCategory(initialLanguage);
      if (cat === 'python') return 'python';
      if (cat === 'javascript' || cat === 'html') return 'javascript';
    }
    if (seed) {
      if (seed.includes('def ') || seed.includes('import ') || seed.includes('numpy') || seed.includes('np.')) {
        return 'python';
      }
      if (seed.includes('console.') || seed.includes('document.') || seed.includes('function ') || seed.includes('<div') || seed.includes('<html')) {
        return 'javascript';
      }
    }
    return 'python';
  }, [seed, initialLanguage]);

  const [activeTab, setActiveTab] = useState<'python' | 'javascript'>(initialCategory);

  // ----------------------------------------
  // Estado: Entorno Python
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
  // Estado: Entorno JavaScript, HTML y CSS
  // ----------------------------------------
  const [jsCode, setJsCode] = useState(
    initialCategory === 'javascript' && seed ? seed : exampleJs
  );
  const [jsDom, setJsDom] = useState(DEFAULT_JS_DOM_TEMPLATE);
  const [jsSubTab, setJsSubTab] = useState<'codepen' | 'js' | 'dom' | 'preview'>(
    seed && initialCategory === 'javascript' ? 'js' : 'codepen'
  );
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

  return (
    <main className="dashboard tools-page">
      <div className="eyebrow">ESPACIO DE HERRAMIENTAS Y ENTORNOS</div>
      <h1>
        <Wrench />
        Zona de Entornos de Práctica
      </h1>
      <p>
        Entornos dedicados para ejecutar algoritmos científicos en Python y proyectos interactivos
        en JavaScript, HTML y CSS.
      </p>

      {/* Selector de Entornos */}
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
          Entorno Python (NumPy)
        </Button>
        <Button
          variant={activeTab === 'javascript' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('javascript')}
        >
          <Code2 size={15} />
          Entorno Web (JavaScript, HTML y CSS)
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 1: ENTORNO PYTHON */}
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

          <div style={{ marginTop: '14px' }}>
            <CodeEditor initial={pythonCode} language="python" onChange={setPythonCode} />
          </div>

          <div className="tools-actions" style={{ marginTop: '14px' }}>
            <Button onClick={runPythonCode} disabled={pythonRunning}>
              <Play size={15} />
              {pythonRunning ? (pythonStatus || 'Ejecutando...') : 'Ejecutar Python'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pythonCode);
                  toast.success('Código Python copiado al portapapeles.');
                } catch {
                  toast.error('No se pudo copiar.');
                }
              }}
            >
              <Copy size={14} />
              Copiar
            </Button>
            {pythonResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPythonResult(null)}
                title="Limpiar salida"
              >
                <Trash2 size={14} />
                Limpiar salida
              </Button>
            )}
          </div>

          {pythonResult && (
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
                <span>SALIDA DE EJECUCIÓN (STDOUT / STDERR)</span>
                {pythonResult.executionTimeMs !== undefined && (
                  <span>{pythonResult.executionTimeMs}ms</span>
                )}
              </div>
              {pythonResult.output.length > 0 ? (
                pythonResult.output.map((line, idx) => (
                  <pre key={idx} style={{ margin: '2px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {line}
                  </pre>
                ))
              ) : (
                <p style={{ margin: 0, color: '#94a3b8' }}>Sin salida registrada en consola.</p>
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
      {/* PESTAÑA 2: ENTORNO WEB (JAVASCRIPT, HTML Y CSS) */}
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
                Entorno Web: JavaScript, HTML y CSS
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                Editor interactivo CodePen integrado y entorno de pruebas JavaScript en tiempo real.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <Button
                variant={jsSubTab === 'codepen' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setJsSubTab('codepen')}
              >
                <Code2 size={14} />
                CodePen Interactivo
              </Button>
              <Button
                variant={jsSubTab === 'js' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setJsSubTab('js')}
              >
                <FileCode size={14} />
                JavaScript Local
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
                Vista Previa Sandbox
              </Button>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            {jsSubTab === 'codepen' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    Espacio de programación interactivo con soporte completo para HTML, CSS y JS.
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://codepen.io/editor/Deimer-Miranda/pen/01a1f3e2-8283-7ca7-ab31-a2a6fa2a5d5a"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      <ExternalLink size={13} />
                      Abrir en CodePen
                    </a>
                  </Button>
                </div>
                <CodePenInteractive />
              </div>
            )}

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
                    height: '320px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: '#fff',
                  }}
                />
              </div>
            )}
          </div>

          {jsSubTab !== 'codepen' && (
            <>
              <div className="tools-actions" style={{ marginTop: '14px' }}>
                <Button onClick={runJsCode}>
                  <Play size={15} />
                  Ejecutar / Recargar Sandbox
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
            </>
          )}
        </section>
      )}
    </main>
  );
}
