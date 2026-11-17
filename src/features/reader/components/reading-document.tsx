'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useContext,
} from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  MonitorPlay,
  ListTree,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Frame, Institution, Lesson, Subject } from '@/features/catalog/model/types';
import { ResourceToolsContext } from '@/features/tools/components/resource-tools-context';
import { ContentBlock } from './content-block';
import { InlineText } from './rich-text';
import { institutionLogo } from '@/features/catalog/model/institution-logo';

export interface ReadingDocumentProps {
  lesson: Lesson;
  subject: Subject;
  institution: Institution;
  completed: string[];
  onToggle: (id: string) => void;
  onBack: () => void;
  onStartPresentation: () => void;
  onFrameChange: (index: number) => void;
  frameIndex: number;
}

export function ReadingDocument({
  lesson,
  subject,
  institution,
  completed,
  onToggle,
  onBack,
  onStartPresentation,
  onFrameChange,
  frameIndex,
}: ReadingDocumentProps) {
  const canInspect = useContext(ResourceToolsContext);
  const [indexOpen, setIndexOpen] = useState(false);
  const indexDialog = useRef<HTMLDialogElement>(null);
  const indexToggle = useRef<HTMLButtonElement>(null);
  const initial = useRef(frameIndex);

  const sections = lesson.frames.reduce<
    { name: string; frames: { frame: Frame; index: number }[] }[]
  >((groups, f, index) => {
    if (groups.at(-1)?.name !== f.section) groups.push({ name: f.section, frames: [] });
    groups.at(-1)!.frames.push({ frame: f, index });
    return groups;
  }, []);

  // Desplazar al frame inicial al cargar el documento
  useEffect(() => {
    const index = initial.current;
    requestAnimationFrame(() => {
      if (index > 0) {
        document
          .getElementById(`reading-${lesson.frames[index]?.id}`)
          ?.scrollIntoView({ block: 'start' });
      } else {
        window.scrollTo({ top: 0 });
      }
    });
  }, [lesson]);

  // Actualizar el frame activo al desplazarse
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) {
          onFrameChange(Number((visible[0].target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: '-10% 0px -65% 0px', threshold: 0 }
    );

    document.querySelectorAll('[data-reading-frame]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [lesson, onFrameChange]);

  const closeIndex = useCallback(() => {
    indexDialog.current?.close();
    setIndexOpen(false);
    indexToggle.current?.focus({ preventScroll: true });
  }, []);

  const jump = useCallback(
    (index: number) => {
      closeIndex();
      onFrameChange(index);
      requestAnimationFrame(() => {
        document
          .getElementById(`reading-${lesson.frames[index]?.id}`)
          ?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    },
    [closeIndex, onFrameChange, lesson.frames]
  );

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
          <Button onClick={onStartPresentation}>
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

            <footer className="document-end">
              <CheckCircle2 size={42} />
              <h3>Fin del material de lectura</h3>
              <p>
                Has revisado todas las secciones de esta clase. Puedes volver a la asignatura o
                repasar la presentación interactiva.
              </p>
              <Button onClick={onBack}>Volver a la asignatura</Button>
            </footer>
          </div>
        </div>

        {/* Barra lateral de índice de lectura */}
        <aside className="lesson-outline">
          <div className="outline-sticky">
            <header>
              <span>ÍNDICE DE LA CLASE</span>
              <strong>{sections.length} secciones</strong>
            </header>
            <nav className="outline-nav">
              {sections.map((section, idx) => (
                <div key={idx} className="outline-section">
                  <span className="outline-section-name">{section.name}</span>
                  <ul>
                    {section.frames.map(({ frame: f, index }) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          className={`outline-item ${frameIndex === index ? 'active' : ''} ${
                            completed.includes(f.id) ? 'completed' : ''
                          }`}
                          onClick={() => jump(index)}
                        >
                          <span className="outline-dot" />
                          <span className="outline-title">
                            {f.title.replace(/\$([^\$]+)\$/g, '$1')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>
      </div>

      {/* Botón flotante para abrir índice en móviles */}
      <div className="reader-floating-actions">
        <Button
          ref={indexToggle}
          variant="outline"
          size="sm"
          onClick={() => setIndexOpen(true)}
          aria-label="Abrir índice de contenidos"
        >
          <ListTree size={16} />
          <span>Índice</span>
        </Button>
        <Button size="sm" onClick={onStartPresentation}>
          <MonitorPlay size={16} />
          <span>Presentar</span>
        </Button>
      </div>

      {/* Diálogo modal de índice para pantallas pequeñas */}
      <dialog
        ref={indexDialog}
        className="reading-index-dialog"
        onClose={() => setIndexOpen(false)}
        aria-label="Índice de contenidos de la clase"
      >
        <div className="reading-index-modal">
          <header className="reading-index-header">
            <div>
              <span>ÍNDICE DE CONTENIDOS</span>
              <h3>{lesson.title}</h3>
            </div>
            <button
              type="button"
              className="index-close-btn"
              onClick={closeIndex}
              aria-label="Cerrar índice"
            >
              <X size={18} />
            </button>
          </header>
          <div className="reading-index-body">
            {sections.map((section, idx) => (
              <div key={idx} className="index-modal-section">
                <h4>{section.name}</h4>
                <ul>
                  {section.frames.map(({ frame: f, index }) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={`index-modal-item ${frameIndex === index ? 'current' : ''}`}
                        onClick={() => jump(index)}
                      >
                        <span>{index + 1}.</span>
                        <span>{f.title.replace(/\$([^\$]+)\$/g, '$1')}</span>
                        {completed.includes(f.id) && <Check size={14} className="text-emerald-500" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </dialog>
    </main>
  );
}
