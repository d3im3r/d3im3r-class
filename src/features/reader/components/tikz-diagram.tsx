'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';

export const TIKZ_PREAMBLE = `
\\usetikzlibrary{calc,positioning,arrows.meta,mindmap,shapes,fit,backgrounds,decorations.pathreplacing}
\\definecolor{BrandYellow}{RGB}{255,185,62}
\\definecolor{BrandGreen}{RGB}{20,196,134}
\\definecolor{BrandBlue}{RGB}{30,60,120}
\\definecolor{DarkBG}{RGB}{14,16,20}
\\definecolor{DarkFG}{RGB}{235,235,235}
\\definecolor{SoftGray}{RGB}{245,246,248}
\\definecolor{MediumGray}{RGB}{210,213,218}
\\definecolor{DarkGray}{RGB}{45,47,52}
\\definecolor{pybg}{rgb}{0.12,0.18,0.30}
\\definecolor{cppbg}{rgb}{0.10,0.10,0.10}
\\definecolor{bashbg}{rgb}{0.2,0.2,0.2}
\\definecolor{HtmlClaroFondo}{HTML}{F7F7F7}
\\definecolor{HtmlClaroBorde}{HTML}{D0D0D0}
\\definecolor{HtmlOscuroFondo}{HTML}{1E1E1E}
\\definecolor{HtmlOscuroBorde}{HTML}{444444}
\\definecolor{WarningBody}{RGB}{255,243,205}
\\definecolor{IdeaTitle}{RGB}{30,60,120}
\\definecolor{IdeaBody}{RGB}{235,241,255}
\\definecolor{PracticeTitle}{RGB}{20,120,90}
\\definecolor{PracticeBody}{RGB}{232,250,245}
\\definecolor{DefTitle}{RGB}{90,70,160}
\\definecolor{DefBody}{RGB}{240,236,255}
\\definecolor{ResultTitle}{RGB}{0,120,0}
\\definecolor{ResultBody}{RGB}{235,250,235}
\\definecolor{WarnTitle}{RGB}{160,30,30}
\\definecolor{WarnBody}{RGB}{255,235,235}
\\definecolor{CompareTitle}{RGB}{28,92,145}
\\definecolor{CompareBody}{RGB}{235,245,252}
\\definecolor{QuestionTitle}{RGB}{176,112,20}
\\definecolor{QuestionBody}{RGB}{255,247,229}
\\definecolor{ExampleTitle}{RGB}{84,78,150}
\\definecolor{ExampleBody}{RGB}{243,241,255}
\\definecolor{CodigoClaroFondo}{HTML}{F7F7F7}
\\definecolor{CodigoClaroBorde}{HTML}{D0D0D0}
\\definecolor{CodigoOscuroFondo}{HTML}{1E1E1E}
\\definecolor{CodigoOscuroBorde}{HTML}{444444}
`;

const ROD2IK_FONTS = 'https://cdn.jsdelivr.net/npm/@rod2ik/tikzjax@1.6.0/dist/fonts.min.css';
const ROD2IK_SCRIPT = 'https://cdn.jsdelivr.net/npm/@rod2ik/tikzjax@1.6.0/dist/tikzjax.min.js';
const FALLBACK_FONTS = 'https://tikzjax.com/v1/fonts.css';
const FALLBACK_SCRIPT = 'https://tikzjax.com/v1/tikzjax.js';

function ensureTikZJaxLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as unknown as { __tikzjax_ready?: boolean }).__tikzjax_ready)
    return Promise.resolve();

  return new Promise((resolve) => {
    if (!document.querySelector('link[data-tikzjax-fonts]')) {
      const link = document.createElement('link');
      link.setAttribute('data-tikzjax-fonts', 'true');
      link.rel = 'stylesheet';
      link.href = ROD2IK_FONTS;
      link.onerror = () => {
        link.href = FALLBACK_FONTS;
      };
      document.head.appendChild(link);
    }

    const existing = document.querySelector('script[src*="tikzjax"]');
    if (existing) {
      if ((window as unknown as { __tikzjax_ready?: boolean }).__tikzjax_ready) {
        resolve();
      } else {
        existing.addEventListener('load', () => {
          (window as unknown as { __tikzjax_ready?: boolean }).__tikzjax_ready = true;
          resolve();
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = ROD2IK_SCRIPT;
    script.async = true;
    script.onload = () => {
      (window as unknown as { __tikzjax_ready?: boolean }).__tikzjax_ready = true;
      resolve();
    };
    script.onerror = () => {
      // Fallback to legacy tikzjax if CDN fails
      const fallback = document.createElement('script');
      fallback.src = FALLBACK_SCRIPT;
      fallback.async = true;
      fallback.onload = () => {
        (window as unknown as { __tikzjax_ready?: boolean }).__tikzjax_ready = true;
        resolve();
      };
      fallback.onerror = () => resolve();
      document.head.appendChild(fallback);
    };
    document.head.appendChild(script);
  });
}

export function TikZDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code || !code.trim()) {
      setLoading(false);
      setError(true);
      return;
    }

    let active = true;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    setLoading(true);
    setRendered(false);
    setError(false);

    ensureTikZJaxLoaded().then(() => {
      if (!active) return;

      const script = document.createElement('script');
      script.type = 'text/tikz';
      const needsPreamble = !code.includes('\\definecolor') && !code.includes('\\usetikzlibrary');
      script.textContent = needsPreamble ? `${TIKZ_PREAMBLE}\n${code}` : code;
      container.appendChild(script);

      try {
        const win = window as unknown as { onload?: () => void };
        if (typeof win.onload === 'function') {
          win.onload();
        }
      } catch (e) {
        console.warn('TikZJax trigger warning:', e);
      }

      const observer = new MutationObserver(() => {
        const svg = container.querySelector('svg');
        if (svg && active) {
          try {
            const bbox = svg.getBBox();
            if (bbox && bbox.width > 0 && bbox.height > 0) {
              const pad = 8;
              svg.setAttribute(
                'viewBox',
                `${(bbox.x - pad).toFixed(2)} ${(bbox.y - pad).toFixed(2)} ${(bbox.width + pad * 2).toFixed(2)} ${(bbox.height + pad * 2).toFixed(2)}`
              );
              svg.style.maxWidth = '100%';
              svg.style.width = 'auto';
              svg.style.height = 'auto';
              svg.style.display = 'block';
              svg.style.margin = '0 auto';
            }
          } catch (e) {
            console.warn('TikZJax getBBox warning:', e);
          }
          setLoading(false);
          setRendered(true);
          observer.disconnect();
        }
      });

      observer.observe(container, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        if (active && !container.querySelector('svg')) {
          setLoading(false);
          setError(true);
          observer.disconnect();
        }
      }, 12000);

      return () => {
        clearTimeout(timer);
        observer.disconnect();
      };
    });

    return () => {
      active = false;
    };
  }, [code]);

  return (
    <div
      className="tikz-container"
      style={{ margin: '15px auto', textAlign: 'center', width: '100%' }}
    >
      {loading && (
        <div
          className="tikz-loading"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '20px',
            color: 'var(--muted)',
            fontSize: '13px',
          }}
        >
          <Loader2 className="animate-spin" size={16} />
          <span>Renderizando diagrama con TikZJax…</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="tikz-render-target"
        style={{
          display: rendered ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'auto',
          maxWidth: '100%',
        }}
      />
      {error && !rendered && (
        <div className="resource-pending">
          <p>No se pudo renderizar este diagrama TikZ en el navegador.</p>
          <a
            href="https://tikz.dev/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              marginTop: '6px',
              color: 'var(--primary)',
            }}
          >
            Documentación y editor en TikZ.dev <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  );
}
