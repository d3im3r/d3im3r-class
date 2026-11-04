# Aula

Plataforma académica con roles docente y alumno, lectura continua, presentación, código editable y modo claro/oscuro. Next.js App Router, React, TypeScript, Tailwind CSS, componentes basados en shadcn/Radix y SQLite local. Arquitectura features-first.

## Ejecutar y acceder

Requiere Node.js 22.13 o posterior (SQLite integrado), npm y disco persistente con permiso de escritura.

```sh
npm install
npm run dev
```

Abre http://127.0.0.1:3101. La primera visita muestra **Configura tu campus**: crea tu cuenta docente con nombre, usuario y contraseña de al menos 10 caracteres. No hay contraseñas predeterminadas. Esta configuración se cierra al existir el primer docente.

Para producción local:

```sh
npm run build
npm start
```

## Roles y flujo docente

Las acciones se autorizan en el servidor; cambiar la interfaz o el rol enviado por el cliente no concede permisos.

| Rol | Acceso |
| --- | --- |
| Docente | Gestión del campus, vista previa de borradores y publicados, importación, revisión, publicación, creación de alumnos y asignación de materias. |
| Alumno | Solo materias asignadas y clases publicadas. Lectura, presentación, edición temporal de ejemplos y progreso individual. |

En **Gestión docente**:

1. **Instituciones:** crea o edita la institución; al editar puedes cargar su logo PNG/JPG/WebP.
2. **Materias y temas:** crea la materia dentro de una institución, añade temas, cambia sus nombres y su orden.
3. **Clases:** selecciona materia y tema; carga `.tex`, PDF opcional e imágenes. También puedes sustituir una clase existente.
4. La importación produce un **borrador** y muestra avisos de imágenes faltantes o TikZ no compatible. Usa **Vista previa** para comprobar lectura y presentación.
5. Confirma la revisión de la versión y pulsa **Completar revisión**. Solo entonces se habilita **Publicar clase**.
6. **Alumnos y asignaciones:** crea la cuenta del alumno con su contraseña inicial, selecciona sus materias y guarda. Comunica las credenciales por tu canal habitual; la aplicación no envía mensajes.

Una clase publicada puede volver a borrador. Reemplazar su contenido la devuelve a borrador, invalida su revisión y reinicia su progreso. Las asignaciones se pueden retirar; los nuevos accesos a la clase y sus archivos se rechazan inmediatamente. Una copia ya descargada por un usuario no se puede retirar de su dispositivo.

El primer docente administra el campus completo. No hay registro público de alumnos ni altas adicionales de docentes desde la interfaz en esta versión. Recuperación de contraseña, autenticación institucional y grupos de alumnos no están incluidos todavía.

## Almacenamiento y permisos

- `.data/aula.sqlite`: usuarios, sesiones, catálogo editable, estado de publicación, asignaciones y progreso.
- `.data/uploads/`: fuentes y materiales cargados desde el panel.
- `.data/logos/`: logos institucionales cargados.
- `content/materials/`: archivos originales y SVG de los ejemplos que se incorporan al crear una base de datos nueva.
- `public/`: identidad visual y logos originales; los materiales de clase no se sirven como archivos públicos.

`.data/` está excluida de Git. Conserva esta carpeta en disco persistente; para una copia simple detén el servicio antes de copiarla. `AULA_DATA_DIR` permite cambiar su ubicación. Esta implementación está pensada para una instancia Node con disco persistente; no para funciones con almacenamiento efímero.

Los materiales se descargan por `/api/materials/<clase>/<recurso>`, que comprueba sesión, publicación y asignación. Los nombres de usuario son únicos. Las contraseñas se guardan mediante scrypt con sal aleatoria; las sesiones usan tokens aleatorios, digest en la base de datos y cookies HttpOnly/SameSite. Hay límite de intentos de inicio de sesión. En un despliegue HTTPS configura `AULA_SECURE_COOKIES=1`.

La preferencia visual (`aula-theme`) se guarda en el navegador; el progreso se guarda en la cuenta y no se mezcla entre alumnos que usan el mismo equipo.

