'use client';
import { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Wrench, Play, Download, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Block, Catalog } from '@/features/catalog/model/types';
const CodeEditor = dynamic(() => import('@/features/reader/components/code-editor'), {
  ssr: false,
  loading: () => <p>Cargando editor…</p>,
});
const example = String.raw`\begin{tikzpicture}[node distance=2cm]
\node[draw, rounded corners, fill=IdeaBody] (a) {Entrada};
\node[draw, rounded corners, fill=ResultBody, right=of a] (b) {Resultado};
\draw[->, thick] (a) -- (b);
\end{tikzpicture}`;
type Result = {
  ok: boolean;
  svg?: string;
  message: string;
  log?: string;
  line?: number;
  hints: string[];
};
export function ToolsPanel({ catalog, seed }: { catalog: Catalog; seed?: string }) {
  const [initial, setInitial] = useState(seed ?? example),
    [source, setSource] = useState(seed ?? example),
    [version, setVersion] = useState(0),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [lessonId, setLessonId] = useState(''),
    [testedSource, setTestedSource] = useState('');
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
    if (!seed) return;
    const r = resources.find((r) => r.block.content === seed);
    if (r) {
      setSelected(r.id);
      setLessonId(r.lessonId);
    }
  }, [seed, resources]);
  const resource = resources.find((r) => r.id === selected),
    lesson = catalog.lessons.find((l) => l.id === lessonId),
    stale = !!result && testedSource !== source;
  function load(value: string) {
    setInitial(value);
    setSource(value);
    setVersion((v) => v + 1);
    setResult(null);
    setError('');
  }
  async function compile() {
    setBusy(true);
    setError('');
    setResult(null);
    const code = source;
    const toastId = toast.loading('Compilando código TikZ con LaTeX vectorial…');
    try {
      const response = await fetch('/api/tools/tikz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTestedSource(code);
      setResult(data);
      if (data.ok) {
        toast.success('Diagrama generado correctamente.', { id: toastId });
      } else {
        toast.error(data.message || 'Error en la sintaxis de TikZ.', { id: toastId });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo probar el diagrama.';
      setError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="dashboard tools-page">
      <div className="eyebrow">ESPACIO DOCENTE</div>
      <h1>
        <Wrench />
        Herramientas
      </h1>
      <p>Prueba diagramas TikZ y revisa el código de los recursos de tus clases.</p>
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
          <h2>Laboratorio TikZ</h2>
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
            Documentación y editor en TikZ.dev <ExternalLink size={12} />
          </a>
        </div>
        <p>
          Compila un entorno tikzpicture con los colores y bibliotecas de la plantilla compartida.
          La prueba no modifica la clase; lleva el código corregido a tu archivo .tex y vuelve a
          importarlo.
        </p>
        <div className="tools-fields">
          <label>
            Clase
            <select
              value={lessonId}
              onChange={(e) => {
                setLessonId(e.target.value);
                setSelected('');
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
              value={selected}
              onChange={(e) => {
                const r = resources.find((r) => r.id === e.target.value);
                setSelected(e.target.value);
                if (r) load(r.block.content);
              }}
            >
              <option value="">Seleccionar recurso de la clase</option>
              {resources
                .filter((r) => r.lessonId === lessonId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {lesson && (
          <details>
            <summary>Diagnóstico guardado de la importación ({lesson.diagnostics.length})</summary>
            {lesson.diagnostics.length ? (
              lesson.diagnostics.map((d, i) => <p key={i}>{d}</p>)
            ) : (
              <p>Sin avisos guardados. También puedes probar un recurso que falle al cargar.</p>
            )}
            <a href={lesson.source} download>
              Descargar fuente .tex
            </a>
          </details>
        )}
        {resource?.block.type === 'image' && (
          <div className="tools-resource-note">
            <p>
              Este recurso es una imagen. Revisa la ruta indicada abajo, el nombre y las mayúsculas
              del archivo y si lo adjuntaste al importar.
            </p>
            <pre>{resource.block.content}</pre>
            {resource.block.asset ? (
              <a href={resource.block.asset} target="_blank" rel="noreferrer">
                Comprobar archivo de imagen
              </a>
            ) : (
              <p>No tiene un archivo asociado. Adjunta la imagen al volver a importar la clase.</p>
            )}
          </div>
        )}
        <div className="tools-editor-heading">
          <label>Código TikZ · {source.split('\n').length} líneas · máximo 50 KB</label>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSelected('');
              load(example);
            }}
          >
            Cargar ejemplo
          </Button>
        </div>
        <CodeEditor key={version} initial={initial} language="latex" onChange={setSource} />
        <div className="tools-actions">
          <Button disabled={busy || !source.trim()} onClick={compile}>
            <Play size={15} />
            {busy ? 'Compilando…' : 'Probar diagrama'}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(source);
              } catch {
                setError('No se pudo copiar. Selecciona y copia el código desde el editor.');
              }
            }}
          >
            <Copy size={15} />
            Copiar código
          </Button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {result && (
          <section className="tools-result" aria-label="Resultado de compilación">
            <p role="status" className={result.ok ? 'form-success' : 'form-error'}>
              {result.message}
              {result.line && ` Línea del diagrama: ${result.line}.`}
            </p>
            {stale && <p>El código cambió. Vuelve a probarlo para actualizar este resultado.</p>}
            {result.hints.map((hint, i) => (
              <p key={i}>{hint}</p>
            ))}
            {result.svg && (
              <>
                <div className="tools-diagram">
                  <img
                    alt="Vista previa del diagrama compilado"
                    src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(result.svg)))}`}
                  />
                </div>
                <a
                  download="diagrama.svg"
                  href={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(result.svg)))}`}
                >
                  <Download size={15} /> Descargar SVG
                </a>
              </>
            )}
            {result.log && (
              <details open={!result.ok}>
                <summary>Registro del compilador</summary>
                <pre>{result.log}</pre>
              </details>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
