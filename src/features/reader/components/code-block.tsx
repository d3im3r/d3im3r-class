'use client';
import { useState, useEffect, useRef } from 'react';
import { Check, Copy, Code2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { detectLanguage } from '../lib/parser-utils';

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
  const resolvedLang = detectLanguage(content, language);
  const cacheKey = `${resolvedLang}\0${content}`;
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(() => highlightCache.get(cacheKey) ?? '');
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
      <div className="code-content">
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
