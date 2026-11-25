<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/d3im3r/horizontal-dark.svg" />
    <img src="public/brand/d3im3r/horizontal-light.svg" alt="d3im3r owl-chip signature" width="360" />
  </picture>
  <h1>d3im3r Class · Aula</h1>
  <p>Plataforma académica interactiva para clases Beamer LaTeX, diagramas vectoriales TikZ y roles RBAC docente/estudiante.</p>
  <p>Created by <a href="https://github.com/d3im3r">d3im3r</a></p>
  <p>
    <a href="https://github.com/d3im3r/d3im3r-class"><img src="https://img.shields.io/badge/version-v0.1.0-facc15?style=flat" alt="Version 0.1.0" /></a>
    <a href="https://github.com/d3im3r/d3im3r-class/actions/workflows/ci.yml"><img src="https://github.com/d3im3r/d3im3r-class/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22-5fa04e?style=flat&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 22" /></a>
  </p>
  <p>
    <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16-000000?style=flat&amp;logo=nextdotjs&amp;logoColor=white" alt="Next.js 16" /></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-149eca?style=flat&amp;logo=react&amp;logoColor=white" alt="React 19" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5" /></a>
    <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind%20CSS-4-06b6d4?style=flat&amp;logo=tailwindcss&amp;logoColor=white" alt="Tailwind CSS 4" /></a>
    <a href="https://ui.shadcn.com/"><img src="https://img.shields.io/badge/shadcn%2Fui-18181b?style=flat&amp;logo=shadcnui&amp;logoColor=white" alt="shadcn/ui" /></a>
  </p>
  <p>
    <a href="https://supabase.com/"><img src="https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e?style=flat&amp;logo=supabase&amp;logoColor=white" alt="PostgreSQL Supabase" /></a>
    <a href="https://better-auth.com/"><img src="https://img.shields.io/badge/Better%20Auth-RBAC-000000?style=flat" alt="Better Auth RBAC" /></a>
    <a href="https://katex.org/"><img src="https://img.shields.io/badge/TikZ%20%26%20KaTeX-LaTeX-008080?style=flat&amp;logo=latex&amp;logoColor=white" alt="TikZ &amp; KaTeX" /></a>
    <a href="https://codemirror.net/"><img src="https://img.shields.io/badge/CodeMirror-6-d35400?style=flat" alt="CodeMirror 6" /></a>
  </p>
</div>

Convierte material docente escrito en LaTeX Beamer en un entorno de aprendizaje web interactivo. Ofrece lectura continua enriquecida con fórmulas matemáticas KaTeX ultrarrápidas, diapositivas a pantalla completa para clase en vivo, editor de código editable bajo demanda, compilación híbrida de diagramas TikZ y una suite completa de gestión académica basada en roles.

![Aula · Lectura Interactiva](docs/previews/reading.jpg)

## Características Principales

### 📖 Doble Modo de Visualización Pedagógica
- **Modo Lectura Continua:** Maquetación fluida y responsiva para móvil, tablet y escritorio. Incluye índice navegable de secciones, cálculo dinámico de altura para tablas y bloques, y tipografía optimizada para lectura técnica prolongada.
- **Modo Presentación en Vivo:** Experiencia tipo diapositiva Beamer para proyector o pantalla completa. Admite atajos de teclado completos (`←` / `→`, `Espacio`, `AvPág` / `RePág`, `Inicio` / `Fin`, `Escape`) y selector de salto directo a cualquier diapositiva.
- **Bloques Docentes Semánticos:** Diferenciación visual automática con paleta cromática propia para definición, teorema, resultado, ejemplo, práctica, advertencia, pregunta, idea y algoritmos estructurados.

### 📐 Motor Híbrido de Compilación TikZ
- **Renderizado Vectorial Nativo:** Pipeline de alta fidelidad basado en XeLaTeX, dvisvgm e Inkscape con cálculo milimétrico de *viewBox* y eliminación de fondos redundantes durante la importación de clases.
- **Fallback Autónomo a WebAssembly:** En entornos sin compilador TeX en el sistema operativo (como GitHub Actions o servidores en la nube), utiliza automáticamente `node-tikzjax` para generar los diagramas SVG sin interrumpir el flujo de importación.
- **Seguridad en Compilación:** Entorno aislado con lista blanca de comandos y entornos matemáticos/gráficos, prohibiendo expresamente comandos de riesgo (`\input`, `\openout`, `\write`, `^^`, etc.).
- **Diagnóstico Automático:** Detección y reporte preventivo de errores sintácticos de TeX durante la subida de clases Beamer.

