'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  X,
  List,
  BookOpen,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandSignature } from '@/features/theme/brand-signature';
import { ThemeControls } from '@/features/theme/theme-toggle';
import type { Block, Institution, Lesson, Subject } from '@/features/catalog/model/types';
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
  toolsEnabled?: boolean;
  onToggleTools?: () => void;
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

export function SlideDeck({
  lesson,
  subject,
  institution,
  current,
  onFrameChange,
  onClose,
  fullscreen,
  onToggleFullscreen,
  toolsEnabled = true,
  onToggleTools,
}: SlideDeckProps) {
  const [indexOpen, setIndexOpen] = useState(false);
  const [activeSlide, setActiveSlide] = useState(current);
  const stageRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const preloaded = useRef(new Set<string>());

  // Desplazamiento suave y sin cortes hacia cualquier tema de la clase
  const scrollToSlide = useCallback(
    (index: number, smooth: boolean = true) => {
      const safeIndex = Math.max(0, Math.min(index, lesson.frames.length - 1));
      const el = document.getElementById(`presentation-frame-${safeIndex}`);
      if (el) {
        isProgrammaticScroll.current = true;
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        setActiveSlide(safeIndex);
        onFrameChange(safeIndex);

        if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
        scrollTimeout.current = setTimeout(() => {
          isProgrammaticScroll.current = false;
        }, 700);
      }
    },
    [lesson.frames.length, onFrameChange]
  );

  // Posicionar en la diapositiva inicial al montar
  useEffect(() => {
    scrollToSlide(current, false);
  }, []);

  // Detectar la diapositiva visible durante el scroll continuo manual
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) return;

        let mostVisible: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!mostVisible || entry.intersectionRatio > mostVisible.intersectionRatio) {
              mostVisible = entry;
            }
          }
        }

        if (mostVisible) {
          const idx = Number(mostVisible.target.getAttribute('data-frame-index'));
          if (!Number.isNaN(idx) && idx !== activeSlide) {
            setActiveSlide(idx);
            onFrameChange(idx);
          }
        }
      },
      {
        root: stage,
        threshold: [0.2, 0.5, 0.8],
      }
    );

    const frames = stage.querySelectorAll('.presentation-reading-frame');
    frames.forEach((frame) => observer.observe(frame));

    return () => {
      observer.disconnect();
    };
  }, [activeSlide, onFrameChange, lesson.frames.length]);

  // Precargar imágenes de la lección
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
    for (const f of lesson.frames) {
      walk(f.blocks);
    }
  }, [lesson.frames]);

  const nextSlide = useCallback(() => {
    if (activeSlide < lesson.frames.length - 1) {
      scrollToSlide(activeSlide + 1);
    }
  }, [activeSlide, lesson.frames.length, scrollToSlide]);

  const previousSlide = useCallback(() => {
    if (activeSlide > 0) {
      scrollToSlide(activeSlide - 1);
    }
  }, [activeSlide, scrollToSlide]);

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"],.cm-editor'
        ) ||
        document.querySelector('.image-lightbox-dialog')
      ) {
        return;
      }

      if (['ArrowRight', 'PageDown', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault();
        nextSlide();
      } else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        previousSlide();
      } else if (e.key === 'Home') {
        e.preventDefault();
        scrollToSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        scrollToSlide(lesson.frames.length - 1);
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
  }, [
    nextSlide,
    previousSlide,
    scrollToSlide,
    lesson.frames.length,
    onToggleFullscreen,
    fullscreen,
    onClose,
    indexOpen,
  ]);

  return (
    <div className={`slide-deck-container ${fullscreen ? 'is-fullscreen' : ''}`}>
      {/* Barra superior de presentación */}
      <header className="presentation-toolbar">
        <div>
          <BrandSignature />
          <span>{subject.name}</span>
        </div>
        <div className="presentation-actions-right">
          {onToggleTools && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleTools}
              className={`presentation-tools-toggle ${toolsEnabled ? 'is-active' : ''}`}
              title={toolsEnabled ? 'Desactivar herramientas en esta clase' : 'Activar herramientas en esta clase'}
            >
              <Wrench size={16} style={{ color: toolsEnabled ? '#10b981' : '#94a3b8' }} />
              <span>Herramientas: {toolsEnabled ? 'ON' : 'OFF'}</span>
            </Button>
          )}
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

      {/* Escenario de presentación: Lectura continua a pantalla completa */}
      <main className="presentation-stage" ref={stageRef}>
        <div className="presentation-reading-document">
          {/* Tarjeta heroica de portada/encabezado de la presentación */}
          <header className="presentation-document-header">
            {institutionLogo(institution) && (
              <div className="presentation-header-logo-badge">
                <img src={institutionLogo(institution)!} alt={institution.name} />
              </div>
            )}
            <div className="presentation-header-info">
              <div className="presentation-header-eyebrow">
                <span className="institution-tag-name">{institution.name}</span>
                <span className="eyebrow-sep">/</span>
                <span className="subject-tag-name">{subject.name}</span>
              </div>
              <h1 className="presentation-header-title">{lesson.title}</h1>
              <div className="presentation-header-badges">
                <span className="meta-badge">
                  <BookOpen size={13} /> {lesson.frames.length} temas de clase
                </span>
                <span className="meta-badge">
                  <Sparkles size={13} /> Modo Presentación Continua
                </span>
              </div>
            </div>
          </header>

          {/* Temas desplegados como tarjetas escénicas continuas */}
          {lesson.frames.map((frame, index) => {
            const visibleBlocks = filterVisibleBlocks(frame.blocks);
            const isReflection = /reflexi|pensamiento|cita|frase|inspiraci/i.test(frame.title);

            return (
              <article
                id={`presentation-frame-${index}`}
                data-frame-index={index}
                key={frame.id || index}
                className={`presentation-reading-frame ${
                  isReflection ? 'is-reflection-frame' : ''
                }`}
              >
                {/* Cabecera limpia del tema */}
                <header className="presentation-frame-header">
                  <div className="presentation-frame-meta">
                    <span className="presentation-frame-section">{frame.section}</span>
                    <span className="presentation-frame-badge">
                      Tema {index + 1} de {lesson.frames.length}
                    </span>
                  </div>
                  <h2 className="presentation-frame-title">
                    <InlineText text={frame.title || ''} />
                  </h2>
                </header>

                {/* Contenido completo del tema */}
                <div className="presentation-frame-content">
                  {visibleBlocks.map((b, bIdx) => (
                    <ContentBlock key={bIdx} block={b} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {/* Barra de controles inferiores de navegación */}
      <footer className="presentation-controls">
        <div className="slide-shortcuts">
          ← → / Espacio Navegar <span>·</span> I Índice <span>·</span> F Pantalla completa{' '}
          <span>·</span> Esc Volver
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
            disabled={activeSlide === 0}
            onClick={previousSlide}
            aria-label="Tema anterior"
          >
            <ChevronLeft size={18} />
            Anterior
          </Button>
          <label className="slide-select-label">
            Diapositiva
            <select
              aria-label="Ir a diapositiva"
              value={activeSlide}
              onChange={(e) => {
                scrollToSlide(Number(e.target.value));
              }}
            >
              {lesson.frames.map((f, i) => (
                <option key={f.id || i} value={i}>
                  {i + 1} · {f.title.replace(/\$([^\$]+)\$/g, '$1')}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ghost"
            disabled={activeSlide === lesson.frames.length - 1}
            onClick={nextSlide}
            aria-label="Tema siguiente"
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
            width: `${((activeSlide + 1) / lesson.frames.length) * 100}%`,
          }}
        />
      </div>

      {/* Cajón lateral interactivo de índice */}
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
                <span>ÍNDICE DE CONTENIDOS</span>
                <h3>{lesson.title}</h3>
                <small>{lesson.frames.length} temas en total</small>
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
                  const isCurrent = i === activeSlide;
                  const hasCode = f.blocks.some((b) => b.type === 'code');
                  const hasDiagram = f.blocks.some(
                    (b) => b.type === 'diagram' || b.type === 'image'
                  );
                  return (
                    <button
                      key={f.id || i}
                      type="button"
                      className={`presentation-index-card ${isCurrent ? 'is-current' : ''}`}
                      onClick={() => {
                        scrollToSlide(i);
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
              <span>
                Haz clic en cualquier tema o presiona <kbd>I</kbd> / <kbd>Esc</kbd> para cerrar.
              </span>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}
