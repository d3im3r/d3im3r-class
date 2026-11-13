'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
  useContext,
} from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize,
  Minimize,
  MonitorPlay,
  ListTree,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandSignature } from '@/features/theme/brand-signature';
import { ThemeControls } from '@/features/theme/theme-toggle';
import type { Block, Frame, Institution, Lesson, Subject } from '@/features/catalog/model/types';
import { ResourceToolsContext } from '@/features/tools/components/resource-tools-context';
import { ContentBlock } from './content-block';
import { InlineText } from './rich-text';
import { institutionLogo } from '@/features/catalog/model/institution-logo';
export function LessonReader({
  lesson,
  subject,
  institution,
  frameIndex,
  onFrameChange,
  completed,
  onToggle,
  onBack,
}: {
  lesson: Lesson;
  subject: Subject;
  institution: Institution;
  frameIndex: number;
  onFrameChange: (index: number) => void;
  completed: string[];
  onToggle: (id: string) => void;
  onBack: () => void;
}) {
  const canInspect = useContext(ResourceToolsContext);
  const [indexOpen, setIndexOpen] = useState(false);
  const indexDialog = useRef<HTMLDialogElement>(null),
    indexToggle = useRef<HTMLButtonElement>(null);
  const [presenting, setPresenting] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const preloaded = useRef(new Set<string>());
  const slideContent = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLButtonElement>(null),
    initial = useRef(frameIndex);
  const current = Math.min(frameIndex, lesson.frames.length - 1),
    frame = lesson.frames[current];
  const sections = lesson.frames.reduce<
    { name: string; frames: { frame: Frame; index: number }[] }[]
  >((groups, f, index) => {
    if (groups.at(-1)?.name !== f.section) groups.push({ name: f.section, frames: [] });
    groups.at(-1)!.frames.push({ frame: f, index });
    return groups;
  }, []);
  const change = useCallback(
    (index: number) => onFrameChange(Math.max(0, Math.min(index, lesson.frames.length - 1))),
    [onFrameChange, lesson.frames.length]
  );
  useEffect(() => {
    const index = initial.current;
    requestAnimationFrame(() => {
      if (index > 0)
        document
          .getElementById(`reading-${lesson.frames[index]?.id}`)
          ?.scrollIntoView({ block: 'start' });
      else window.scrollTo({ top: 0 });
    });
  }, [lesson]);
  useEffect(() => {
    if (presenting) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) onFrameChange(Number((visible[0].target as HTMLElement).dataset.index));
      },
      { rootMargin: '-10% 0px -65% 0px', threshold: 0 }
    );
    document.querySelectorAll('[data-reading-frame]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [presenting, lesson, onFrameChange]);
  useEffect(() => {
    const el = dialog.current;
    if (presenting && !el?.open) el?.showModal();
    if (!presenting && el?.open) el.close();
  }, [presenting]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (!presenting) return;
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
  }, [presenting, current, lesson.frames]);
  const close = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setPresenting(false);
    requestAnimationFrame(() => {
      document
        .getElementById(`reading-${lesson.frames[current]?.id}`)
        ?.scrollIntoView({ block: 'start' });
      returnFocus.current?.focus({ preventScroll: true });
    });
  }, [current, lesson]);
  const startPresentation = useCallback(() => {
    setFullscreen(false);
    setPresenting(true);
    const el = dialog.current;
    if (el && !el.open) {
      try {
        el.showModal();
      } catch {}
    }
  }, []);
  const nextSlide = useCallback(() => {
    if (current < lesson.frames.length - 1) change(current + 1);
  }, [current, lesson.frames.length, change]);
  const previousSlide = useCallback(() => {
    if (current > 0) change(current - 1);
  }, [current, change]);
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"],.cm-editor'
        )
      )
        return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        nextSlide();
      }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        previousSlide();
      }
      if (e.key === 'Home') {
        e.preventDefault();
        change(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        change(lesson.frames.length - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, nextSlide, previousSlide, change, lesson.frames.length]);
  useLayoutEffect(() => {
    if (!presenting) return;
    const container = slideContent.current,
      inner = container?.firstElementChild as HTMLElement | null;
    if (!container || !inner) return;
    let scheduled = 0,
      active = true;
    const measure = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => {
        if (!active) return;
        const padding = getComputedStyle(container);
        const space =
          container.clientHeight -
          parseFloat(padding.paddingTop || '0') -
          parseFloat(padding.paddingBottom || '0');
        const width =
          container.clientWidth -
          parseFloat(padding.paddingLeft || '0') -
          parseFloat(padding.paddingRight || '0');
        if (space <= 0 || width <= 0) return;

        container.style.setProperty('--slide-space', `${space}px`);

        // Restablecer dimensiones naturales para medir la altura total de todos los bloques
        inner.style.transform = 'none';
        inner.style.width = '100%';
        inner.style.maxWidth = '100%';

        const naturalHeight = inner.scrollHeight;
        const naturalWidth = inner.scrollWidth;

        // Auto-escala proporcional si los elementos superan el alto o ancho de la diapositiva
        const scaleY = (space - 8) / Math.max(1, naturalHeight);
        const scaleX = width / Math.max(1, naturalWidth);
        const rawScale = Math.min(scaleY, scaleX);

        if (rawScale < 0.99) {
          // Escala suavizada con límite inferior legible para garantizar que todos los elementos se vean juntos
          const scale = Math.max(0.58, rawScale * 0.98);
          inner.style.transform = `scale(${scale})`;
          inner.style.transformOrigin = 'top center';
          inner.style.width = `${100 / scale}%`;
          inner.style.maxWidth = `${100 / scale}%`;
        } else {
          inner.style.transform = 'none';
          inner.style.transformOrigin = 'top center';
          inner.style.width = '100%';
          inner.style.maxWidth = '100%';
        }
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(inner);
    container.addEventListener('load', measure, true);
    document.addEventListener('fullscreenchange', measure);
    measure();
    document.fonts?.ready?.then(measure);
    return () => {
      active = false;
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      container.removeEventListener('load', measure, true);
      document.removeEventListener('fullscreenchange', measure);
    };
  }, [presenting, current, frame]);
  useEffect(() => {
    if (!presenting) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [presenting]);
  function closeIndex() {
    indexDialog.current?.close();
    setIndexOpen(false);
    indexToggle.current?.focus({ preventScroll: true });
  }
  function jump(index: number) {
    closeIndex();
    onFrameChange(index);
    requestAnimationFrame(() =>
      document
        .getElementById(`reading-${lesson.frames[index].id}`)
        ?.scrollIntoView({ behavior: 'auto', block: 'start' })
    );
  }
  useEffect(() => {
    const element = indexDialog.current;
    if (indexOpen && !element?.open) element?.showModal();
    if (!indexOpen && element?.open) element.close();
    if (!indexOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [indexOpen]);
  async function toggleFullscreen() {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    } else {
      setFullscreen(true);
      if (!document.fullscreenElement && document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen().catch(() => {});
    }
  }
  return (
    <main
      className={`reader-page continuous-reader no-print-student ${canInspect ? 'teacher-active' : ''}`}
    >
      <button className="back-link" onClick={onBack}>
        <ChevronLeft size={15} />
        Volver a la asignatura
      </button>
      <div className="reader-heading">
        <div>
          <div className="eyebrow">
            {institution.shortName} / {subject.name}
          </div>
          <h1>{lesson.title}</h1>
          <p>{lesson.subtitle}</p>
        </div>
        <div className="reader-actions">
          {canInspect && lesson.pdf && (
            <Button variant="outline" asChild>
              <a href={lesson.pdf} target="_blank" rel="noreferrer">
                <FileText size={16} />
                PDF original
                <ArrowUpRight size={14} />
              </a>
            </Button>
          )}
          <Button ref={returnFocus} onClick={startPresentation}>
            <MonitorPlay size={16} />
            Presentar clase
          </Button>
        </div>
      </div>
      <div className="reading-mode-bar">
        <span>
          <BookOpen size={16} />
          Lectura continua
        </span>
        <span>
          {completed.length} de {lesson.frames.length} bloques leídos
        </span>
      </div>
      <div className="reader-layout">
        <div className="lesson-main">
          <div className="reading-document">
            <header className="document-cover">
              {institutionLogo(institution) && (
                <img src={institutionLogo(institution)!} alt={institution.name} />
              )}
              <div>
                <span>{institution.name}</span>
                <strong>{subject.name}</strong>
                <p>Material de clase</p>
              </div>
            </header>
            {sections.map((section, i) => (
              <section key={i} className="reading-section" aria-labelledby={`section-${i}`}>
                <header className="reading-section-heading">
                  <span>SECCIÓN {String(i + 1).padStart(2, '0')}</span>
                  <h2 id={`section-${i}`}>{section.name}</h2>
                </header>
                {section.frames.map(({ frame: f, index }) => (
                  <article
                    key={f.id}
                    id={`reading-${f.id}`}
                    data-reading-frame
                    data-index={index}
                    className={`reading-frame ${
                      /reflexi|pensamiento|cita|frase|inspiraci/i.test(f.title)
                        ? 'is-reflection-frame'
                        : ''
                    }`}
                  >
                    <div className="reading-frame-title">
                      <h3>
                        <InlineText text={f.title} />
                      </h3>
                      <button
                        className={`read-marker ${completed.includes(f.id) ? 'is-read' : ''}`}
                        aria-label={`${completed.includes(f.id) ? 'Desmarcar' : 'Marcar como leído'}: ${f.title}`}
                        aria-pressed={completed.includes(f.id)}
                        onClick={() => onToggle(f.id)}
                      >
                        {completed.includes(f.id) ? (
                          <CheckCircle2 size={17} />
                        ) : (
                          <Check size={17} />
                        )}
                        <span>{completed.includes(f.id) ? 'Leído' : 'Marcar leído'}</span>
                      </button>
                    </div>
                    <div className="frame-content">
                      {f.blocks.map((b, j) => (
                        <ContentBlock key={j} block={b} />
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            ))}
            <div className="document-end">
              <CheckCircle2 size={24} />
              <h3>Has llegado al final de la clase</h3>
              <p>Puedes volver al índice o repasar el contenido en modo presentación.</p>
              <Button variant="outline" onClick={() => jump(0)}>
                Volver al inicio
              </Button>
            </div>
          </div>
          {canInspect && (
            <details className="import-details">
              <summary>Recursos de la clase</summary>
              <a href={lesson.source} download>
                <Download size={14} />
                Descargar fuente .tex
              </a>
              {lesson.diagnostics.length > 0 &&
                lesson.diagnostics.map((d, i) => <p key={i}>{d}</p>)}
            </details>
          )}
        </div>
      </div>
      <div className="reader-floating-actions reading-tools">
        <span>
          {current + 1} / {lesson.frames.length}
        </span>
        <Button
          ref={indexToggle}
          variant="outline"
          onClick={() => setIndexOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={indexOpen}
          aria-controls="reading-index-title"
        >
          <ListTree size={16} />
          <span>En esta clase</span>
        </Button>
        {current > 0 && (
          <Button onClick={startPresentation} aria-label="Presentar desde aquí">
            <MonitorPlay size={15} />
            <span>Presentar desde aquí</span>
          </Button>
        )}
      </div>
      <dialog
        ref={indexDialog}
        className="reading-index-dialog"
        aria-labelledby="reading-index-title"
        onCancel={(event) => {
          event.preventDefault();
          closeIndex();
        }}
        onClose={() => setIndexOpen(false)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.target === event.currentTarget &&
            (event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom)
          )
            closeIndex();
        }}
      >
        <aside className="reading-index-aside">
          <header>
            <div>
              <h2 id="reading-index-title">En esta clase</h2>
              <p>
                {sections.length} secciones · {lesson.frames.length} bloques
              </p>
            </div>
            <button type="button" onClick={closeIndex} aria-label="Cerrar índice">
              <X size={18} />
            </button>
          </header>
          <nav className="outline-scroll" aria-label="Índice de la clase">
            {sections.map((section, i) => (
              <div key={i}>
                <button
                  className={`section-jump ${section.frames.some((f) => f.index === current) ? 'current' : ''}`}
                  onClick={() => jump(section.frames[0].index)}
                >
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {section.name}
                </button>
              </div>
            ))}
          </nav>
          <div className="outline-progress">
            <div className="progress-track">
              <i style={{ width: `${(completed.length / lesson.frames.length) * 100}%` }} />
            </div>
            <p>Tu progreso se guarda en tu cuenta.</p>
          </div>
        </aside>
      </dialog>
      <dialog
        ref={dialog}
        className={`presentation-dialog ${fullscreen ? 'is-fullscreen' : ''}`}
        onCancel={(e) => {
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else if (fullscreen) setFullscreen(false);
          else close();
        }}
        onClose={() => {
          setFullscreen(false);
          setPresenting(false);
        }}
        aria-label={`Presentación: ${lesson.title}`}
      >
        <header className="presentation-toolbar">
          <div>
            <BrandSignature />
            <span>{subject.name}</span>
          </div>
          <div>
            <ThemeControls />
            <Button
              variant="ghost"
              size="icon"
              aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </Button>
            <Button
              className="exit-presentation"
              variant="ghost"
              aria-label="Volver a lectura"
              onClick={close}
            >
              <X size={17} />
              <span>Volver a lectura</span>
            </Button>
          </div>
        </header>
        {presenting && (
          <>
            <div className="presentation-stage">
              <article
                className={`presentation-slide ${
                  /reflexi|pensamiento|cita|frase|inspiraci/i.test(frame.title)
                    ? 'is-reflection-slide'
                    : ''
                }`}
                key={frame.id}
              >
                <header className="slide-heading">
                  <div>
                    <span>{frame.section}</span>
                    <h2>
                      <InlineText text={frame.title} />
                    </h2>
                  </div>
                  {institutionLogo(institution) && (
                    <img src={institutionLogo(institution)!} alt={institution.shortName} />
                  )}
                </header>
                <div
                  className="slide-content"
                  ref={slideContent}
                  data-has-multiple={frame.blocks.length > 1}
                >
                  <div className="slide-content-inner">
                    {frame.blocks.map((b, i) => (
                      <div className="slide-unit" key={i}>
                        <ContentBlock block={b} />
                      </div>
                    ))}
                  </div>
                </div>
                <footer className="slide-footer">
                  <span>
                    {institution.shortName} · {lesson.title}
                  </span>
                  <span>
                    {current + 1} / {lesson.frames.length}
                  </span>
                </footer>
              </article>
            </div>
            {fullscreen && (
              <button
                type="button"
                className="presentation-fullscreen-exit"
                onClick={toggleFullscreen}
                aria-label="Salir de pantalla completa"
                title="Salir de pantalla completa (Esc)"
              >
                <Minimize size={15} />
                <span>Salir de pantalla completa</span>
              </button>
            )}
            <footer className="presentation-controls">
              <div className="slide-shortcuts">
                ← → Navegar <span>·</span> Esc Volver a lectura
              </div>
              <div>
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
                    onChange={(e) => change(Number(e.target.value))}
                  >
                    {lesson.frames.map((f, i) => (
                      <option key={f.id} value={i}>
                        {i + 1} · {f.title}
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
            <div className="presentation-progress">
              <i
                style={{
                  width: `${((current + 1) / lesson.frames.length) * 100}%`,
                }}
              />
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