## Importación de contenido

El panel admite documentos Beamer de la plantilla docente: frames, secciones, listas, tablas sencillas, matemáticas, macros docentes, código minted y sus envoltorios, smartimage y TikZ. No interpreta todo TeX ni ejecuta el preámbulo completo o las instrucciones de los documentos.

Límites de importación: `.tex` de hasta 2 MB, PDF de hasta 20 MB, hasta 30 imágenes PNG/JPG/WebP, total de 35 MB y hasta 60 diagramas. Los recursos se resuelven por su nombre de archivo; dentro de una carga los nombres deben ser diferentes. `\\input` de documentos auxiliares y archivos ZIP no están soportados.

La compilación de TikZ requiere Python 3, XeLaTeX, dvisvgm, standalone, TikZ, fontspec, amsmath, amssymb y fontawesome5. El trabajador de cargas usa comandos permitidos, `-no-shell-escape`, restricciones de lectura/escritura y tiempos máximos; los comandos no admitidos se señalan para revisión. El PDF original sigue disponible como referencia. Los 49 diagramas originales ya están compilados.

Los comandos anteriores de archivos siguen disponibles **para preparar el catálogo inicial**, no para sustituir la gestión de una base de datos ya creada:

```sh
npm run content:build
```

Lee `content/catalog.json`, analiza los `.tex`, compila las figuras y regenera `content/generated.json`. El catálogo inicial se importa una sola vez a SQLite; no sobreescribe los cambios del panel en posteriores arranques. Los resultados gráficos se guardan en `content/materials/assets/diagrams/`, no en `public/`.

```
content/
  catalog.json
  generated.json
  templates/template-slide.tex
  institutions/<institucion>/subjects/<materia>/topics/<tema>/classes/<clase>/sources/
  materials/
    resources/
    assets/teaching/
    assets/diagrams/
  resources/
    asset-manifest.json
    diagram-manifest.json
    diagram-diagnostics.json
    latex/diagram-preamble.tex
```

La antigua carpeta `Template/` se retiró después de verificar sus recursos. Se conservan el inventario y las huellas SHA-256. La identidad d3im3r está en `public/brand/d3im3r/`, con su licencia y procedencia; la dirección visual toma como referencia microROS Studio.

## Lectura e interacción

Lectura continua por secciones, fórmulas en línea, listas y tablas. Idea, definición, resultado, práctica, advertencia, pregunta, comparación y ejemplo tienen colores propios. **Presentar clase** usa la misma estructura y permite flechas, PageUp/PageDown, espacio, Home/End y selector de diapositiva; Escape regresa a la lectura. La pantalla completa depende del navegador. El editor CodeMirror se carga bajo demanda y Shiki resalta el código. La ejecución de Python, SQL, Bash y ROS no está habilitada.

## Organización del código

- `auth`: inicio de sesión, configuración inicial, sesiones y roles.
- `administration`: persistencia SQLite, panel docente, importación y publicación.
- `learning`: filtrado de catálogo y autorización de materiales y progreso.
- `catalog`: navegación de materias y clases.
- `latex-import`: parser y adaptador de la plantilla.
- `reader`: lectura, presentación y código.
- `theme`: modos claro/oscuro y paletas Default, invincible theme y Clean Slate, tomadas de microROS Studio.

## Verificación

```sh
npm test
npm run typecheck
npm run build
```

Las pruebas de acceso crean su propia base SQLite temporal: alta inicial, credenciales, materias asignadas, borradores, revisión, publicación, revocación y origen de las solicitudes. La prueba integral `scripts/test-roles-api.mjs` se ejecuta exclusivamente contra una instancia aislada con base nueva (`AULA_TEST_URL`, por defecto puerto 3102). Crea cuentas ficticias y prueba una importación real con imágenes y TikZ; no se debe ejecutar contra el campus de uso diario.

### Navegación y lectura adaptable

