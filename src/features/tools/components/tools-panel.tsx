'use client';
import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Wrench,
  Play,
  Copy,
  ExternalLink,
  Terminal,
  Code2,
  Trash2,
  RotateCcw,
  Maximize,
  Minimize,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Catalog } from '@/features/catalog/model/types';
import {
  runPython,
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

function CodePenInteractive({
  fullscreen,
  onToggleFullscreen,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const height = fullscreen ? '100%' : '750';
      containerRef.current.innerHTML = `
<p class="codepen" data-height="${height}" data-pen-title="Untitled" data-version="2" data-theme-id="dark" data-default-tab="html,result" data-slug-hash="dPWYOay" data-user="Deimer-Miranda" style="height: ${fullscreen ? '100%' : '750px'}; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); margin: 0; padding: 1em; border-radius: 8px; background: #131417; color: #fff;">
  <span>Ver proyecto en <a href="https://codepen.io/editor/Deimer-Miranda/pen/01a1f3e2-8283-7ca7-ab31-a2a6fa2a5d5a">CodePen</a> por Deimer Miranda (<a href="https://codepen.io/Deimer-Miranda">@Deimer-Miranda</a>).</span>
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
  }, [fullscreen]);

  // Soporte para salir con tecla Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleFullscreen();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fullscreen, onToggleFullscreen]);

  return (
    <div
      style={
        fullscreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: '#131417',
              display: 'flex',
              flexDirection: 'column',
              padding: '10px 16px',
            }
          : { marginTop: '14px', width: '100%' }
      }
    >
      {fullscreen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 6px 12px',
            borderBottom: '1px solid #2d3748',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>
            <Code2 size={16} />
            <span>CodePen · Modo Pantalla Completa</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://codepen.io/editor/Deimer-Miranda/pen/01a1f3e2-8283-7ca7-ab31-a2a6fa2a5d5a"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <ExternalLink size={13} />
                Abrir en CodePen nativo
              </a>
            </Button>
            <Button variant="default" size="sm" onClick={onToggleFullscreen}>
              <Minimize size={14} />
              Salir de pantalla completa (Esc)
            </Button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: fullscreen ? 'calc(100vh - 65px)' : '750px',
          minHeight: fullscreen ? 'calc(100vh - 65px)' : '750px',
          borderRadius: fullscreen ? '0' : '8px',
          overflow: 'hidden',
          background: '#131417',
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
  const [codepenFullscreen, setCodepenFullscreen] = useState(false);

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

  return (
    <main className="dashboard tools-page">
      <div className="eyebrow">ESPACIO DE HERRAMIENTAS Y ENTORNOS</div>
      <h1>
        <Wrench />
        Zona de Entornos de Práctica
      </h1>
      <p>
        Entornos dedicados para ejecutar algoritmos científicos en Python y proyectos interactivos
        en JavaScript, HTML y CSS mediante CodePen.
      </p>

      {/* Selector de Entornos principales */}
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
      {/* PESTAÑA 2: ENTORNO WEB (JAVASCRIPT, HTML Y CSS - CODEPEN) */}
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
                Entorno Web: JavaScript, HTML y CSS (CodePen)
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                Editor interactivo completo con pestañas para HTML, CSS, JavaScript y resultado en tiempo real.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCodepenFullscreen((prev) => !prev)}
                title="Alternar modo pantalla completa"
              >
                {codepenFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                <span>{codepenFullscreen ? 'Reducir' : 'Pantalla Completa'}</span>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://codepen.io/editor/Deimer-Miranda/pen/01a1f3e2-8283-7ca7-ab31-a2a6fa2a5d5a"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <ExternalLink size={13} />
                  Abrir en CodePen nativo
                </a>
              </Button>
            </div>
          </div>

          <CodePenInteractive
            fullscreen={codepenFullscreen}
            onToggleFullscreen={() => setCodepenFullscreen(false)}
          />
        </section>
      )}
    </main>
  );
}
