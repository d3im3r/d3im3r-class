'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Institution, Lesson, Subject } from '@/features/catalog/model/types';
import { SlideDeck } from './slide-deck';
import { ReadingDocument } from './reading-document';

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
  const [presenting, setPresenting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Abrir y cerrar el modal nativo de presentación
  useEffect(() => {
    const el = dialogRef.current;
    if (presenting && !el?.open) {
      try {
        el?.showModal();
      } catch {}
    }
    if (!presenting && el?.open) {
      el.close();
    }
  }, [presenting]);

  // Escuchar cambios de pantalla completa del navegador
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // Bloquear scroll del body al presentar
  useEffect(() => {
    if (!presenting) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [presenting]);

  const startPresentation = useCallback(() => {
    setFullscreen(false);
    setPresenting(true);
  }, []);

  const closePresentation = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setPresenting(false);
    requestAnimationFrame(() => {
      document
        .getElementById(`reading-${lesson.frames[frameIndex]?.id}`)
        ?.scrollIntoView({ block: 'start' });
    });
  }, [frameIndex, lesson.frames]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
    } else {
      setFullscreen(true);
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  }, [fullscreen]);

  return (
    <>
      {/* Vista de lectura continua */}
      <ReadingDocument
        lesson={lesson}
        subject={subject}
        institution={institution}
        completed={completed}
        onToggle={onToggle}
        onBack={onBack}
        onStartPresentation={startPresentation}
        onFrameChange={onFrameChange}
        frameIndex={frameIndex}
      />

      {/* Diálogo modal de modo presentación */}
      <dialog
        ref={dialogRef}
        className={`presentation-dialog ${fullscreen ? 'is-fullscreen' : ''}`}
        onCancel={(e) => {
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else if (fullscreen) {
            setFullscreen(false);
          } else {
            closePresentation();
          }
        }}
        onClose={() => {
          setFullscreen(false);
          setPresenting(false);
        }}
        aria-label={`Presentación: ${lesson.title}`}
      >
        {presenting && (
          <SlideDeck
            lesson={lesson}
            subject={subject}
            institution={institution}
            current={Math.min(frameIndex, lesson.frames.length - 1)}
            onFrameChange={onFrameChange}
            onClose={closePresentation}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        )}
      </dialog>
    </>
  );
}
