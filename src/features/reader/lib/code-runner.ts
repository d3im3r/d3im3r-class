/**
 * code-runner.ts
 * Motores de ejecución en el navegador para JavaScript, Python (Pyodide WASM) y HTML/CSS.
 */

export interface RunResult {
  success: boolean;
  output: string[];
  error?: string;
  executionTimeMs?: number;
}

// ==========================================
// 1. MOTOR JAVASCRIPT EN NAVEGADOR
// ==========================================
export async function runJavaScript(code: string): Promise<RunResult> {
  const start = performance.now();
  const output: string[] = [];

  // Crear consola virtual para capturar logs
  const formatArg = (arg: unknown): string => {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'object' || Array.isArray(arg)) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  };

  const customConsole = {
    log: (...args: unknown[]) => output.push(args.map(formatArg).join(' ')),
    info: (...args: unknown[]) => output.push('ℹ ' + args.map(formatArg).join(' ')),
    warn: (...args: unknown[]) => output.push('⚠ ' + args.map(formatArg).join(' ')),
    error: (...args: unknown[]) => output.push('✖ ' + args.map(formatArg).join(' ')),
  };

  try {
    // Si el código no tiene return ni console.log y es una sola expresión, evaluar su resultado
    const trimmed = code.trim();
    let runnableCode = code;

    // Detectar si termina en una expresión evaluable para mostrar su valor si no hubo logs
    const isSingleExpression =
      !trimmed.includes('\n') &&
      !trimmed.startsWith('const ') &&
      !trimmed.startsWith('let ') &&
      !trimmed.startsWith('var ') &&
      !trimmed.startsWith('function ') &&
      !trimmed.startsWith('class ') &&
      !trimmed.startsWith('if ') &&
      !trimmed.startsWith('for ') &&
      !trimmed.startsWith('while ');

    const wrappedCode = `
      return (async () => {
        ${isSingleExpression ? `return (${trimmed});` : runnableCode}
      })();
    `;

    // Ejecutar con AsyncFunction
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('console', wrappedCode);
    const result = await fn(customConsole);

    if (result !== undefined && isSingleExpression) {
      output.push(formatArg(result));
    }

    if (output.length === 0) {
      output.push('✔ Código ejecutado exitosamente (sin salida de consola).');
    }

    const elapsed = Math.round(performance.now() - start);
    return {
      success: true,
      output,
      executionTimeMs: elapsed,
    };
  } catch (err: unknown) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output,
      error: message,
      executionTimeMs: elapsed,
    };
  }
}

// ==========================================
// 2. MOTOR PYTHON EN NAVEGADOR (PYODIDE WASM)
// ==========================================
declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<any>;
    __pyodidePromise?: Promise<any>;
  }
}

const PYODIDE_VERSION = 'v0.26.4';
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

let pyodideInstance: any = null;

