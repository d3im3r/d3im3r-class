'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Check,
  Copy,
  RotateCcw,
  Pencil,
  Code2,
  Play,
  Loader2,
  Trash2,
  Terminal,
  Eye,
  FileCode,
  LayoutTemplate,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  runPython,
  getLanguageCategory,
  buildSandboxDocument,
  DEFAULT_JS_DOM_TEMPLATE,
  type RunResult,
} from '../lib/code-runner';

const Editor = dynamic(() => import('./code-editor'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">Cargando editor…</p>,
});

const highlightCache = new Map<string, string>();

export function CodeBlock({ content, language = 'text' }: { content: string; language?: string }) {
  const category = getLanguageCategory(language);
  const canRun = category !== 'unsupported';
  const cacheKey = `${language}\0${content}`;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(content);
  const [domHtml, setDomHtml] = useState(DEFAULT_JS_DOM_TEMPLATE);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(() => highlightCache.get(cacheKey) ?? '');

  // Estados de ejecución
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'dom' | 'preview'>('code');

  const sandboxId = useRef(`sb-${Math.random().toString(36).slice(2, 9)}`);
  const [compiledDoc, setCompiledDoc] = useState('');

  const container = useRef<HTMLDivElement>(null);

  // Inicializar sandbox al montar o cambiar contenido
  useEffect(() => {
    setValue(content);
    setDomHtml(DEFAULT_JS_DOM_TEMPLATE);
    setRunResult(null);
    setConsoleOpen(false);
    setActiveTab('code');
    setCompiledDoc(
      buildSandboxDocument({
        html: DEFAULT_JS_DOM_TEMPLATE,
        js: content,
        sandboxId: sandboxId.current,
      })
    );
  }, [content]);

  // Escuchar logs enviados desde el iframe del sandbox
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
        setRunResult((prev) => {
          const currentOutputs = prev?.output ?? [];
          return {
            success: prev ? prev.success && e.data.level !== 'error' : e.data.level !== 'error',
            output: [...currentOutputs, line],
            error: e.data.level === 'error' ? e.data.message : prev?.error,
            executionTimeMs: prev?.executionTimeMs ?? 15,
          };
        });
      }
    };

    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  useEffect(() => {
    const cached = highlightCache.get(cacheKey);
    if (cached !== undefined) {
      setHighlighted(cached);
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        import('shiki')
          .then(({ codeToHtml }) =>
            codeToHtml(content, {
              lang: language === 'text' ? 'text' : language,
              themes: { light: 'github-light', dark: 'github-dark' },
              defaultColor: false,
            })
          )
          .then((html) => {
            highlightCache.set(cacheKey, html);
            if (active) setHighlighted(html);
          })
          .catch(() => {});
      },
      { rootMargin: '350px' }
    );
    if (container.current) observer.observe(container.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [cacheKey, content, language]);

  const copy = async () => {
    try {
      const textToCopy = activeTab === 'dom' ? domHtml : value;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleExecute = useCallback(async () => {
    if (!canRun || running) return;

    if (category === 'html') {
      setActiveTab('preview');
      return;
    }

    if (category === 'javascript') {
      const start = performance.now();
      setRunning(true);
      setConsoleOpen(true);
      setRunResult({ success: true, output: [] });

      // Generar el documento sandbox integrado con HTML DOM y JS
      const doc = buildSandboxDocument({
        html: domHtml,
        js: value,
        sandboxId: sandboxId.current,
      });

      // Recargar el iframe
      setCompiledDoc('');
      setTimeout(() => {
        setCompiledDoc(doc);
        const elapsed = Math.round(performance.now() - start);
        setRunResult((prev) => ({
          success: prev?.success ?? true,
          output: prev?.output ?? [],
          executionTimeMs: elapsed,
        }));
        setRunning(false);
      }, 50);
      return;
    }

    if (category === 'python') {
      setRunning(true);
      setConsoleOpen(true);
      setStatusText('Iniciando entorno Python…');

      try {
        const result = await runPython(value, (st) => setStatusText(st));
        setRunResult(result);
      } catch (err: unknown) {
        setRunResult({
          success: false,
          output: [],
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRunning(false);
        setStatusText('');
      }
    }
  }, [canRun, running, category, domHtml, value]);

  // Atajo de teclado: Ctrl+Enter o Cmd+Enter para ejecutar
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  };

  return (
    <div className="code-block" ref={container} onKeyDown={handleKeyDown}>
      <div className="code-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>
            <Code2 size={14} />
            {language === 'text' ? 'Salida de consola' : language}
          </span>

          {category === 'javascript' && (
            <div className="code-tabs">
              <button
                type="button"
                className={`code-tab-btn ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
                title="Editar código JavaScript"
              >
                <FileCode size={12} />
                JS
              </button>
              <button
                type="button"
                className={`code-tab-btn ${activeTab === 'dom' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('dom');
                  setEditing(true);
                }}
                title="Editar panel HTML / DOM sobre el cual actúa el JavaScript"
              >
                <LayoutTemplate size={12} />
                HTML (DOM)
              </button>
              <button
                type="button"
                className={`code-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('preview');
                  handleExecute();
                }}
                title="Ver resultado interactivo en vivo"
              >
                <Eye size={12} />
                Vista previa
              </button>
            </div>
          )}

          {category === 'html' && (
            <div className="code-tabs">
              <button
                type="button"
                className={`code-tab-btn ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                <FileCode size={12} />
                Código
              </button>
              <button
                type="button"
                className={`code-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => setActiveTab('preview')}
              >
                <Eye size={12} />
                Vista previa
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {canRun && (
            <Button
              size="sm"
              variant="default"
              className="code-run-btn"
              onClick={handleExecute}
              disabled={running}
              title="Ejecutar código interactivo (Ctrl + Enter)"
            >
              {running ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>{statusText || 'Ejecutando…'}</span>
                </>
              ) : (
                <>
                  <Play size={13} fill="currentColor" />
                  <span>Ejecutar</span>
                  <kbd className="code-kbd">Ctrl+↵</kbd>
                </>
              )}
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(!editing);
              if (!editing && activeTab === 'preview') setActiveTab('code');
            }}
          >
            <Pencil size={13} />
            {editing ? 'Ver original' : 'Editar'}
          </Button>

          {editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(content);
                setDomHtml(DEFAULT_JS_DOM_TEMPLATE);
                setRunResult(null);
                setConsoleOpen(false);
              }}
              title="Restablecer código original"
              aria-label="Restablecer código"
            >
              <RotateCcw size={13} />
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={copy} title="Copiar código al portapapeles">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      </div>

      {activeTab === 'preview' ? (
        <div className="html-preview-container">
          <iframe
            srcDoc={category === 'html' ? value : compiledDoc}
            sandbox="allow-scripts allow-modals"
            title="Vista previa interactiva"
            className="html-preview-frame"
          />
        </div>
      ) : activeTab === 'dom' ? (
        <>
          <Editor initial={domHtml} language="html" onChange={setDomHtml} />
          <div className="editor-note">
            <span>
              🌐 <strong>Panel HTML / DOM:</strong> Modifica la estructura HTML sobre la que opera
              el JavaScript. Presiona <strong>Ejecutar</strong> o ve a <strong>Vista previa</strong>{' '}
              para interactuar con el DOM.
            </span>
          </div>
        </>
      ) : editing ? (
        <>
          <Editor initial={value} language={language} onChange={setValue} />
          <div className="editor-note">
            <span>
              💡 <strong>Laboratorio interactivo:</strong> Modifica el código y presiona{' '}
              <strong>Ejecutar</strong> (o <kbd>Ctrl+Enter</kbd>) para ver los resultados en vivo.
            </span>
          </div>
        </>
      ) : highlighted ? (
        <div className="code-highlight" dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <pre>{value}</pre>
      )}

      {/* Consola de ejecución */}
      {consoleOpen && (
        <div className="code-console">
          <div className="code-console-header">
            <div className="code-console-title">
              <Terminal size={14} />
              <span>Terminal / Salida</span>
              {runResult && (
                <span
                  className={`code-console-badge ${runResult.success ? 'is-success' : 'is-error'}`}
                >
                  {runResult.success ? 'Éxito' : 'Error'}
                  {runResult.executionTimeMs !== undefined && ` · ${runResult.executionTimeMs} ms`}
                </span>
              )}
            </div>
            <div className="code-console-actions">
              <button
                type="button"
                className="code-console-btn"
                onClick={() => setRunResult(null)}
                title="Limpiar salida de consola"
              >
                <Trash2 size={12} />
                Limpiar
              </button>
              <button
                type="button"
                className="code-console-btn"
                onClick={() => setConsoleOpen(false)}
                title="Cerrar consola"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="code-console-body">
            {running && (
              <div className="code-console-loading">
                <Loader2 size={14} className="animate-spin" />
                <span>{statusText || 'Ejecutando código en el navegador…'}</span>
              </div>
            )}

            {runResult?.error && (
              <div className="code-console-error">
                <pre>{runResult.error}</pre>
              </div>
            )}

            {runResult && runResult.output.length > 0 && (
              <div className="code-console-lines">
                {runResult.output.map((line, idx) => (
                  <div key={idx} className="code-console-line">
                    <span className="code-console-prompt">&gt;</span>
                    <pre className="code-console-text">{line}</pre>
                  </div>
                ))}
              </div>
            )}

            {runResult && runResult.output.length === 0 && !runResult.error && !running && (
              <div className="code-console-empty">
                {category === 'javascript'
                  ? 'Código ejecutado en el sandbox DOM. Usa la pestaña "Vista previa" para interactuar visualmente, o console.log() para ver datos aquí.'
                  : 'Sin salida de consola.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
