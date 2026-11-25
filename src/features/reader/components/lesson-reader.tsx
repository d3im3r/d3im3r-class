'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { ResourceToolsContext } from '@/shared/context/resource-tools-context';
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
  canPresent = false,
}: {
  lesson: Lesson;
  subject: Subject;
  institution: Institution;
  frameIndex: number;
  onFrameChange: (index: number) => void;
  completed: string[];
  onToggle: (id: string, forceCompleted?: boolean) => void;
  onBack: () => void;
  canPresent?: boolean;
}) {
  const [presenting, setPresenting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Selector y estado de herramientas por clase
  const storageKey = `d3im3r_tools_${lesson.id}`;
  const [toolsEnabled, setToolsEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === 'true';
    }
    return lesson.toolsEnabled ?? false;
  });

  const toggleTools = useCallback(() => {
    setToolsEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, String(next));
      }
      if (next) {
        toast.success('Herramientas activadas para esta clase');
      } else {
        toast.info('Herramientas desactivadas para esta clase');
      }
      return next;
    });
  }, [storageKey]);

  // Protección de contenido: Bloquear impresión y atajos de descarga/guardado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        toast.warning('Impresión no autorizada. El material es solo para visualización en aula.');
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        toast.warning('Descarga restringida. Este contenido solo puede visualizarse en el campus.');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'IMG' ||
          target.tagName === 'svg' ||
          target.closest('svg') ||
          target.closest('.diagram-render'))
      ) {
        e.preventDefault();
        toast.info('Guardado de recursos gráficos restringido (solo visualización).');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

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
    if (!canPresent) {
      toast.warning('El modo presentación está reservado exclusivamente para docentes.');
      return;
    }
    setFullscreen(false);
    setPresenting(true);
  }, [canPresent]);

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
    <ResourceToolsContext.Provider value={toolsEnabled}>
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
        toolsEnabled={toolsEnabled}
        onToggleTools={canPresent ? toggleTools : undefined}
        canPresent={canPresent}
      />

      {/* Vista modal de modo presentación (solo para docentes) */}
      {presenting && canPresent && (
        <div
          className={`presentation-dialog is-open ${fullscreen ? 'is-fullscreen' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={`Presentación: ${lesson.title}`}
        >
          <SlideDeck
            lesson={lesson}
            subject={subject}
            institution={institution}
            current={Math.min(frameIndex, lesson.frames.length - 1)}
            onFrameChange={onFrameChange}
            onClose={closePresentation}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            toolsEnabled={toolsEnabled}
            onToggleTools={canPresent ? toggleTools : undefined}
          />
        </div>
      )}
    </ResourceToolsContext.Provider>
  );
}