async function getPyodide(onProgress?: (status: string) => void): Promise<any> {
  if (pyodideInstance) return pyodideInstance;

  if (window.__pyodidePromise) {
    return window.__pyodidePromise;
  }

  window.__pyodidePromise = (async () => {
    onProgress?.('Descargando entorno Python WebAssembly...');

    // Inyectar el script de Pyodide si no está presente
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${PYODIDE_INDEX_URL}pyodide.js`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('No se pudo cargar el script de Pyodide desde CDN.'));
        document.head.appendChild(script);
      });
    }

    onProgress?.('Inicializando motor Python 3 en el navegador...');
    const pyodide = await window.loadPyodide!({
      indexURL: PYODIDE_INDEX_URL,
    });

    pyodideInstance = pyodide;
    return pyodide;
  })();

  try {
    return await window.__pyodidePromise;
  } catch (err) {
    window.__pyodidePromise = undefined;
    throw err;
  }
}

export async function runPython(
  code: string,
  onStatusChange?: (status: string) => void
): Promise<RunResult> {
  const start = performance.now();
  const output: string[] = [];

  try {
    onStatusChange?.('Cargando Python...');
    const pyodide = await getPyodide(onStatusChange);

    onStatusChange?.('Ejecutando script Python...');

    // Redirigir stdout y stderr a nuestro capturador
    pyodide.setStdout({
      batched: (text: string) => {
        if (text.trim().length > 0 || text === '\n') {
          output.push(text.replace(/\n$/, ''));
        }
      },
    });

    pyodide.setStderr({
      batched: (text: string) => {
        output.push('✖ ' + text.replace(/\n$/, ''));
      },
    });

    const result = await pyodide.runPythonAsync(code);

    if (result !== undefined && result !== null && String(result) !== 'None') {
      output.push(String(result));
    }

    if (output.length === 0) {
      output.push('✔ Código Python ejecutado exitosamente (sin salida de print).');
    }

    const elapsed = Math.round(performance.now() - start);
    return {
      success: true,
      output,
      executionTimeMs: elapsed,
    };
  } catch (err: unknown) {
    const elapsed = Math.round(performance.now() - start);
    let message = err instanceof Error ? err.message : String(err);

    // Limpiar traza interna de WebAssembly si existe
    if (message.includes('PythonError:')) {
      const parts = message.split('PythonError:');
      message = parts[parts.length - 1].trim();
    }

    return {
      success: false,
      output,
      error: message,
      executionTimeMs: elapsed,
    };
  }
}

// ==========================================
// 3. UTILIDADES DE LENGUAJE
// ==========================================
export type LanguageCategory = 'javascript' | 'python' | 'html' | 'unsupported';

export function getLanguageCategory(lang: string = ''): LanguageCategory {
  const normalized = lang.toLowerCase().trim();
  if (['js', 'javascript', 'ts', 'typescript', 'node'].includes(normalized)) {
    return 'javascript';
  }
  if (['py', 'python', 'python3'].includes(normalized)) {
    return 'python';
  }
  if (['html', 'htm', 'xml', 'css'].includes(normalized)) {
    return 'html';
  }
  return 'unsupported';
}

// ==========================================
// 4. PLANTILLA Y CONSTRUCTOR DOM PARA JS / HTML
// ==========================================
export const DEFAULT_JS_DOM_TEMPLATE = `<div id="app" style="text-align: center; padding: 20px;">
  <h2>Laboratorio DOM interactivo</h2>
  <p id="mensaje">Interactúa con este elemento desde JavaScript:</p>
  <button id="miBoton" style="padding: 8px 16px; font-size: 14px; background: #2563eb; color: #fff; border: 0; border-radius: 6px; cursor: pointer;">
    Hacer clic
  </button>
  <div id="salida" style="margin-top: 15px; font-weight: 600; color: #16a34a;"></div>
</div>`;

export function buildSandboxDocument({
  html = '',
  js = '',
  sandboxId = '',
}: {
  html?: string;
  js?: string;
  sandboxId?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      margin: 0;
      color: #1e293b;
      background: #ffffff;
      line-height: 1.5;
    }
    button {
      font-family: inherit;
    }
  </style>
</head>
<body>
  ${html}
  <script>
    (function() {
      const sandboxId = ${JSON.stringify(sandboxId)};
      function send(type, args) {
        try {
          const str = args.map(a => {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'object' || Array.isArray(a)) {
              try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
            }
            return String(a);
          }).join(' ');
          window.parent.postMessage({ type: 'aula-runner-log', sandboxId, level: type, message: str }, '*');
        } catch(e) {}
      }
      console.log = function(...args) { send('log', args); };
      console.info = function(...args) { send('info', args); };
      console.warn = function(...args) { send('warn', args); };
      console.error = function(...args) { send('error', args); };
      window.onerror = function(msg, url, line) {
        send('error', ['Error en línea ' + line + ': ' + msg]);
      };
    })();
    try {
      ${js}
    } catch(err) {
      console.error(err.message || String(err));
    }
  <\/script>
</body>
</html>`;
}
