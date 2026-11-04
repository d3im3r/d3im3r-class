# Verificación de navegación y lectura

29 de octubre de 2026. Realizada en una instancia de producción aislada, con cuentas ficticias y base temporal.

- Escritorio de 1280 px: la lectura ocupa el ancho disponible y no mantiene columnas de navegación; el índice es un diálogo flotante a la derecha.
- Tablet de 768 × 1024 y 1024 × 768: sin desbordamiento horizontal del documento; navegación superpuesta y cerrable.
- Móvil de 390 × 844 y 320 × 568: sin desbordamiento horizontal de la lectura; índice adaptado al ancho y controles accesibles.
- Presentación en 320 px: ancho del diálogo y ancho de desplazamiento iguales (320 px). Las fórmulas largas tienen desplazamiento interno.
- El índice se cierra al seleccionar sección; se conserva la posición de lectura.
- El menú lateral se cierra con Escape y devuelve el foco al botón de navegación.
- La preferencia de ocultar el menú de escritorio se conserva al recargar.
- Compilación de producción y 17 pruebas del parser/permisos correctas.

Capturas: `previews/reader-wide-index.jpg`, `previews/reader-tablet.jpg` y `previews/reader-mobile.jpg`.