### 💻 Editor y Herramientas de Código
- **Desactivadas por defecto:** En todas las clases las herramientas interactivas inician deshabilitadas, permitiendo que el docente decida si habilitarlas selectivamente.
- **Editor CodeMirror 6:** Integración ligera cargada bajo demanda para evitar sobrecarga en la carga inicial.
- **Resaltado Shiki:** Resaltado de sintaxis enriquecido para Python, JavaScript, HTML, CSS y SQL.
- **Entorno de Prueba:** Edición temporal en memoria para que los alumnos experimenten con fragmentos de código cuando el docente active las herramientas.

### 🔐 Seguridad y Control de Acceso Granular (RBAC)
- Autenticación robusta implementada con **Better Auth** sincronizada con la base de datos relacional.
- **Principio de Mínimo Privilegio:** Los estudiantes únicamente tienen visibilidad sobre las asignaturas y grupos en los que están matriculados activamente, y sólo acceden a clases en estado publicado.
- **Protección de Fuentes:** Los archivos fuente `.tex`, preámbulos y diagramas internos nunca son expuestos al perfil de estudiante; la descarga de materiales se valida en el servidor mediante `/api/materials/[lessonId]/[key]`.
- Baneo, desbaneo y revocación de materias con efecto inmediato en tiempo de ejecución.
- Rate limiting inteligente en rutas sensibles contra ataques de fuerza bruta.

### 🏫 Suite de Gestión Docente y Campus
- **Jerarquía Multinivel:** Organización estructurada por Instituciones ➔ Materias ➔ Temas / Grupos ➔ Clases.
- **Matriculación por Enlaces (`/join/[token]`):** Generación de enlaces de invitación por materia para auto-inscripción de estudiantes, con panel de moderación y aprobación de solicitudes.
- **Importación y Exportación Masiva en Excel (`.xlsx`):** Procesamiento de planillas de alumnos con detección inteligente de encabezados institucionales (`Aprendiz`, `Cédula`, `Documento`), preservación rigurosa de ceros iniciales en identificaciones y exportación del padrón estudiantil.
- **Flujo Editorial Completo:** Estados de clase Borrador ➔ Revisión ➔ Publicado, reordenamiento interactivo de clases y publicación programada por fecha (`publishAt`).

### 🎨 Personalización y Temas
- Paleta de color claro y oscuro con soporte para preferencia del sistema o selección manual persistente en `localStorage`.
- Script preventivo integrado en el encabezado HTML para garantizar renderizado sin parpadeos (*zero-flash*).
- Identidad visual oficial de **d3im3r** respetando proporciones vectoriales y compatibilidad multi-tema.

---

## Galería Visual

| Lectura Interactiva | Panel Docente |
|:---:|:---:|
| ![Lectura](docs/previews/reading.jpg) | ![Panel Docente](docs/previews/docente.jpg) |

| Modo Presentación Beamer | Catálogo del Alumno |
|:---:|:---:|
| ![Presentación](docs/previews/presentation.jpg) | ![Catálogo Alumno](docs/previews/alumno.jpg) |

| Importación Masiva Excel | Modo Oscuro |
|:---:|:---:|
| ![Excel Import](docs/previews/excel-import.jpg) | ![Modo Oscuro](docs/previews/dark-mode.jpg) |

---

## Roles y Matriz de Permisos

Las acciones y descargas de recursos se validan estrictamente en el backend. Cambiar la interfaz o los encabezados del cliente no concede accesos no autorizados.

