# Propuesta de persistencia en línea para Aula

Estado: propuesta; el campus sigue utilizando SQLite. No se han enviado datos ni configurado servicios externos.

## Recomendación

Supabase como plataforma: PostgreSQL para el catálogo y las asignaciones, Auth para las identidades y sesiones, Storage privado para .tex, PDF, imágenes y SVG. Encaja con las tres necesidades que ya tiene Aula y evita mantener por separado autenticación, base y archivos.

Prisma ORM es una capa opcional de consultas tipadas y migraciones sobre PostgreSQL; puede usarse con la base de Supabase. No sustituye Auth ni Storage. Prisma Postgres es un servicio hospedado distinto, que habría que complementar con autenticación y almacenamiento.

Para esta fase prefiero Supabase con su SDK oficial y migraciones SQL, aprovechando Auth y RLS de manera uniforme. Si el modelo de datos y las consultas del backend crecen, podemos introducir Prisma deliberadamente; conviene que haya una sola herramienta responsable de las migraciones del esquema.

## Distribución propuesta

| Componente | Destino |
| --- | --- |
| Instituciones, materias, temas, clases y revisiones | PostgreSQL |
| Perfiles docente/alumno | Perfil asociado a la identidad de Supabase Auth |
| Asignaciones y progreso | PostgreSQL, con políticas por usuario y materia |
| .tex, PDF, ilustraciones y SVG | Bucket privado de Storage |
| Compilación de TikZ | Proceso Node/Python en un trabajador con TeX instalado |

La compilación con XeLaTeX no se resuelve por elegir una base en línea. Debe mantenerse un entorno de trabajo para las figuras y subir sus resultados al almacenamiento privado.

## Migración planteada

1. Definir esquema normalizado y migraciones: instituciones, materias, temas, clases, versiones, archivos, perfiles, asignaciones y progreso.
2. Integrar Auth en Next.js y mantener el alta docente controlada. No permitir que un alumno elija su rol.
3. Definir y probar RLS para alumnos asignados y clases publicadas, además de los permisos del backend.
4. Migrar catálogo, asignaciones y progreso, preservando IDs cuando sea posible.
5. Migrar archivos a Storage privado y emitir descargas autenticadas o enlaces firmados cortos desde el backend autorizado.
6. Migrar las identidades de manera explícita. Las contraseñas scrypt actuales no se deben asumir compatibles con el proveedor; elegir un flujo de invitación/restablecimiento o una transición verificada.
7. Probar los casos de acceso y revocación actuales antes de cambiar el campus activo. Conservar una copia de la base y archivos locales.

Si se utiliza Prisma, sus conexiones PostgreSQL no heredan automáticamente la identidad JWT de Supabase Auth. Debemos definir roles de conexión y el modelo de autorización explícitamente; no asumir que las políticas del cliente y las consultas del servidor usan el mismo contexto.

No introducir credenciales privadas en componentes cliente. La configuración y conexión se realizarán cuando se elija el proyecto de Supabase; no es necesario cambiar la interfaz para tomar esa decisión.

## Fuentes oficiales consultadas

- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
- https://www.prisma.io/docs/orm/v6/overview/introduction/what-is-prisma
