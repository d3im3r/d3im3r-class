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

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;

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
 * Si la diapositiva tiene medios visuales o alta densidad de bloques,
 * distribuye inteligentemente en 2 columnas para no desbordar verticalmente.
 */
function splitBlocksIntoColumns(blocks: Block[]): {
  left: Block[];
  right: Block[];
  isSplit: boolean;
} {
  if (blocks.length <= 1) {
    return { left: blocks, right: [], isSplit: false };
  }

  // 1. Caso con Medios visuales o interactivos (diagrama, imagen, código)
  const mediaIndices = blocks
    .map((b, i) => (b.type === 'diagram' || b.type === 'image' || b.type === 'code' ? i : -1))
    .filter((i) => i !== -1);

  if (mediaIndices.length > 0 && blocks.length > 1) {
    const mediaSet = new Set(mediaIndices);
    const mediaBlocks = blocks.filter((_, i) => mediaSet.has(i));
    const nonMedia = blocks.filter((_, i) => !mediaSet.has(i));

    // El medio visual (código o diagrama) ocupa la columna derecha completa
    return { left: nonMedia, right: mediaBlocks, isSplit: true };
  }

  // 2. Diapositivas densas sin medios: si tienen callouts o >= 5 bloques
  const callouts = blocks.filter((b) => b.type === 'callout');
  const nonCallouts = blocks.filter((b) => b.type !== 'callout');

  if (blocks.length >= 5) {
    if (callouts.length >= 2) {
      if (nonCallouts.length > 0) {
        return { left: nonCallouts, right: callouts, isSplit: true };
      }
      const mid = Math.ceil(blocks.length / 2);
      return { left: blocks.slice(0, mid), right: blocks.slice(mid), isSplit: true };
    }

    if (callouts.length === 1 && nonCallouts.length >= 4) {
      const mid = Math.ceil(blocks.length / 2);
      return { left: blocks.slice(0, mid), right: blocks.slice(mid), isSplit: true };
    }

    const mid = Math.ceil(blocks.length / 2);
    return { left: blocks.slice(0, mid), right: blocks.slice(mid), isSplit: true };
  }

  return { left: blocks, right: [], isSplit: false };
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
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [indexOpen, setIndexOpen] = useState(false);
  const preloaded = useRef(new Set<string>());

  const frame: Frame | undefined = lesson.frames[current];
  const visibleBlocks = useMemo(() => filterVisibleBlocks(frame?.blocks), [frame]);
  const splitLayout = useMemo(() => splitBlocksIntoColumns(visibleBlocks), [visibleBlocks]);

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

  // Cálculo del factor de escala del Canvas Virtual 16:9
  const updateScale = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { clientWidth, clientHeight } = stage;
    if (clientWidth <= 0 || clientHeight <= 0) return;

    // Margen de seguridad visual de 16px alrededor del canvas
    const availW = Math.max(100, clientWidth - 24);
    const availH = Math.max(100, clientHeight - 24);

    const scaleX = availW / CANVAS_WIDTH;
    const scaleY = availH / CANVAS_HEIGHT;
    const newScale = Math.min(scaleX, scaleY);
    setScale(Math.max(0.2, newScale));
  }, []);

  useEffect(() => {
    updateScale();
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    window.addEventListener('resize', updateScale);

    const timer1 = setTimeout(updateScale, 50);
    const timer2 = setTimeout(updateScale, 200);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [updateScale, fullscreen]);

  const nextSlide = useCallback(() => {
    if (current < lesson.frames.length - 1) onFrameChange(current + 1);
  }, [current, lesson.frames.length, onFrameChange]);

  const previousSlide = useCallback(() => {
    if (current > 0) onFrameChange(current - 1);
  }, [current, onFrameChange]);

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
      } else if (e.key === 'End') {
        e.preventDefault();
        onFrameChange(lesson.frames.length - 1);
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

      {/* Escenario de presentación con Canvas Virtual 16:9 */}
      <div className="presentation-stage" ref={stageRef}>
        <div
          className="slide-canvas-scaler"
          style={{
            width: `${CANVAS_WIDTH}px`,
            height: `${CANVAS_HEIGHT}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <article
            className={`presentation-slide ${isReflection ? 'is-reflection-slide' : ''}`}
            key={frame?.id}
          >
            {/* Cabecera del slide */}
            <header className="slide-heading">
              <div>
                <span>{frame?.section}</span>
                <h2>
                  <InlineText text={frame?.title || ''} />
                </h2>
              </div>
              {institutionLogo(institution) && (
                <img src={institutionLogo(institution)!} alt={institution.shortName} />
              )}
            </header>

            {/* Contenido del slide: 2 columnas inteligentes o 1 columna centrada */}
            <div className="slide-content">
              {splitLayout.isSplit ? (
                <div className="slide-split-grid">
                  <div className="slide-col slide-col-left">
                    {splitLayout.left.map((b, i) => (
                      <div className="slide-unit" key={`l-${i}`}>
                        <ContentBlock block={b} />
                      </div>
                    ))}
                  </div>
                  <div className="slide-col slide-col-right">
                    {splitLayout.right.map((b, i) => (
                      <div className="slide-unit" key={`r-${i}`}>
                        <ContentBlock block={b} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="slide-single-flow">
                  {visibleBlocks.map((b, i) => (
                    <div className="slide-unit" key={i}>
                      <ContentBlock block={b} />
                    </div>
                  ))}
                </div>
              )}
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
                </span>
              </div>
            </footer>
          </article>
        </div>
      </div>

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
            disabled={current === 0}
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
              onChange={(e) => onFrameChange(Number(e.target.value))}
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
            disabled={current === lesson.frames.length - 1}
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
            width: `${((current + 1) / lesson.frames.length) * 100}%`,
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