La barra superior permite mostrar y ocultar la navegación del campus; la preferencia de escritorio se guarda como `aula-sidebar-collapsed`. Al abrir una clase, la navegación se oculta automáticamente y el documento ocupa el ancho disponible. En tablet y móvil el menú se abre sobre el contenido y se cierra con su botón, el fondo o Escape.

**En esta clase** abre el índice flotante en la derecha; en móvil se adapta como un panel inferior. Se cierra al seleccionar una sección, pulsar Escape, usar su botón de cierre o tocar fuera. El menú y el índice ocultos no retienen el foco de teclado. La presentación ocupa toda la ventana, sin márgenes exteriores ni barras de desplazamiento. Los bloques extensos se distribuyen en partes navegables; las fórmulas y diagramas se ajustan al espacio disponible.

La propuesta de persistencia en línea está en `docs/architecture/online-database.md`; no se ha conectado ni migrado ningún dato a un servicio externo. Para probar otra instancia en el mismo host usa un nombre de cookie diferente mediante `AULA_SESSION_COOKIE`, además de otra `AULA_DATA_DIR`.


### Importar alumnos desde Excel

En **Gestión docente → Alumnos → Importar alumnos desde Excel**, descarga la plantilla `.xlsx`, completa `nombre`, `correo` e `identificacion` y pulsa **Revisar Excel**. La identificación debe guardarse como texto para conservar ceros iniciales. Se admiten hasta 500 alumnos y archivos de 2 MB.

La vista previa identifica errores y duplicados antes de crear cuentas. Selecciona las materias y confirma la importación; puedes omitir explícitamente las filas incorrectas. Los alumnos nuevos ingresan con su correo y su identificación como contraseña inicial, almacenada mediante hash scrypt. Las cuentas existentes conservan sus credenciales y sólo reciben nuevas materias si se selecciona esa opción.

### Reparar diagramas y recursos

La importación compila TikZ mediante el proceso restringido y reutiliza imágenes docentes compartidas cuando corresponden a los recursos de la plantilla. Los errores de compilación se muestran por diagrama. En **Gestión docente → Clases**, **Reparar recursos** recupera imágenes o diagramas faltantes sin cambiar publicación, revisión ni progreso.

Las pruebas `student-roster.test.ts`, `presentation-pages.test.ts` y `theme-script.test.ts` cubren importación, paginación y preferencias. `scripts/test-excel-and-tikz.mjs` verifica el flujo integral únicamente en el campus aislado del puerto 3102; utiliza cuentas ficticias.


### Herramientas: laboratorio TikZ

El menú **Herramientas** está disponible para docentes. Permite cargar los recursos de una clase o escribir un entorno `tikzpicture`, editarlo con números de línea, probarlo y descargar el SVG. Los errores incluyen la línea que reporta LaTeX, el registro de compilación y sugerencias. Utiliza el mismo preámbulo y las mismas restricciones del importador; no acepta preámbulos ni macros arbitrarias. Las pruebas se eliminan al terminar y no modifican las clases.

Los recursos del lector incluyen **Ver código y revisar recurso**, incluso si la imagen no carga. Los docentes pueden abrir ese código directamente en herramientas. Para imágenes se muestra la ruta esperada y se puede comprobar su archivo. Una corrección probada debe incorporarse al `.tex` y volver a importarse para actualizar la clase.


### Acceso a fuentes docentes

El catálogo enviado al alumno excluye el código TikZ, el archivo `.tex` y los diagnósticos internos, también en bloques anidados. Las rutas de materiales autorizan a los alumnos únicamente imágenes y PDF de sus clases publicadas y asignadas; los archivos fuente quedan restringidos a docentes. El código de programación que forma parte de las actividades didácticas sigue disponible. La revisión de recursos y el laboratorio son exclusivos del docente.

El cambio claro/oscuro utiliza un botón de icono con etiqueta accesible. Los controles usan los mismos valores semánticos de microROS Studio (por ejemplo `muted` en botones de contorno y `input` en selectores), con las paletas originales. La composición y los colores semánticos de los bloques docentes son propios de Aula.
