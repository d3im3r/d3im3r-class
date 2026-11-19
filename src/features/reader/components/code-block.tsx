'use client';
import { useState, useEffect, useRef, useContext } from 'react';
import { Check, Copy, Code2, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { detectLanguage } from '../lib/parser-utils';
import { ResourceToolsContext } from '@/shared/context/resource-tools-context';

const highlightCache = new Map<string, string>();

const langLabels: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  json: 'JSON',
  bash: 'Bash / Shell',
  cpp: 'C++',
  c: 'C',
  java: 'Java',
  rust: 'Rust',
  text: 'Código',
};

export function CodeBlock({ content, language = 'text' }: { content: string; language?: string }) {
  const canUseTools = useContext(ResourceToolsContext);
  const resolvedLang = detectLanguage(content, language);
  const cacheKey = `${resolvedLang}\0${content}`;
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(() => highlightCache.get(cacheKey) ?? '');
  const container = useRef<HTMLDivElement>(null);

  // Control de tamaño de fuente del código sincronizado (predeterminado 20px)
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('d3im3r_code_font_size_v20');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 12 && parsed <= 34) return parsed;
      }
    }
    return 20;
  });

  useEffect(() => {
    const handleSizeSync = (e: Event) => {
      const size = (e as CustomEvent<number>).detail;
      if (size && size >= 12 && size <= 34) {
        setFontSize(size);
      }
    };
    window.addEventListener('d3im3r:code-size-change', handleSizeSync);
    return () => window.removeEventListener('d3im3r:code-size-change', handleSizeSync);
  }, []);

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(34, Math.max(12, prev + delta));
      if (typeof window !== 'undefined') {
        localStorage.setItem('d3im3r_code_font_size_v20', String(next));
        window.dispatchEvent(new CustomEvent('d3im3r:code-size-change', { detail: next }));
      }
      return next;
    });
  };

  const resetFontSize = () => {
    setFontSize(20);
    if (typeof window !== 'undefined') {
      localStorage.setItem('d3im3r_code_font_size_v20', '20');
      window.dispatchEvent(new CustomEvent('d3im3r:code-size-change', { detail: 20 }));
    }
  };

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
              lang: resolvedLang === 'text' ? 'text' : resolvedLang,
              themes: { light: 'one-light', dark: 'one-dark-pro' },
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
  }, [cacheKey, content, resolvedLang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Código copiado al portapapeles. Listo para pegar en Herramientas.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error('No se pudo copiar automáticamente.');
    }
  };

  const openInTools = () => {
    window.dispatchEvent(
      new CustomEvent('aula:inspect-resource', {
        detail: {
          code: content,
          language: resolvedLang,
        },
      })
    );
  };

  const cleanLang =
    langLabels[resolvedLang] ?? (resolvedLang === 'text' ? 'Código' : resolvedLang.toUpperCase());

  return (
    <div className="code-block" ref={container}>
      <div className="code-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>
            <Code2 size={14} />
            {cleanLang}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Controles de aumento/disminución de tamaño de código */}
          <div
            className="code-font-controls"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              marginRight: '4px',
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => adjustFontSize(-1)}
              disabled={fontSize <= 12}
              className="code-zoom-btn"
              title="Disminuir tamaño del código (A-)"
              aria-label="Disminuir tamaño del código"
              style={{ height: '26px', padding: '0 6px' }}
            >
              <ZoomOut size={13} />
            </Button>
            <button
              type="button"
              onClick={resetFontSize}
              title="Restablecer tamaño predeterminado (20px)"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '2px 4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: 0.8,
              }}
            >
              {fontSize}px
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => adjustFontSize(1)}
              disabled={fontSize >= 34}
              className="code-zoom-btn"
              title="Aumentar tamaño del código (A+)"
              aria-label="Aumentar tamaño del código"
              style={{ height: '26px', padding: '0 6px' }}
            >
              <ZoomIn size={13} />
            </Button>
          </div>

          {canUseTools && (
            <Button
              variant="outline"
              size="sm"
              onClick={openInTools}
              className="code-tools-btn"
              title="Abrir este código en la zona de herramientas para ejecutarlo"
            >
              <ExternalLink size={13} />
              <span>Probar en Herramientas</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            className="code-copy-btn"
            title="Copiar código al portapapeles"
          >
            {copied ? (
              <>
                <Check size={14} style={{ color: '#10b981' }} />
                <span style={{ color: '#10b981', fontWeight: 600 }}>¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copiar código</span>
              </>
            )}
          </Button>
        </div>
      </div>
      <div className="code-content" style={{ fontSize: `${fontSize}px` }}>
        {highlighted ? (
          <div dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre>
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
