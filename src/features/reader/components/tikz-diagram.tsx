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

async function calculateSha256(text: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    return '';
  }
  try {
    const enc = new TextEncoder().encode(text);
    const buf = await window.crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

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
  const [svgSource, setSvgSource] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code || !code.trim()) {
      setLoading(false);
      setError(true);
      return;
    }

    let active = true;
    setLoading(true);
    setRendered(false);
    setError(false);
    setSvgSource(null);

    const tryRender = async () => {
      // 1. Revisar si está precargado en window.TIKZ_CACHE
      if (typeof window !== 'undefined') {
        const win = window as unknown as {
          TIKZ_CACHE?: Record<string, { svg?: string; asset?: string }>;
        };
        if (win.TIKZ_CACHE) {
          const item = Object.values(win.TIKZ_CACHE).find((i) => i?.svg && code.includes(i.svg));
          if (item?.svg && active) {
            setSvgSource(item.svg);
            setLoading(false);
            setRendered(true);
            return;
          }
        }
      }

      // 2. Intentar cargar el asset estático precompilado por hash SHA-256
      const hash = await calculateSha256(code);
      if (hash && active) {
        try {
          const res = await fetch(`/assets/diagrams/${hash}.svg`, { method: 'HEAD' });
          if (res.ok && active) {
            setSvgSource(`/assets/diagrams/${hash}.svg`);
            setLoading(false);
            setRendered(true);
            return;
          }
        } catch {}
      }

      // 3. Fallback: TikZJax si no se encuentra el asset precompilado
      if (!active) return;
      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = '';
      await ensureTikZJaxLoaded();
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
            let minX = 0,
              minY = 0,
              width = 0,
              height = 0;
            // Siempre inferir los límites exactos desde las figuras y textos reales
            const paths = Array.from(svg.querySelectorAll('path'));
            const xs: number[] = [];
            const ys: number[] = [];
            for (const p of paths) {
              const d = p.getAttribute('d');
              if (d) {
                const commands = d.match(/([A-Za-z])|(-?[\d.]+)/g);
                if (commands) {
                  let currX = 0,
                    currY = 0;
                  for (let i = 0; i < commands.length; i++) {
                    const c = commands[i];
                    if (/^[A-Za-z]$/.test(c)) {
                      if (c === 'M' || c === 'L') {
                        currX = parseFloat(commands[++i]);
                        currY = parseFloat(commands[++i]);
                        if (!isNaN(currX) && !isNaN(currY)) {
                          xs.push(currX);
                          ys.push(currY);
                        }
                      } else if (c === 'm' || c === 'l') {
                        currX += parseFloat(commands[++i]);
                        currY += parseFloat(commands[++i]);
                        if (!isNaN(currX) && !isNaN(currY)) {
                          xs.push(currX);
                          ys.push(currY);
                        }
                      } else if (c === 'H') {
                        currX = parseFloat(commands[++i]);
                        if (!isNaN(currX)) xs.push(currX);
                      } else if (c === 'h') {
                        currX += parseFloat(commands[++i]);
                        if (!isNaN(currX)) xs.push(currX);
                      } else if (c === 'V') {
                        currY = parseFloat(commands[++i]);
                        if (!isNaN(currY)) ys.push(currY);
                      } else if (c === 'v') {
                        currY += parseFloat(commands[++i]);
                        if (!isNaN(currY)) ys.push(currY);
                      } else if (c === 'C') {
                        i += 4;
                        currX = parseFloat(commands[++i]);
                        currY = parseFloat(commands[++i]);
                        if (!isNaN(currX) && !isNaN(currY)) {
                          xs.push(currX);
                          ys.push(currY);
                        }
                      } else if (c === 'c') {
                        i += 4;
                        currX += parseFloat(commands[++i]);
                        currY += parseFloat(commands[++i]);
                        if (!isNaN(currX) && !isNaN(currY)) {
                          xs.push(currX);
                          ys.push(currY);
                        }
                      }
                    }
                  }
                }
              }
            }
            const texts = Array.from(svg.querySelectorAll('text'));
            for (const t of texts) {
              const x = parseFloat(t.getAttribute('x') || '');
              const y = parseFloat(t.getAttribute('y') || '');
              if (!isNaN(x)) xs.push(x);
              if (!isNaN(y)) ys.push(y);
            }
            if (xs.length > 0 && ys.length > 0) {
              minX = Math.min(...xs);
              minY = Math.min(...ys);
              width = Math.max(...xs) - minX;
              height = Math.max(...ys) - minY;
            } else {
              try {
                const bbox = svg.getBBox();
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                  minX = bbox.x;
                  minY = bbox.y;
                  width = bbox.width;
                  height = bbox.height;
                }
              } catch {}
            }

            if (width > 0 && height > 0) {
              const pad = 12;
              svg.setAttribute(
                'viewBox',
                `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(width + pad * 2).toFixed(2)} ${(height + pad * 2).toFixed(2)}`
              );
              svg.removeAttribute('width');
              svg.removeAttribute('height');
              svg.style.maxWidth = '100%';
              svg.style.width = '100%';
              svg.style.height = 'auto';
              svg.style.display = 'block';
              svg.style.margin = '0 auto';

              // Asegurar que las puntas de flecha cerradas se rellenen visiblemente
              for (const arrow of Array.from(svg.querySelectorAll('path'))) {
                const d = arrow.getAttribute('d') || '';
                if (/[Zz]/.test(d)) {
                  if (!arrow.getAttribute('fill')) arrow.setAttribute('fill', '#0f172a');
                  if (!arrow.getAttribute('stroke')) arrow.setAttribute('stroke', '#0f172a');
                }
              }
            }
          } catch (e) {
            console.warn('TikZJax bbox warning:', e);
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
      }, 7000);

      return () => {
        clearTimeout(timer);
        observer.disconnect();
      };
    };

    tryRender();

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
          <span>Cargando diagrama vectorial…</span>
        </div>
      )}

      {svgSource ? (
        <div
          className="tikz-render-target"
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'auto',
            maxWidth: '100%',
          }}
        >
          <img
            src={svgSource}
            alt="Diagrama TikZ"
            style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
            loading="lazy"
          />
        </div>
      ) : (
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
      )}

      {error && !rendered && !svgSource && (
        <div className="resource-pending">
          <p>No se pudo renderizar este diagrama TikZ de forma automática.</p>
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
