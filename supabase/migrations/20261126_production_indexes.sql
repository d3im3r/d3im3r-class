-- Migración de Índices Críticos de Producción para Supabase PostgreSQL
-- Optimiza consultas de filtrado de lecciones, inscripciones, grupos y progreso del alumno.

-- 1. Búsqueda rápida de lecciones por materia (acelera /api/catalog y snapshot)
CREATE INDEX IF NOT EXISTS idx_lessons_subject_id ON lessons(subject_id);

-- 2. Búsqueda de alumnos matriculados por materia
CREATE INDEX IF NOT EXISTS idx_enrollments_subject_id ON enrollments(subject_id);

-- 3. Búsqueda de pertenencia a grupos por usuario (acelera resolución de cohortes)
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

-- 4. Búsqueda y registro de progreso del estudiante por usuario y lección
CREATE INDEX IF NOT EXISTS idx_progress_user_lesson ON progress(user_id, lesson_id);

-- 5. Búsqueda de materias por institución
CREATE INDEX IF NOT EXISTS idx_subjects_institution_id ON subjects(institution_id);

-- 6. Liberación de temas y clases por cohorte / grupo
CREATE INDEX IF NOT EXISTS idx_group_lesson_releases_group_id ON group_lesson_releases(group_id);

-- 7. Matrículas específicas por tema para alumnos
CREATE INDEX IF NOT EXISTS idx_topic_enrollments_user_id ON topic_enrollments(user_id);
