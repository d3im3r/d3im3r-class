'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  X,
  List,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandSignature } from '@/features/theme/brand-signature';
import { ThemeControls } from '@/features/theme/theme-toggle';
import type { Block, Frame, Institution, Lesson, Subject } from '@/features/catalog/model/types';
import { ContentBlock } from './content-block';
import { InlineText } from './rich-text';
import { institutionLogo } from '@/features/catalog/model/institution-logo';

export interface SlideDeckProps {
  lesson: Lesson;
  subject: Subject;
  institution: Institution;
  current: number;
  onFrameChange: (index: number) => void;
  onClose: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/**
 * Filtra artefactos vacíos o llaves de LaTeX que no aportan contenido
 */
function filterVisibleBlocks(blocks: Block[] = []): Block[] {
  return blocks.filter((b) => {
    if (b.type === 'text') {
      const trimmed = (b.content || '').trim();
      if (
        !trimmed ||
        trimmed === '{}' ||
        trimmed === '[]' ||
        trimmed === '()' ||
        /^\s*\[[TtCcBb]\]\s*$/.test(trimmed) ||
        /^\s*\d+(?:\.\d+)?\\(?:textwidth|linewidth|columnwidth)\s*$/.test(trimmed)
      ) {
        return false;
      }
    }
    if (b.type === 'callout') {
      const hasContent = !!b.content?.trim() && b.content.trim() !== '{}';
      const hasChildren = !!b.children?.length;
      if (!hasContent && !hasChildren) return false;
    }
    return true;
  });
}

/**
 * Estima la altura en píxeles de un bloque dentro del espacio de presentación
 */
function estimateBlockHeight(block: Block): number {
  switch (block.type) {
    case 'text': {
      const len = (block.content || '').length;
      return Math.max(48, Math.ceil(len / 75) * 32);
    }
    case 'math':
      return 110;
    case 'callout': {
      const content = block.content || '';
      const hasMath = /\$\$|\\\[|\\begin\{(equation|align|gather)\}/.test(content);
      const textLen = content.length;
      const lines = Math.ceil(textLen / 65) + (hasMath ? 3 : 1);
      return Math.max(120, lines * 28 + 48);
    }
    case 'list': {
      const itemsCount = block.items?.length || (block.content ? block.content.split('\n').length : 3);
      return Math.max(80, itemsCount * 42 + 25);
    }
    case 'diagram':
    case 'image':
      return 320;
    case 'code': {
      const lines = (block.content || '').split('\n').length;
      return Math.max(130, Math.min(450, lines * 26 + 65));
    }
    case 'table':
      return 220;
    default:
      return 80;
  }
}

/**
 * Pagina de forma natural los bloques de un frame si exceden la altura segura de la diapositiva (~480px)
 * para garantizar que el 100% del contenido sea visible sin cortes ni desbordes.
 */
function paginateBlocks(blocks: Block[]): Block[][] {
  if (blocks.length <= 1) return [blocks];

  const MAX_SLIDE_HEIGHT = 480;
  const totalHeight = blocks.reduce((sum, b) => sum + estimateBlockHeight(b), 0);

  // Si todo el contenido cabe cómodamente en una sola página:
  if (totalHeight <= MAX_SLIDE_HEIGHT) {
    return [blocks];
  }

  // Si supera la altura visible, repartir en páginas secuenciales
  const pages: Block[][] = [];
  let currentPage: Block[] = [];
  let currentHeight = 0;

  for (const block of blocks) {
    const h = estimateBlockHeight(block);

    if (currentPage.length > 0 && currentHeight + h > MAX_SLIDE_HEIGHT) {
      pages.push(currentPage);
      currentPage = [block];
      currentHeight = h;
    } else {
      currentPage.push(block);
      currentHeight += h;
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages.length > 0 ? pages : [blocks];
}

export function SlideDeck({
  lesson,
  subject,
  institution,
  current,
  onFrameChange,
  onClose,
  fullscreen,
  onToggleFullscreen,
}: SlideDeckProps) {
  const [indexOpen, setIndexOpen] = useState(false);
  const preloaded = useRef(new Set<string>());

  const frame: Frame | undefined = lesson.frames[current];
  const visibleBlocks = useMemo(() => filterVisibleBlocks(frame?.blocks), [frame]);
  const pages = useMemo(() => paginateBlocks(visibleBlocks), [visibleBlocks]);
  const [subPageIndex, setSubPageIndex] = useState(0);

  // Reiniciar la sub-página al cambiar de diapositiva
  useEffect(() => {
    setSubPageIndex(0);
  }, [current]);

  const totalPages = pages.length;
  const safeSubPageIndex = Math.min(subPageIndex, Math.max(0, totalPages - 1));
  const currentBlocks = pages[safeSubPageIndex] || visibleBlocks;
  const isMultiPage = totalPages > 1;

  // Precargar imágenes de diapositivas adyacentes
  useEffect(() => {
    function walk(blocks: Block[]) {
      for (const b of blocks) {
        if (b.asset && !preloaded.current.has(b.asset)) {
          preloaded.current.add(b.asset);
          const img = new Image();
          img.src = b.asset;
        }
        if (b.children) walk(b.children);
        for (const item of b.items ?? []) walk(item);
      }
    }
    for (const idx of [current, current + 1, current - 1]) {
      const target = lesson.frames[idx];
      if (target) walk(target.blocks);
    }
  }, [current, lesson.frames]);

  const nextSlide = useCallback(() => {
    if (safeSubPageIndex < totalPages - 1) {
      setSubPageIndex((p) => p + 1);
    } else if (current < lesson.frames.length - 1) {
      onFrameChange(current + 1);
      setSubPageIndex(0);
    }
  }, [safeSubPageIndex, totalPages, current, lesson.frames.length, onFrameChange]);

  const previousSlide = useCallback(() => {
    if (safeSubPageIndex > 0) {
      setSubPageIndex((p) => p - 1);
    } else if (current > 0) {
      onFrameChange(current - 1);
      setSubPageIndex(0);
    }
  }, [safeSubPageIndex, current, onFrameChange]);

  // Manejo de atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"],.cm-editor'
        )
      ) {
        return;
      }

      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        nextSlide();
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        previousSlide();
      } else if (e.key === 'Home') {
        e.preventDefault();
        onFrameChange(0);
        setSubPageIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onFrameChange(lesson.frames.length - 1);
        setSubPageIndex(0);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleFullscreen();
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIndexOpen((open) => !open);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (indexOpen) {
          setIndexOpen(false);
        } else if (fullscreen) {
          onToggleFullscreen();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextSlide, previousSlide, onFrameChange, lesson.frames.length, onToggleFullscreen, fullscreen, onClose, indexOpen]);

  const isReflection = frame && /reflexi|pensamiento|cita|frase|inspiraci/i.test(frame.title);

  return (
    <div className={`slide-deck-container ${fullscreen ? 'is-fullscreen' : ''}`}>
      {/* Barra superior de presentación */}
      <header className="presentation-toolbar">
        <div>
          <BrandSignature />
          <span>{subject.name}</span>
        </div>
        <div className="presentation-actions-right">
          <Button
            variant="ghost"
            onClick={() => setIndexOpen((open) => !open)}
            aria-label="Índice de diapositivas"
            title="Índice interactivo de la clase (I)"
            className="presentation-index-toggle"
          >
            <List size={17} />
            <span>Índice</span>
          </Button>
          <ThemeControls />
          <Button
            variant="ghost"
            size="icon"
            aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Salir de pantalla completa (F / Esc)' : 'Pantalla completa (F)'}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </Button>
          <Button
            className="exit-presentation"
            variant="ghost"
            aria-label="Volver a lectura"
            onClick={onClose}
            title="Volver al documento (Esc)"
          >
            <X size={17} />
            <span>Volver a lectura</span>
          </Button>
        </div>
      </header>

      {/* Escenario de presentación a pantalla completa (100% de la pantalla) */}
      <main className="presentation-stage">
        <article
          className={`presentation-slide ${isReflection ? 'is-reflection-slide' : ''}`}
          key={`${frame?.id}-${safeSubPageIndex}`}
        >
          {/* Cabecera del slide */}
          <header className="slide-heading">
            <div>
              <span>{frame?.section}</span>
              <h2>
                <InlineText text={frame?.title || ''} />
                {isMultiPage && (
                  <span
                    style={{
                      marginLeft: '12px',
                      fontSize: '0.65em',
                      opacity: 0.8,
                      fontWeight: 500,
                      verticalAlign: 'middle',
                    }}
                  >
                    (Parte {safeSubPageIndex + 1}/{totalPages})
                  </span>
                )}
              </h2>
            </div>
            {institutionLogo(institution) && (
              <img src={institutionLogo(institution)!} alt={institution.shortName} />
            )}
          </header>

          {/* Contenido del slide: flujo continuo unificado */}
          <div className="slide-content">
            <div className="slide-single-flow">
              {currentBlocks.map((b, i) => (
                <div className="slide-unit" key={i}>
                  <ContentBlock block={b} />
                </div>
              ))}
            </div>
          </div>

          {/* Pie del slide */}
          <footer className="slide-footer">
            <span>
              {institution.shortName} · {lesson.title}
            </span>
            <div className="slide-footer-right">
              {fullscreen && (
                <button
                  type="button"
                  className="presentation-fullscreen-exit"
                  onClick={onToggleFullscreen}
                  aria-label="Salir de pantalla completa"
                  title="Salir de pantalla completa (Esc)"
                >
                  <Minimize size={13} />
                  <span>Salir de pantalla completa</span>
                </button>
              )}
              <span>
                {current + 1} / {lesson.frames.length}
                {isMultiPage && ` · (${safeSubPageIndex + 1}/${totalPages})`}
              </span>
            </div>
          </footer>
        </article>
      </main>

      {/* Barra de controles inferiores de navegación */}
      <footer className="presentation-controls">
        <div className="slide-shortcuts">
          ← → Navegar <span>·</span> I Índice <span>·</span> F Pantalla completa <span>·</span> Esc Volver
        </div>
        <div className="presentation-nav-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIndexOpen((open) => !open)}
            aria-label="Abrir índice de diapositivas"
            className="presentation-btn-index"
          >
            <List size={16} />
            <span>Índice</span>
          </Button>
          <Button
            variant="ghost"
            disabled={current === 0 && safeSubPageIndex === 0}
            onClick={previousSlide}
            aria-label="Diapositiva anterior"
          >
            <ChevronLeft size={18} />
            Anterior
          </Button>
          <label className="slide-select-label">
            Diapositiva
            <select
              aria-label="Ir a diapositiva"
              value={current}
              onChange={(e) => {
                onFrameChange(Number(e.target.value));
                setSubPageIndex(0);
              }}
            >
              {lesson.frames.map((f, i) => (
                <option key={f.id} value={i}>
                  {i + 1} · {f.title.replace(/\$([^\$]+)\$/g, '$1')}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ghost"
            disabled={current === lesson.frames.length - 1 && safeSubPageIndex === totalPages - 1}
            onClick={nextSlide}
            aria-label="Diapositiva siguiente"
          >
            Siguiente
            <ChevronRight size={18} />
          </Button>
        </div>
      </footer>

      {/* Barra de progreso visual inferior */}
      <div className="presentation-progress">
        <i
          style={{
            width: `${((current + (safeSubPageIndex + 1) / totalPages) / lesson.frames.length) * 100}%`,
          }}
        />
      </div>

      {/* Cajón / Modal de índice interactivo de diapositivas */}
      {indexOpen && (
        <div
          className="presentation-index-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIndexOpen(false);
          }}
        >
          <aside className="presentation-index-drawer">
            <header className="presentation-index-header">
              <div>
                <span>ÍNDICE DE DIAPOSITIVAS</span>
                <h3>{lesson.title}</h3>
                <small>{lesson.frames.length} diapositivas en total</small>
              </div>
              <button
                type="button"
                className="presentation-index-close"
                onClick={() => setIndexOpen(false)}
                title="Cerrar índice (Esc / I)"
                aria-label="Cerrar índice"
              >
                <X size={18} />
              </button>
            </header>

            <div className="presentation-index-scroll">
              <div className="presentation-index-grid">
                {lesson.frames.map((f, i) => {
                  const isCurrent = i === current;
                  const hasCode = f.blocks.some((b) => b.type === 'code');
                  const hasDiagram = f.blocks.some((b) => b.type === 'diagram' || b.type === 'image');
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={`presentation-index-card ${isCurrent ? 'is-current' : ''}`}
                      onClick={() => {
                        onFrameChange(i);
                        setSubPageIndex(0);
                        setIndexOpen(false);
                      }}
                    >
                      <div className="index-card-header">
                        <span className="index-card-num">{i + 1}</span>
                        <div className="index-card-badges">
                          {hasDiagram && <span className="index-badge diagram">SVG</span>}
                          {hasCode && <span className="index-badge code">Python</span>}
                        </div>
                      </div>
                      <span className="index-card-section">{f.section}</span>
                      <strong className="index-card-title">
                        {f.title.replace(/\$([^\$]+)\$/g, '$1')}
                      </strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <footer className="presentation-index-footer">
              <span>Navega haciendo clic en cualquier diapositiva o presiona <kbd>I</kbd> / <kbd>Esc</kbd> para cerrar.</span>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}
