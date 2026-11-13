'use client';
import { useState, useId } from 'react';
import {
  X,
  Save,
  CheckCircle2,
  Eye,
  FileCode,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers3,
  Copy,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Workflow,
  Sigma,
  BookOpen,
  Code2,
  FileText,
  AlertTriangle,
  Download,
  MonitorPlay,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Frame, Block } from '@/features/catalog/model/types';
import { ContentBlock } from '@/features/reader/components/content-block';
import { InlineText } from '@/features/reader/components/rich-text';

type LessonEditorProps = {
  initialTitle: string;
  initialSubtitle: string;
  initialFrames: Frame[];
  subjectId: string;
  topicId: string;
  topicName?: string;
  lessonId?: string;
  onSave: (data: {
    title: string;
    subtitle: string;
    frames: Frame[];
    publish: boolean;
    lessonId?: string;
    subjectId: string;
    topicId: string;
  }) => Promise<void>;
  onClose: () => void;
};

export function LessonEditorModal({
  initialTitle,
  initialSubtitle,
  initialFrames,
  subjectId,
  topicId,
  topicName,
  lessonId,
  onSave,
  onClose,
}: LessonEditorProps) {
  const [title, setTitle] = useState(initialTitle || 'Nueva clase');
  const [subtitle, setSubtitle] = useState(initialSubtitle || '');
  const [frames, setFrames] = useState<Frame[]>(
    initialFrames.length > 0
      ? initialFrames
      : [
          {
            id: 'frame-1',
            title: 'Introducción',
            section: 'General',
            line: 1,
            blocks: [{ type: 'text', content: 'Escribe aquí el contenido introductorio de la clase...' }],
          },
        ]
  );
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'both' | 'edit' | 'preview'>('both');
  const [previewViewMode, setPreviewViewMode] = useState<'reader' | 'slide'>('reader');
  const [saving, setSaving] = useState(false);

  const currentFrame = frames[selectedFrameIndex] || frames[0];

  // Actualizar un campo de la diapositiva actual
  const updateCurrentFrame = (updater: (prev: Frame) => Frame) => {
    setFrames((prev) => {
      const next = [...prev];
      if (next[selectedFrameIndex]) {
        next[selectedFrameIndex] = updater(next[selectedFrameIndex]);
      }
      return next;
    });
  };

  // Añadir una nueva diapositiva
  const handleAddFrame = () => {
    const newFrameId = `frame-${frames.length + 1}`;
    const newFrame: Frame = {
      id: newFrameId,
      title: `Diapositiva ${frames.length + 1}`,
      section: currentFrame?.section || 'General',
      line: 0,
      blocks: [{ type: 'text', content: 'Contenido de la nueva diapositiva...' }],
    };
    setFrames([...frames, newFrame]);
    setSelectedFrameIndex(frames.length);
  };

  // Duplicar diapositiva actual
  const handleDuplicateFrame = () => {
    const clone: Frame = JSON.parse(JSON.stringify(currentFrame));
    clone.id = `frame-${frames.length + 1}`;
    clone.title = `${clone.title} (Copia)`;
    const nextFrames = [...frames];
    nextFrames.splice(selectedFrameIndex + 1, 0, clone);
    setFrames(nextFrames);
    setSelectedFrameIndex(selectedFrameIndex + 1);
  };

  // Eliminar diapositiva
  const handleDeleteFrame = (index: number) => {
    if (frames.length <= 1) return;
    const next = frames.filter((_, i) => i !== index);
    setFrames(next);
    setSelectedFrameIndex(Math.max(0, index - 1));
  };

  // Reordenar diapositivas
  const handleMoveFrame = (direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? selectedFrameIndex - 1 : selectedFrameIndex + 1;
    if (targetIndex < 0 || targetIndex >= frames.length) return;
    const next = [...frames];
    const [moved] = next.splice(selectedFrameIndex, 1);
    next.splice(targetIndex, 0, moved);
    setFrames(next);
    setSelectedFrameIndex(targetIndex);
  };

  // Gestión de bloques dentro del frame actual
  const updateBlock = (blockIndex: number, updater: (b: Block) => Block) => {
    updateCurrentFrame((f) => {
      const nextBlocks = [...f.blocks];
      if (nextBlocks[blockIndex]) {
        nextBlocks[blockIndex] = updater(nextBlocks[blockIndex]);
      }
      return { ...f, blocks: nextBlocks };
    });
  };

  const handleAddBlock = (type: Block['type']) => {
    updateCurrentFrame((f) => {
      let newBlock: Block;
      switch (type) {
        case 'math':
          newBlock = { type: 'math', content: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', variant: 'display' };
          break;
        case 'code':
          newBlock = { type: 'code', language: 'python', content: '# Escribe tu código aquí\nprint("Hola mundo")' };
          break;
        case 'callout':
          newBlock = {
            type: 'callout',
            title: 'Concepto clave',
            variant: 'Idea',
            content: 'Este es un bloque pedagógico para destacar conceptos importantes.',
          };
          break;
        case 'table':
          newBlock = {
            type: 'table',
            content: '',
            rows: [
              ['Parámetro', 'Valor', 'Descripción'],
              ['x', '10', 'Posición horizontal'],
              ['y', '20', 'Posición vertical'],
            ],
          };
          break;
        case 'list':
          newBlock = {
            type: 'list',
            variant: 'itemize',
            items: [
              [{ type: 'text', content: 'Primer elemento' }],
              [{ type: 'text', content: 'Segundo elemento' }],
            ],
            content: '',
          };
          break;
        default:
          newBlock = { type: 'text', content: 'Nuevo párrafo explicativo...' };
      }
      return { ...f, blocks: [...f.blocks, newBlock] };
    });
  };

  const handleDeleteBlock = (blockIndex: number) => {
    updateCurrentFrame((f) => ({
      ...f,
      blocks: f.blocks.filter((_, i) => i !== blockIndex),
    }));
  };

  const handleMoveBlock = (blockIndex: number, direction: 'up' | 'down') => {
    updateCurrentFrame((f) => {
      const target = direction === 'up' ? blockIndex - 1 : blockIndex + 1;
      if (target < 0 || target >= f.blocks.length) return f;
      const nextBlocks = [...f.blocks];
      const [moved] = nextBlocks.splice(blockIndex, 1);
      nextBlocks.splice(target, 0, moved);
      return { ...f, blocks: nextBlocks };
    });
  };

  // Descargar el JSON actualizado
  const handleExportJson = () => {
    const dataToExport = {
      title,
      subtitle,
      stats: { frames: frames.length },
      exportedAt: new Date().toISOString(),
      frames,
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-editada.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async (publish: boolean) => {
    if (!title.trim()) {
      alert('Por favor ingresa un título para la clase.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        subtitle: subtitle.trim(),
        frames,
        publish,
        lessonId,
        subjectId,
        topicId,
      });
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al guardar la clase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(7, 11, 18, 0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        color: '#f0f4f8',
      }}
    >
      {/* Barra superior de acciones */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          background: 'rgba(18, 24, 38, 0.95)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '6px',
              background: '#245a49',
              color: '#d4f2e5',
              letterSpacing: '0.5px',
            }}
          >
            <Sparkles size={13} /> EDITOR EN VIVO
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título de la clase..."
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 600,
                padding: '3px 6px',
                outline: 'none',
                width: '100%',
              }}
              title="Haz clic para editar el título de la clase"
            />
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Subtítulo opcional de la clase..."
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '11px',
                padding: '2px 6px',
                outline: 'none',
                width: '100%',
              }}
            />
          </div>
        </div>

        {/* Controles de vista (Split / Edit / Preview) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '3px',
              borderRadius: '6px',
              gap: '3px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('both')}
              style={{
                padding: '4px 9px',
                fontSize: '11px',
                borderRadius: '4px',
                background: activeTab === 'both' ? '#2563eb' : 'transparent',
                color: activeTab === 'both' ? '#fff' : '#94a3b8',
                border: 0,
                cursor: 'pointer',
              }}
            >
              Dividido
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              style={{
                padding: '4px 9px',
                fontSize: '11px',
                borderRadius: '4px',
                background: activeTab === 'edit' ? '#2563eb' : 'transparent',
                color: activeTab === 'edit' ? '#fff' : '#94a3b8',
                border: 0,
                cursor: 'pointer',
              }}
            >
              Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              style={{
                padding: '4px 9px',
                fontSize: '11px',
                borderRadius: '4px',
                background: activeTab === 'preview' ? '#2563eb' : 'transparent',
                color: activeTab === 'preview' ? '#fff' : '#94a3b8',
                border: 0,
                cursor: 'pointer',
              }}
            >
              Vista Previa
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            title="Descargar una copia de seguridad en JSON"
            style={{ fontSize: '11px', gap: '4px' }}
          >
            <Download size={13} /> JSON
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => handleSave(false)}
            style={{ fontSize: '11px', gap: '5px' }}
          >
            <Save size={13} />
            {saving ? 'Guardando…' : 'Guardar borrador'}
          </Button>

          <Button
            size="sm"
            disabled={saving}
            onClick={() => handleSave(true)}
            style={{ fontSize: '11px', gap: '5px', background: '#16a34a', color: '#fff' }}
          >
            <CheckCircle2 size={13} />
            Publicar
          </Button>

          <button
            type="button"
            onClick={onClose}
            title="Cerrar sin guardar"
            style={{
              background: 'transparent',
              border: 0,
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Contenedor principal */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Barra lateral de Diapositivas / Frames */}
        <aside
          style={{
            width: '240px',
            background: 'rgba(13, 19, 30, 0.95)',
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
              Diapositivas ({frames.length})
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddFrame}
              title="Añadir nueva diapositiva"
              style={{ fontSize: '10px', height: '24px', padding: '0 7px', gap: '3px' }}
            >
              <Plus size={12} /> Añadir
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {frames.map((frame, index) => {
              const isSelected = index === selectedFrameIndex;
              const diagsCount = frame.blocks.filter((b) => b.type === 'diagram').length;
              const mathCount = frame.blocks.filter((b) => b.type === 'math').length;
              return (
                <div
                  key={frame.id}
                  onClick={() => setSelectedFrameIndex(index)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(37, 99, 235, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    transition: 'all 0.12s ease',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          color: isSelected ? '#93c5fd' : '#64748b',
                          fontFamily: 'monospace',
                        }}
                      >
                        {String(index + 1).padStart(2, '0')}.
                      </span>
                      <strong
                        style={{
                          fontSize: '12px',
                          color: isSelected ? '#fff' : '#cbd5e1',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: 'block',
                        }}
                      >
                        {frame.title || 'Sin título'}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '3px', fontSize: '9px', color: '#64748b' }}>
                      <span>{frame.blocks.length} bloques</span>
                      {diagsCount > 0 && <span style={{ color: '#38bdf8' }}>• {diagsCount} SVG</span>}
                      {mathCount > 0 && <span style={{ color: '#f59e0b' }}>• {mathCount} math</span>}
                    </div>
                  </div>

                  {isSelected && (
                    <div style={{ display: 'flex', gap: '2px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleMoveFrame('up')}
                        disabled={index === 0}
                        style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                        title="Subir"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveFrame('down')}
                        disabled={index === frames.length - 1}
                        style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                        title="Bajar"
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFrame(index)}
                        disabled={frames.length <= 1}
                        style={{ background: 'transparent', border: 0, color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                        title="Eliminar diapositiva"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Panel Izquierdo: Editor de Diapositiva Actual */}
        {(activeTab === 'both' || activeTab === 'edit') && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 24px',
              borderRight: activeTab === 'both' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
              background: '#0d131f',
            }}
          >
            {/* Cabecera del frame actual */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '18px',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '12px 16px',
                borderRadius: '8px',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 2, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                  Título de la Diapositiva:
                </label>
                <input
                  value={currentFrame.title}
                  onChange={(e) => updateCurrentFrame((f) => ({ ...f, title: e.target.value }))}
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '6px',
                    color: '#fff',
                    padding: '6px 10px',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ flex: 1, minWidth: '150px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                  Sección / Unidad:
                </label>
                <input
                  value={currentFrame.section}
                  onChange={(e) => updateCurrentFrame((f) => ({ ...f, section: e.target.value }))}
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '6px',
                    color: '#fff',
                    padding: '6px 10px',
                    fontSize: '13px',
                  }}
                />
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={handleDuplicateFrame}
                title="Duplicar esta diapositiva"
                style={{ fontSize: '11px', gap: '4px', alignSelf: 'flex-end' }}
              >
                <Copy size={12} /> Duplicar
              </Button>
            </div>

            {/* Lista de Bloques editables */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {currentFrame.blocks.map((block, blockIndex) => (
                <div
                  key={blockIndex}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '12px',
                    position: 'relative',
                  }}
                >
                  {/* Encabezado del bloque */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          background:
                            block.type === 'diagram'
                              ? 'rgba(56, 189, 248, 0.2)'
                              : block.type === 'math'
                              ? 'rgba(245, 158, 11, 0.2)'
                              : block.type === 'code'
                              ? 'rgba(168, 85, 247, 0.2)'
                              : block.type === 'callout'
                              ? 'rgba(34, 197, 94, 0.2)'
                              : 'rgba(255, 255, 255, 0.1)',
                          color:
                            block.type === 'diagram'
                              ? '#38bdf8'
                              : block.type === 'math'
                              ? '#f59e0b'
                              : block.type === 'code'
                              ? '#c084fc'
                              : block.type === 'callout'
                              ? '#4ade80'
                              : '#cbd5e1',
                        }}
                      >
                        {block.type === 'diagram'
                          ? 'Diagrama TikZ / SVG'
                          : block.type === 'math'
                          ? 'Fórmula Matemática'
                          : block.type === 'code'
                          ? `Código (${block.language || 'text'})`
                          : block.type === 'callout'
                          ? `Nota: ${block.title || 'Pedagógica'}`
                          : block.type === 'table'
                          ? 'Tabla'
                          : block.type === 'list'
                          ? 'Lista'
                          : 'Texto'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => handleMoveBlock(blockIndex, 'up')}
                        disabled={blockIndex === 0}
                        style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                        title="Mover arriba"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveBlock(blockIndex, 'down')}
                        disabled={blockIndex === currentFrame.blocks.length - 1}
                        style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                        title="Mover abajo"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBlock(blockIndex)}
                        style={{ background: 'transparent', border: 0, color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                        title="Eliminar bloque"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Cuerpo editable según tipo de bloque */}
                  {block.type === 'text' && (
                    <textarea
                      value={block.content}
                      onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, content: e.target.value }))}
                      rows={Math.max(3, Math.min(10, block.content.split('\n').length + 1))}
                      style={{
                        width: '100%',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '6px',
                        color: '#f0f6fc',
                        padding: '8px 10px',
                        fontSize: '12px',
                        fontFamily: 'inherit',
                        lineHeight: 1.6,
                        resize: 'vertical',
                      }}
                      placeholder="Texto del bloque (acepta $fórmulas$ KaTeX)..."
                    />
                  )}

                  {block.type === 'math' && (
                    <textarea
                      value={block.content}
                      onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, content: e.target.value }))}
                      rows={Math.max(2, Math.min(8, block.content.split('\n').length + 1))}
                      style={{
                        width: '100%',
                        background: '#090d16',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '6px',
                        color: '#fde68a',
                        padding: '8px 10px',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        lineHeight: 1.5,
                      }}
                      placeholder="Expresión LaTeX matemática (ej. \begin{pmatrix} a & b \\ c & d \end{pmatrix})..."
                    />
                  )}

                  {block.type === 'code' && (
                    <div>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                        <select
                          value={block.language || 'python'}
                          onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, language: e.target.value }))}
                          style={{
                            background: '#161b26',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '3px 8px',
                          }}
                        >
                          <option value="python">Python</option>
                          <option value="javascript">JavaScript</option>
                          <option value="html">HTML</option>
                          <option value="css">CSS</option>
                          <option value="cpp">C++</option>
                          <option value="bash">Bash / Consola</option>
                          <option value="sql">SQL</option>
                          <option value="text">Texto plano</option>
                        </select>
                      </div>
                      <textarea
                        value={block.content}
                        onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, content: e.target.value }))}
                        rows={Math.max(4, Math.min(14, block.content.split('\n').length + 1))}
                        style={{
                          width: '100%',
                          background: '#090d16',
                          border: '1px solid rgba(168, 85, 247, 0.3)',
                          borderRadius: '6px',
                          color: '#e9d5ff',
                          padding: '8px 10px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          lineHeight: 1.5,
                          whiteSpace: 'pre',
                        }}
                      />
                    </div>
                  )}

                  {block.type === 'callout' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          value={block.variant || 'Idea'}
                          onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, variant: e.target.value }))}
                          style={{
                            background: '#161b26',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '3px 8px',
                          }}
                        >
                          <option value="Idea">Idea clave</option>
                          <option value="DefBlock">Definición</option>
                          <option value="Practice">Actividad práctica</option>
                          <option value="Warning">Atención / Advertencia</option>
                          <option value="Question">Pregunta guía</option>
                          <option value="ExampleBlock">Ejemplo</option>
                          <option value="Result">Resultado</option>
                          <option value="Compare">Comparación</option>
                        </select>
                        <input
                          value={block.title || ''}
                          onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, title: e.target.value }))}
                          placeholder="Título del callout..."
                          style={{
                            flex: 1,
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '4px',
                            color: '#fff',
                            padding: '3px 8px',
                            fontSize: '12px',
                          }}
                        />
                      </div>
                      <textarea
                        value={block.content}
                        onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, content: e.target.value }))}
                        rows={3}
                        style={{
                          width: '100%',
                          background: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '6px',
                          color: '#f0f6fc',
                          padding: '6px 10px',
                          fontSize: '12px',
                        }}
                      />
                    </div>
                  )}

                  {block.type === 'diagram' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div
                        style={{
                          background: '#fff',
                          borderRadius: '6px',
                          padding: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          maxHeight: '220px',
                          overflow: 'hidden',
                        }}
                      >
                        {block.asset ? (
                          <img
                            src={block.asset}
                            alt="Diagrama SVG"
                            style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }}
                          />
                        ) : (
                          <div style={{ color: '#64748b', fontSize: '11px', textAlign: 'center' }}>
                            <Workflow size={24} style={{ margin: 'auto', marginBottom: '4px' }} />
                            Diagrama sin SVG compilado (utilizará el renderizador de respaldo)
                          </div>
                        )}
                      </div>
                      <details style={{ fontSize: '11px', color: '#94a3b8' }}>
                        <summary style={{ cursor: 'pointer', padding: '4px 0' }}>
                          Ver / Editar código fuente TikZ
                        </summary>
                        <textarea
                          value={block.content}
                          onChange={(e) => updateBlock(blockIndex, (b) => ({ ...b, content: e.target.value }))}
                          rows={4}
                          style={{
                            width: '100%',
                            background: '#090d16',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px',
                            color: '#93c5fd',
                            padding: '6px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            marginTop: '4px',
                          }}
                        />
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Barra de añadir nuevo bloque */}
            <div
              style={{
                marginTop: '18px',
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px dashed rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>+ Añadir bloque:</span>
              <Button size="sm" variant="outline" onClick={() => handleAddBlock('text')} style={{ fontSize: '11px', gap: '4px' }}>
                <FileText size={12} /> Texto
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAddBlock('math')} style={{ fontSize: '11px', gap: '4px' }}>
                <Sigma size={12} /> Matemáticas
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAddBlock('code')} style={{ fontSize: '11px', gap: '4px' }}>
                <Code2 size={12} /> Código
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAddBlock('callout')} style={{ fontSize: '11px', gap: '4px' }}>
                <BookOpen size={12} /> Nota / Callout
              </Button>
            </div>
          </div>
        )}

        {/* Panel Derecho: Vista Previa en Vivo (WYSIWYG con temas nativos y barra fija) */}
        {(activeTab === 'both' || activeTab === 'preview') && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              height: '100%',
              background: 'var(--background, #0c121e)',
              borderLeft: activeTab === 'both' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
              overflow: 'hidden',
            }}
          >
            {/* Barra superior de herramientas del Preview */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 18px',
                background: 'rgba(15, 23, 42, 0.75)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                flexShrink: 0,
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Vista previa:</span>
                <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <button
                    type="button"
                    onClick={() => setPreviewViewMode('reader')}
                    style={{
                      background: previewViewMode === 'reader' ? '#2563eb' : 'transparent',
                      color: previewViewMode === 'reader' ? '#fff' : '#94a3b8',
                      border: 0,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '3px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <BookOpen size={12} /> Lectura interactiva
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewMode('slide')}
                    style={{
                      background: previewViewMode === 'slide' ? '#2563eb' : 'transparent',
                      color: previewViewMode === 'slide' ? '#fff' : '#94a3b8',
                      border: 0,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '3px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <MonitorPlay size={12} /> Diapositiva
                  </button>
                </div>
              </div>

              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {currentFrame.section || 'General'} · Diapositiva {selectedFrameIndex + 1} de {frames.length}
              </span>
            </div>

            {/* Área de documento con scroll independiente */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '28px clamp(14px, 3vw, 40px)',
              }}
            >
              {previewViewMode === 'reader' ? (
                <div
                  className="continuous-reader"
                  style={{
                    background: 'transparent',
                    padding: 0,
                    maxWidth: '860px',
                    margin: '0 auto',
                    width: '100%',
                  }}
                >
                  <div className="reading-document" style={{ width: '100%', margin: '0 auto' }}>
                    <div style={{ borderBottom: '1px solid var(--border, #e2e8f0)', paddingBottom: '14px', marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted, #64748b)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                          {currentFrame.section || 'General'} · Diapositiva {selectedFrameIndex + 1} de {frames.length}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--muted, #94a3b8)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Eye size={12} /> Vista previa WYSIWYG
                        </span>
                      </div>
                      <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 0', color: 'var(--foreground, #0f172a)' }}>
                        <InlineText text={currentFrame.title || 'Sin título'} />
                      </h2>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {currentFrame.blocks.map((block, idx) => (
                        <ContentBlock key={idx} block={block} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="presentation-stage" style={{ padding: '0', minHeight: 'auto', background: 'transparent' }}>
                  <div
                    className="presentation-slide"
                    style={{
                      maxWidth: '920px',
                      width: '100%',
                      height: 'auto',
                      minHeight: '440px',
                      borderRadius: '12px',
                      margin: '0 auto',
                      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
                    }}
                  >
                    <div className="slide-heading">
                      <div>
                        <span>{currentFrame.section || 'General'} · DIAPOSITIVA {selectedFrameIndex + 1} DE {frames.length}</span>
                        <h2><InlineText text={currentFrame.title || 'Sin título'} /></h2>
                      </div>
                    </div>
                    <div
                      className="slide-content"
                      data-has-multiple={currentFrame.blocks.length > 1}
                      style={{
                        padding: '18px clamp(16px, 3vw, 40px)',
                        overflowY: 'auto',
                        maxHeight: '68vh',
                      }}
                    >
                      <div className="slide-content-inner" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {currentFrame.blocks.map((block, idx) => (
                          <ContentBlock key={idx} block={block} />
                        ))}
                      </div>
                    </div>
                    <div className="slide-footer">
                      <span>{selectedFrameIndex + 1} / {frames.length}</span>
                      <span>Aula · Vista previa de presentación</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Barra de navegación inferior fija (nunca se superpone a las imágenes) */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 20px',
                background: 'rgba(11, 17, 32, 0.95)',
                backdropFilter: 'blur(10px)',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                flexShrink: 0,
                zIndex: 20,
              }}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={selectedFrameIndex === 0}
                onClick={() => setSelectedFrameIndex((i) => Math.max(0, i - 1))}
                style={{ fontSize: '11px', gap: '4px' }}
              >
                <ChevronLeft size={14} /> Anterior
              </Button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
                  {selectedFrameIndex + 1} / {frames.length}
                </span>
                <select
                  value={selectedFrameIndex}
                  onChange={(e) => setSelectedFrameIndex(Number(e.target.value))}
                  style={{
                    background: '#162338',
                    color: '#e2ecff',
                    border: '1px solid #3b5070',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    maxWidth: '260px',
                  }}
                >
                  {frames.map((f, i) => (
                    <option key={f.id || i} value={i}>
                      {String(i + 1).padStart(2, '0')}. {f.title || `Diapositiva ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={selectedFrameIndex === frames.length - 1}
                onClick={() => setSelectedFrameIndex((i) => Math.min(frames.length - 1, i + 1))}
                style={{ fontSize: '11px', gap: '4px' }}
              >
                Siguiente <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