| Capacidad | Administrador / Docente | Alumno Asignado | Alumno No Asignado / Público |
|:---|:---:|:---:|:---:|
| Ver catálogo y materias asignadas | ✅ | ✅ | ❌ |
| Lectura de clases publicadas | ✅ | ✅ | ❌ |
| Modo presentación y pantalla completa | ✅ | ✅ | ❌ |
| Edición interactiva de ejemplos de código | ✅ | ✅ | ❌ |
| Visualización de borradores y revisión previa | ✅ | ❌ | ❌ |
| Descarga de materiales complementarios y PDF | ✅ | ✅ | ❌ |
| Descarga de código fuente `.tex` original | ✅ | ❌ | ❌ |
| Creación y edición de materias, temas y clases | ✅ | ❌ | ❌ |
| Importación masiva de alumnos (Excel) | ✅ | ❌ | ❌ |
| Generación de enlaces de invitación `/join` | ✅ | ❌ | ❌ |
| Gestión de instituciones y logos | ✅ | ❌ | ❌ |

---

## Puesta en Marcha Local

Requiere **Node.js 22** y **npm**.

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/d3im3r/d3im3r-class.git
cd d3im3r-class
npm ci
```

### 2. Configurar variables de entorno

Crea un archivo `.env.local` en la raíz del proyecto:

```env
# Conexión PostgreSQL / Supabase
DATABASE_URL=postgres://usuario:password@localhost:5432/aula

# Secreto para sesiones Better Auth
BETTER_AUTH_SECRET=tu-secreto-aleatorio-de-al-menos-32-caracteres
BETTER_AUTH_URL=http://localhost:3101
```

### 3. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abre en tu navegador [http://127.0.0.1:3101](http://127.0.0.1:3101).

---

## Flujo de Compilación y Calidad (CI)

El proyecto cuenta con un pipeline de integración continua en GitHub Actions configurado en `.github/workflows/ci.yml`:

```bash
# 1. Comprobación de formato con Prettier
npm run format:check

# 2. Comprobación de tipos con TypeScript estricto
npm run typecheck

# 3. Suite de tests unitarios y de permisos RBAC
npm test

# 4. Compilación de producción con Webpack
npm run build
```

La suite de pruebas ejecuta **55 tests automatizados** cubriendo:
- Control de acceso RBAC y principio de mínimo privilegio.
- Creación de cuentas iniciales y sesiones criptográficas.
- Parser sintáctico de Beamer LaTeX y resolución de bloques matemáticos.
- Respaldo autónomo del compilador TikZ sin herramientas externas de sistema.
- Procesamiento de planillas Excel con encabezados heterogéneos y ceros iniciales.
- Ciclo de vida y cascadas de eliminación en instituciones, materias y clases.

---

## Arquitectura Feature-First

El código se organiza siguiendo el patrón modular *Feature-First*:

```text
src/
├── app/                  # Next.js App Router (páginas, layouts, endpoints /api)
│   ├── api/              # Endpoints REST protegidos (admin, auth, catalog, progress, tools)
│   └── join/[token]/     # Ruta de auto-inscripción de alumnos
├── features/
│   ├── administration/   # Panel docente, importación de clases, planillas Excel y base de datos
│   ├── auth/             # Better Auth, RBAC, gestión de roles, sesiones y contraseñas
│   ├── catalog/          # Modelos de instituciones, asignaturas y enlaces de invitación
│   ├── latex-import/     # Analizador léxico y sintáctico de documentos Beamer (.tex)
│   ├── learning/         # Seguimiento de progreso y restricciones de acceso para el estudiante
│   ├── reader/           # Lector continuo, presentación de diapositivas, KaTeX y TikZ
│   ├── theme/            # Proveedor de temas, selector claro/oscuro y firma d3im3r
│   └── tools/            # Entornos interactivos de código (Python/JS) y editor CodeMirror
├── components/           # Componentes UI reutilizables (botones, modales, toasts)
├── shared/               # Contextos compartidos y utilidades generales
└── lib/                  # Utilidades auxiliares, efectos visuales y limitador de peticiones
```

---

## Autor

**Deimer Miranda Montoya** · [@d3im3r](https://github.com/d3im3r)

## Marca y Licencia

El emblema vectorial oficial **d3im3r owl-chip** (`{o⌄o}`) se encuentra disponible en `public/brand/d3im3r/` en variantes claro y oscuro. Conserva sus proporciones y directrices de diseño descritas en [BRAND.md](public/brand/d3im3r/BRAND.md) y se distribuye bajo [su propia licencia permisiva](public/brand/d3im3r/LICENSE).
