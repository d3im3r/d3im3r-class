'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Check, Copy, RotateCcw, Pencil, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
const Editor = dynamic(() => import('./code-editor'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">Cargando editor…</p>,
});
const highlightCache = new Map<string, string>();
export function CodeBlock({ content, language = 'text' }: { content: string; language?: string }) {
  const cacheKey = `${language}\0${content}`;
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(content),
    [copied, setCopied] = useState(false),
    [highlighted, setHighlighted] = useState(() => highlightCache.get(cacheKey) ?? '');
  const container = useRef<HTMLDivElement>(null);
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
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="code-block" ref={container}>
      <div className="code-toolbar">
        <span>
          <Code2 size={14} />
          {language === 'text' ? 'Salida de consola' : language}
        </span>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            <Pencil size={13} />
            {editing ? 'Ver original' : 'Editar'}
          </Button>
          {editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(content);
                setEditing(false);
              }}
              aria-label="Restablecer código"
            >
              <RotateCcw size={13} />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      </div>
      {editing ? (
        <>
          <Editor initial={content} language={language} onChange={setValue} />
          <p className="editor-note">
            Espacio de práctica local · La ejecución de código aún no está habilitada.
          </p>
        </>
      ) : highlighted ? (
        <div className="code-highlight" dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <pre>{content}</pre>
      )}
    </div>
  );
}
