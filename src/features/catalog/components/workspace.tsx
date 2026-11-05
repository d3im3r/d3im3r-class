'use client';
import { useEffect, useState, useRef } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Layers3,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Terminal,
  Workflow,
  X,
  Settings2,
  LogOut,
  CheckCircle2,
  FolderOpen,
  Plus,
  Upload,
} from 'lucide-react';
import type { Catalog, Lesson, Subject } from '../model/types';
import { Button } from '@/components/ui/button';
import { BrandSignature } from '@/features/theme/brand-signature';
import { ThemeControls } from '@/features/theme/theme-toggle';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { fireCelebration } from '@/lib/confetti';
import { ResourceToolsContext } from '@/features/tools/components/resource-tools-context';
const ToolsPanel = dynamic(
  () => import('@/features/tools/components/tools-panel').then((m) => m.ToolsPanel),
  { loading: () => <p className="p-8">Cargando herramientas…</p> }
);
import type { User, Progress } from '@/features/auth/types';
import { hasPermission } from '@/features/auth/client';
import { institutionLogo } from '../model/institution-logo';
import { LessonReader } from '@/features/reader/components/lesson-reader';
const AdminPanel = dynamic(
  () => import('@/features/administration/components/admin-panel').then((m) => m.AdminPanel),
  { loading: () => <p className="p-8">Cargando gestión docente…</p> }
);
export function Workspace({
  catalog: initialCatalog,
  user,
  initialProgress,
}: {
  catalog: Catalog;
  user: User;
  initialProgress: Progress;
}) {
  const [toolSeed, setToolSeed] = useState<string | undefined>(),
    [toolVersion, setToolVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [compact, setCompact] = useState(false);
  const navigation = useRef<HTMLElement>(null),
    navigationToggle = useRef<HTMLButtonElement>(null);
  const [catalog, setCatalog] = useState(initialCatalog),
    [saveError, setSaveError] = useState('');
  const pending = useRef(new Set<string>());
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  async function refreshCatalog() {
    try {
      const response = await fetch('/api/catalog', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as Catalog;
      setCatalog(next);
      setLessonId((currentId) =>
        currentId && !next.lessons.some((l) => l.id === currentId) ? null : currentId
      );
    } catch {
      try {
        sessionStorage.setItem('aula-restore-admin', '1');
      } catch {}
      window.location.reload();
    }
  }
  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (response.ok) window.location.assign('/');
    else setSaveError('No se pudo cerrar la sesión. Inténtalo nuevamente.');
  }
  const [institution, setInstitution] = useState('all'),
    [query, setQuery] = useState(''),
    [view, setView] = useState('subjects'),
    [subjectSelection, setSubjectSelection] = useState<string | null>(null),
    [lessonId, setLessonId] = useState<string | null>(null),
    [frameIndex, setFrameIndex] = useState(0),
    [progress, setProgress] = useState<Progress>(initialProgress),
    [ready, setReady] = useState(false),
    [mobile, setMobile] = useState(false);
  const canManageCampus = hasPermission(user, { campus: ['manage'] }),
    canUseTools = hasPermission(user, { tools: ['use'] }),
    canInspectSource = hasPermission(user, { tools: ['inspectSource'] }),
    canReadDraft = hasPermission(user, { lesson: ['readDraft'] });
  useEffect(() => {
    try {
      if (canManageCampus && sessionStorage.getItem('aula-restore-admin') === '1') {
        sessionStorage.removeItem('aula-restore-admin');
        setView('admin');
      }
    } catch {}
    const params = new URLSearchParams(location.search);
    const id = params.get('class');
    if (catalog.lessons.some((l) => l.id === id)) {
      setLessonId(id);
      const n = Number(params.get('frame'));
      if (Number.isInteger(n) && n >= 0) {
        const l = catalog.lessons.find((l) => l.id === id)!;
        setFrameIndex(Math.min(n, l.frames.length - 1));
      }
    }
    setReady(true);
  }, [catalog, canManageCampus]);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(location.href);
    if (lessonId) {
      url.searchParams.set('class', lessonId);
      url.searchParams.set('frame', String(frameIndex));
    } else {
      url.searchParams.delete('class');
      url.searchParams.delete('frame');
    }
    history.replaceState(null, '', url);
  }, [lessonId, frameIndex, ready]);
  const lesson = catalog.lessons.find((l) => l.id === lessonId);
  const frame = lesson?.frames[Math.min(frameIndex, lesson.frames.length - 1)];
  const reading = !!lesson && !!frame && view !== 'admin',
    overlayNavigation = compact || reading,
    sidebarShown = overlayNavigation ? mobile : !sidebarCollapsed,
    drawerOpen = overlayNavigation && sidebarShown;
  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem('aula-sidebar-collapsed') === 'true');
    } catch {}
    const media = matchMedia('(max-width: 1024px)');
    const update = () => {
      setCompact(media.matches);
      setMobile(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function collapseNavigation(value: boolean) {
    setSidebarCollapsed(value);
    try {
      localStorage.setItem('aula-sidebar-collapsed', String(value));
    } catch {}
  }
  function closeNavigation() {
    if (overlayNavigation) setMobile(false);
    else collapseNavigation(true);
    navigationToggle.current?.focus({ preventScroll: true });
  }
  function toggleNavigation() {
    if (overlayNavigation) setMobile((value) => !value);
    else collapseNavigation(!sidebarCollapsed);
  }
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aside = navigation.current;
    aside?.querySelector<HTMLButtonElement>('.sidebar-dismiss')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobile(false);
        navigationToggle.current?.focus({ preventScroll: true });
      }
      if (event.key === 'Tab') {
        const items = aside?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select'
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);
  const filtered = catalog.subjects.filter(
    (s) =>
      (institution === 'all' || s.institutionId === institution) &&
      `${s.name} ${s.description} ${catalog.institutions.find((i) => i.id === s.institutionId)?.name} ${catalog.lessons
        .filter((l) => l.subjectId === s.id)
        .map((l) => l.title + ' ' + l.frames.map((f) => f.title).join(' '))
        .join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase())
  );
  const read = Object.values(progress).reduce((sum, items) => sum + items.length, 0);
  function openLesson(l: Lesson) {
    setLessonId(l.id);
    const done = progress[l.id] ?? [];
    const next = l.frames.findIndex((f) => !done.includes(f.id));
    setFrameIndex(next < 0 ? 0 : next);
    setMobile(false);
  }
  async function toggle(id: string) {
    if (!lesson) return;
    const lessonId = lesson.id,
      key = lessonId + id;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    const completed = !(progress[lessonId] ?? []).includes(id);
    try {
      const response = await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, frameId: id, completed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const nextDone = completed
        ? [...new Set([...(progress[lessonId] ?? []), id])]
        : (progress[lessonId] ?? []).filter((item) => item !== id);
      setProgress((p) => ({
        ...p,
        [lessonId]: nextDone,
      }));
      setSaveError('');
      if (completed && lesson.frames.length > 0 && nextDone.length === lesson.frames.length) {
        fireCelebration();
        toast.success(`¡Felicitaciones! Has completado el 100% de «${lesson.title}» 🎓🎉`, {
          description: 'Todo tu avance se ha registrado exitosamente en tu perfil.',
        });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar tu progreso.');
    } finally {
      pending.current.delete(key);
    }
  }
  useEffect(() => {
    if (!canUseTools) return;
    const open = (event: Event) => {
      const source = (event as CustomEvent<string>).detail;
      if (typeof source !== 'string') return;
      setToolSeed(source);
      setToolVersion((v) => v + 1);
      setLessonId(null);
      setView('tools');
      setMobile(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('aula:inspect-resource', open);
    return () => window.removeEventListener('aula:inspect-resource', open);
  }, [canUseTools]);
  function home(v = 'subjects') {
    setLessonId(null);
    setView(v);
    setMobile(false);
    setActiveTopicFilter(null);
  }
  const [activeTopicFilter, setActiveTopicFilter] = useState<string | null>(null);

  function goToAdmin(topicId?: string) {
    if (!selectedSubject) {
      home('admin');
      return;
    }
    try {
      sessionStorage.setItem(
        'aula-admin-state',
        JSON.stringify({
          tab: topicId ? 'lessons' : 'topics',
          selectedInstitution: selectedSubject.institutionId,
          selectedSubject: selectedSubject.id,
          selectedTopic: topicId || '',
        })
      );
    } catch {}
    setView('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const selectedSubject = catalog.subjects.find((s) => s.id === subjectSelection);
  const subjectLessons = selectedSubject
    ? catalog.lessons.filter((l) => l.subjectId === selectedSubject.id)
    : [];
  const subjectRead = selectedSubject
    ? subjectLessons.reduce((sum, l) => sum + (progress[l.id]?.length ?? 0), 0)
    : read;
  const currentSubject = catalog.subjects.find((s) => s.id === lesson?.subjectId);
  function subjectCard(s: Subject) {
    const lessons = catalog.lessons.filter((l) => l.subjectId === s.id);
    const institution = catalog.institutions.find((i) => i.id === s.institutionId)!;
    const count = lessons.reduce((n, l) => n + l.frames.length, 0);
    const completed = lessons.reduce((n, l) => n + (progress[l.id]?.length ?? 0), 0);
    return (
      <article className={`subject-card ${s.icon}`} key={s.id}>
        <div className="card-art">
          <div className="art-grid" />
          <span className="institution-tag">
            {institutionLogo(institution) && <img src={institutionLogo(institution)!} alt="" />}
            {institution.shortName}
          </span>
          {s.icon === 'robot' ? (
            <div className="robot-illustration">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="node node-one" />
              <div className="node node-two" />
              <div className="node node-three" />
              <Workflow size={68} strokeWidth={1.1} />
              <span>NODO → TÓPICO → MENSAJE</span>
            </div>
          ) : (
            <div className="web-illustration">
              <div className="mini-browser">
                <div className="browser-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="mini-layout">
                  <div />
                  <div />
                  <div />
                </div>
                <div className="mini-lines">
                  <i />
                  <i />
                </div>
              </div>
              <span>{'{ display: flex; }'}</span>
            </div>
          )}
        </div>
        <div className="card-body">
          <div className="eyebrow">
            {s.code}
            <span>•</span>
            {s.icon === 'robot' ? 'INGENIERÍA' : 'DESARROLLO WEB'}
          </div>
          <h3>{s.name}</h3>
          <p>{s.description || 'Explora los temas y clases disponibles en esta asignatura.'}</p>
          <div className="card-meta">
            <span>
              <FolderOpen size={14} />
              {s.topics.length} tema
            </span>
            <span>
              <BookOpen size={14} />
              {lessons.length} clase
            </span>
            <span>
              <Layers3 size={14} />
              {count} bloques
            </span>
          </div>
          <div className="card-progress">
            <div>
              <span>Tu progreso</span>
              <strong>{count ? Math.round((completed / count) * 100) : 0}%</strong>
            </div>
            <div className="progress-track">
              <i style={{ width: `${count ? (completed / count) * 100 : 0}%` }} />
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => {
              setSubjectSelection(s.id);
              setView('course');
            }}
          >
            {completed ? 'Continuar aprendiendo' : 'Explorar asignatura'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </article>
    );
  }
  return (
    <ResourceToolsContext.Provider value={canInspectSource}>
      <div
        className={`app-shell ${!sidebarShown ? 'navigation-hidden' : ''} ${overlayNavigation ? 'navigation-overlay' : ''} ${reading ? 'reading-workspace' : ''}`}
      >
        <aside
          ref={navigation}
          id="campus-navigation"
          aria-label="Navegación del campus"
          aria-hidden={!sidebarShown}
          inert={!sidebarShown}
          className={`sidebar ${sidebarShown ? 'is-open' : ''}`}
        >
          <a href="/" className="brand">
            <span className="aula-wordmark">
              aula<span>.</span>
            </span>
            <span className="brand-credit">
              by
              <BrandSignature />
            </span>
          </a>
          {drawerOpen && (
            <button
              className="sidebar-dismiss"
              onClick={closeNavigation}
              aria-label="Ocultar navegación"
              title="Ocultar navegación"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
          <div className="workspace-label">ESPACIO DE APRENDIZAJE</div>
          <button className="workspace-switch" onClick={() => home('institutions')}>
            <span className="workspace-icon">
              <GraduationCap size={20} />
            </span>
            <span>
              <strong>Mi campus</strong>
              <small>{user.name}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <nav>
            {canManageCampus && (
              <button className={view === 'admin' ? 'active' : ''} onClick={() => home('admin')}>
                <Settings2 size={18} />
                Gestión docente
              </button>
            )}
            {canUseTools && (
              <button
                className={view === 'tools' ? 'active' : ''}
                onClick={() => {
                  setToolSeed(undefined);
                  setToolVersion((v) => v + 1);
                  home('tools');
                }}
              >
                <Workflow size={18} />
                Herramientas
              </button>
            )}
            <button
              className={!lesson && view === 'subjects' ? 'active' : ''}
              onClick={() => home()}
            >
              <LayoutGrid size={18} />
              Mis asignaturas<span className="nav-count">{catalog.subjects.length}</span>
            </button>
            <button
              className={!lesson && view === 'institutions' ? 'active' : ''}
              onClick={() => home('institutions')}
            >
              <Building2 size={18} />
              Instituciones
            </button>
            <button
              className={!lesson && view === 'progress' ? 'active' : ''}
              onClick={() => home('progress')}
            >
              <CheckCircle2 size={18} />
              Mi progreso
            </button>
          </nav>
          <div className="sidebar-divider" />
          <div className="workspace-label">MIS INSTITUCIONES</div>
          {catalog.institutions.map((i) => (
            <button
              key={i.id}
              className={`institution-link ${institution === i.id ? 'selected' : ''}`}
              onClick={() => {
                setInstitution(i.id);
                home();
              }}
            >
              <span className={`institution-dot ${i.color}`} />
              {i.shortName}
              <ChevronRight size={14} />
            </button>
          ))}
          <div className="sidebar-note">
            <div>
              <BookOpen size={19} />
              <span>Aprende a tu ritmo</span>
            </div>
            <p>
              Cada clase es un paso más.
              <br />
              Tu siguiente idea empieza aquí.
            </p>
          </div>
          <div className="profile">
            <span>{initials}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === 'admin'
                  ? 'Administrador'
                  : user.role === 'teacher'
                    ? 'Docente'
                    : 'Alumno'}
              </small>
            </div>
            <button
              className="logout-button"
              onClick={logout}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>
        {drawerOpen && (
          <button
            className="navigation-backdrop"
            aria-label="Cerrar navegación"
            onClick={closeNavigation}
          />
        )}
        <div className="main-shell" inert={drawerOpen} aria-hidden={drawerOpen ? true : undefined}>
          <header className="topbar">
            <div>
              <button
                ref={navigationToggle}
                className="navigation-toggle"
                onClick={toggleNavigation}
                aria-label={sidebarShown ? 'Ocultar navegación' : 'Mostrar navegación'}
                title={sidebarShown ? 'Ocultar navegación' : 'Mostrar navegación'}
                aria-expanded={sidebarShown}
                aria-controls="campus-navigation"
              >
                {sidebarShown ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
              </button>
              <button
                type="button"
                className="breadcrumb-btn"
                onClick={() => home()}
                title="Volver al inicio de mi campus"
              >
                Mi campus
              </button>
              <ChevronRight size={13} />
              {view === 'course' && selectedSubject && (
                <>
                  <span>
                    {catalog.institutions.find((i) => i.id === selectedSubject.institutionId)
                      ?.shortName ?? 'Materia'}
                  </span>
                  <ChevronRight size={13} />
                </>
              )}
              <strong>
                {lesson
                  ? currentSubject?.name
                  : view === 'admin'
                    ? 'Gestión docente'
                    : view === 'tools'
                      ? 'Herramientas'
                      : view === 'course'
                        ? selectedSubject?.name
                        : view === 'institutions'
                          ? 'Instituciones'
                          : view === 'progress'
                            ? 'Mi progreso'
                            : 'Mis asignaturas'}
              </strong>
            </div>
            <span className="topbar-right">
              <ThemeControls />
              {canManageCampus && view !== 'admin' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => home('admin')}
                  title="Cambiar al panel de gestión docente"
                  style={{ fontSize: '12px', height: '30px', padding: '0 10px', gap: '6px' }}
                >
                  <Settings2 size={14} />
                  Gestión docente
                </Button>
              )}
              <span className="live-dot" /> Tu espacio de aprendizaje{' '}
              <span className="avatar-small">{initials}</span>
            </span>
          </header>
          {saveError && (
            <div className="workspace-error" role="alert">
              {saveError}
            </div>
          )}
          {view === 'tools' && canUseTools ? (
            <ToolsPanel key={toolVersion} catalog={catalog} seed={toolSeed} />
          ) : view === 'admin' && canManageCampus ? (
            <AdminPanel onCatalogChange={refreshCatalog} user={user} />
          ) : lesson && frame ? (
            <LessonReader
              key={lesson.id}
              lesson={lesson}
              subject={currentSubject!}
              institution={catalog.institutions.find((i) => i.id === lesson.institutionId)!}
              frameIndex={frameIndex}
              onFrameChange={setFrameIndex}
              completed={progress[lesson.id] ?? []}
              onToggle={toggle}
              onBack={() => {
                setLessonId(null);
                setSubjectSelection(lesson.subjectId);
                setView('course');
              }}
            />
          ) : (
            <main className="dashboard">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow welcome-eyebrow">
                    <span /> APRENDE. EXPLORA. CONSTRUYE.
                  </div>
                  <h1>
                    {view === 'course'
                      ? selectedSubject?.name
                      : view === 'institutions'
                        ? 'Un campus, varias instituciones.'
                        : view === 'progress'
                          ? 'Cada paso cuenta.'
                          : 'Tu próxima idea empieza aquí.'}
                  </h1>
                  <p>
                    {view === 'course'
                      ? selectedSubject?.description ||
                        'Explora los temas y clases de esta asignatura.'
                      : view === 'institutions'
                        ? 'Encuentra tus asignaturas organizadas por institución.'
                        : view === 'progress'
                          ? 'Retoma tus clases y sigue construyendo conocimiento.'
                          : 'Tus asignaturas, clases y prácticas. Todo en un mismo espacio.'}
                  </p>
                </div>
                <div className="semester-badge">
                  <GraduationCap size={17} />
                  <span>
                    PERIODO ACADÉMICO<strong>2026 · II</strong>
                  </span>
                </div>
              </div>
              <div className="stats-grid">
                <div>
                  <span className="stat-icon sage">
                    <BookOpen size={20} />
                  </span>
                  <div>
                    <strong>
                      {(view === 'course' && selectedSubject
                        ? selectedSubject.topics.length
                        : catalog.subjects.length
                      )
                        .toString()
                        .padStart(2, '0')}
                    </strong>
                    <span>
                      {view === 'course' && selectedSubject
                        ? 'Temas en esta materia'
                        : 'Asignaturas disponibles'}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon sand">
                    <Building2 size={20} />
                  </span>
                  <div>
                    <strong>
                      {(view === 'course' && selectedSubject ? 1 : catalog.institutions.length)
                        .toString()
                        .padStart(2, '0')}
                    </strong>
                    <span>
                      {view === 'course' && selectedSubject
                        ? (catalog.institutions.find((i) => i.id === selectedSubject.institutionId)
                            ?.shortName ?? 'Institución')
                        : 'Instituciones'}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lilac">
                    <Layers3 size={20} />
                  </span>
                  <div>
                    <strong>
                      {(view === 'course' && selectedSubject
                        ? subjectLessons.length
                        : catalog.lessons.length
                      )
                        .toString()
                        .padStart(2, '0')}
                    </strong>
                    <span>
                      {view === 'course' && selectedSubject
                        ? subjectLessons.length === 1
                          ? 'Clase en esta materia'
                          : 'Clases en esta materia'
                        : 'Clases para explorar'}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon blue">
                    <CheckCircle2 size={20} />
                  </span>
                  <div>
                    <strong>
                      {(view === 'course' && selectedSubject ? subjectRead : read)
                        .toString()
                        .padStart(2, '0')}
                    </strong>
                    <span>Bloques completados</span>
                  </div>
                </div>
              </div>
              {view === 'course' && selectedSubject ? (
                <>
                  <div className="course-nav-header">
                    <button className="back-link" onClick={() => home()}>
                      <ChevronLeft size={15} />
                      Volver a mis asignaturas
                    </button>
                    {canManageCampus && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToAdmin()}
                        title="Abrir panel de administración para esta asignatura"
                        style={{ gap: '6px' }}
                      >
                        <Settings2 size={14} />
                        <span>Gestionar asignatura</span>
                      </Button>
                    )}
                  </div>
                  <div className="section-title">
                    <div>
                      <h2>
                        Temas y clases <span>{selectedSubject.topics.length}</span>
                      </h2>
                      <p>
                        {
                          catalog.institutions.find((i) => i.id === selectedSubject.institutionId)
                            ?.name
                        }
                      </p>
                    </div>
                    {canManageCampus && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const firstTopic = selectedSubject.topics[0]?.id;
                          goToAdmin(firstTopic);
                        }}
                        title="Crear o importar una clase en esta materia"
                        style={{ gap: '6px' }}
                      >
                        <Plus size={15} />
                        <span>Nueva clase</span>
                      </Button>
                    )}
                  </div>

                  {selectedSubject.topics.length > 1 && (
                    <div className="topic-filter-bar">
                      <button
                        type="button"
                        className={`topic-filter-chip ${activeTopicFilter === null ? 'active' : ''}`}
                        onClick={() => setActiveTopicFilter(null)}
                      >
                        Todos los temas ({selectedSubject.topics.length})
                      </button>
                      {selectedSubject.topics.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`topic-filter-chip ${activeTopicFilter === t.id ? 'active' : ''}`}
                          onClick={() => setActiveTopicFilter(t.id)}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedSubject.topics.length === 0 ? (
                    <div
                      className="topic-empty-state"
                      style={{ borderRadius: '12px', border: '1px solid var(--border)' }}
                    >
                      <FolderOpen size={32} style={{ opacity: 0.5 }} />
                      <p>Esta materia aún no tiene temas configurados.</p>
                      {canManageCampus && (
                        <Button size="sm" onClick={() => goToAdmin()}>
                          <Plus size={14} />
                          Crear el primer tema
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="topic-list">
                      {selectedSubject.topics
                        .filter(
                          (topic) => activeTopicFilter === null || topic.id === activeTopicFilter
                        )
                        .map((topic, index) => {
                          const topicLessons = catalog.lessons.filter(
                            (l) => l.subjectId === selectedSubject.id && l.topicId === topic.id
                          );
                          return (
                            <section key={topic.id} className="topic-section">
                              <div className="topic-title">
                                <span>{String(index + 1).padStart(2, '0')}</span>
                                <div>
                                  <div className="eyebrow">TEMA</div>
                                  <h3>{topic.name}</h3>
                                </div>
                                <div className="topic-actions">
                                  <span className="topic-lesson-count">
                                    {topicLessons.length}{' '}
                                    {topicLessons.length === 1 ? 'clase' : 'clases'}
                                  </span>
                                  {canManageCampus && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        goToAdmin(topic.id);
                                      }}
                                      title="Añadir o importar clase en este tema"
                                      style={{
                                        gap: '5px',
                                        height: '28px',
                                        fontSize: '11px',
                                        padding: '0 9px',
                                      }}
                                    >
                                      <Plus size={13} />
                                      <span>Añadir clase</span>
                                    </Button>
                                  )}
                                  <FolderOpen size={20} />
                                </div>
                              </div>
                              {topicLessons.length === 0 ? (
                                <div className="topic-empty-state">
                                  <p>Aún no hay clases en este tema.</p>
                                  {canManageCampus && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => goToAdmin(topic.id)}
                                      style={{ gap: '6px' }}
                                    >
                                      <Upload size={14} />
                                      Importar clase en «{topic.name}»
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                topicLessons.map((l) => (
                                  <div className="topic-lesson" key={l.id}>
                                    <span className="stat-icon sage">
                                      <BookOpen size={20} />
                                    </span>
                                    <div>
                                      <h4>{l.title}</h4>
                                      <p>
                                        {l.subtitle ? `${l.subtitle} · ` : ''}
                                        {l.frames.length} bloques{' '}
                                        {canReadDraft && l.status === 'draft' && (
                                          <span className="status-badge draft">Borrador</span>
                                        )}
                                      </p>
                                      <small>
                                        {progress[l.id]?.length ?? 0} bloques completados
                                      </small>
                                    </div>
                                    <Button variant="outline" onClick={() => openLesson(l)}>
                                      Abrir clase
                                      <ArrowRight size={15} />
                                    </Button>
                                  </div>
                                ))
                              )}
                            </section>
                          );
                        })}
                    </div>
                  )}
                </>
              ) : view === 'institutions' ? (
                <>
                  <div className="section-title">
                    <h2>
                      Mis instituciones <span>{catalog.institutions.length}</span>
                    </h2>
                    <p>Un lugar para cada comunidad de aprendizaje.</p>
                  </div>
                  <div className="institutions-grid">
                    {catalog.institutions.map((i) => (
                      <button
                        className="institution-card"
                        key={i.id}
                        onClick={() => {
                          setInstitution(i.id);
                          setView('subjects');
                        }}
                      >
                        <span className={`institution-monogram ${i.color}`}>
                          {institutionLogo(i) ? (
                            <img src={institutionLogo(i)!} alt={i.shortName} />
                          ) : (
                            <Building2 size={30} />
                          )}{' '}
                        </span>
                        <h3>{i.name}</h3>
                        <p>{i.city}</p>
                        <span>
                          {catalog.subjects.filter((s) => s.institutionId === i.id).length}{' '}
                          asignatura <ArrowRight size={16} />
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : view === 'progress' ? (
                <>
                  <div className="section-title">
                    <h2>Tu recorrido</h2>
                    <p>El progreso se guarda en tu cuenta.</p>
                  </div>
                  <div className="progress-lessons">
                    {catalog.lessons.map((l) => {
                      const count = progress[l.id]?.length ?? 0;
                      return (
                        <article key={l.id}>
                          <span className="stat-icon sage">
                            <BookOpen size={20} />
                          </span>
                          <div>
                            <h3>{l.title}</h3>
                            <p>
                              {count} de {l.frames.length} bloques leídos
                            </p>
                            <div className="progress-track">
                              <i style={{ width: `${(count / l.frames.length) * 100}%` }} />
                            </div>
                          </div>
                          <Button variant="outline" onClick={() => openLesson(l)}>
                            Continuar
                            <ArrowRight size={15} />
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="section-title">
                    <div>
                      <h2>
                        Mis asignaturas <span>{filtered.length}</span>
                      </h2>
                      <p>Elige una asignatura y continúa tu recorrido.</p>
                    </div>
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="Buscar asignaturas o contenidos"
                        placeholder="Buscar asignatura o contenido…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button aria-label="Limpiar búsqueda" onClick={() => setQuery('')}>
                          <X size={14} />
                        </button>
                      )}
                    </label>
                  </div>
                  <div className="filter-row">
                    <div>
                      {[
                        { id: 'all', shortName: 'Todas las instituciones' },
                        ...catalog.institutions,
                      ].map((i) => (
                        <button
                          key={i.id}
                          className={institution === i.id ? 'selected' : ''}
                          onClick={() => setInstitution(i.id)}
                        >
                          {i.shortName}
                        </button>
                      ))}
                    </div>
                    <span>
                      <LayoutGrid size={15} />
                      Vista de asignaturas
                    </span>
                  </div>
                  <div className="subject-grid">{filtered.map(subjectCard)}</div>
                  {!filtered.length && (
                    <div className="empty-state">
                      <Search size={30} />
                      <h3>
                        {catalog.subjects.length
                          ? 'No encontramos asignaturas'
                          : 'Aún no tienes materias asignadas'}
                      </h3>
                      <p>
                        {catalog.subjects.length
                          ? 'Prueba otra búsqueda o selecciona todas las instituciones.'
                          : 'Tu docente puede asignarte materias desde Gestión docente.'}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery('');
                          setInstitution('all');
                        }}
                      >
                        Restablecer filtros
                      </Button>
                    </div>
                  )}
                  <div className="learning-banner">
                    <span className="banner-icon">
                      <Terminal size={25} />
                    </span>
                    <div>
                      <span className="eyebrow">DEL CONCEPTO A LA PRÁCTICA</span>
                      <h3>El conocimiento se construye haciendo.</h3>
                      <p>Explora ejemplos, modifica código y avanza a tu ritmo en cada clase.</p>
                    </div>
                    <span className="banner-decoration">{'</>'}</span>
                  </div>
                </>
              )}
              <footer>
                <span>
                  <span className="footer-brand">aula.</span> Un espacio para aprender, sin límites.
                </span>
                <span>
                  Creado por <BrandSignature surface="card" className="footer-signature" />
                </span>
              </footer>
            </main>
          )}
        </div>
      </div>
    </ResourceToolsContext.Provider>
  );
}
