/**
 * Helper to extract matching balanced delimiter groups (e.g., '{...}').
 */
export function group(source: string, start: number, open = '{', close = '}') {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) {
      return { value: source.slice(start + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Grupo sin cerrar en posición ${start}`);
}

/**
 * Detección heurística de lenguajes de programación comunes
 * cuando un bloque de código viene marcado como 'text' o genérico.
 */
export function detectLanguage(content: string, hint?: string): string {
  const normalizedHint = hint?.toLowerCase().trim();
  if (
    normalizedHint &&
    normalizedHint !== 'text' &&
    normalizedHint !== 'code' &&
    normalizedHint !== 'auto'
  ) {
    return normalizedHint;
  }

  const trimmed = content.trim();

  // 1. HTML detection: tags típicos de HTML o doctype
  if (
    /<!DOCTYPE\s+html/i.test(trimmed) ||
    /<\/?(html|head|body|div|span|p|a|ul|ol|li|table|tr|td|th|h[1-6]|form|input|button|meta|link|title|header|footer|nav|section|article|main|aside|script|style)\b/i.test(
      trimmed
    )
  ) {
    return 'html';
  }

  // 2. CSS detection: selectores seguidos de llaves con propiedades de estilo
  if (
    /(@media|@keyframes|\*|body|html|\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)\s*\{[^}]*(?:margin|padding|color|background|font|display|border|box-sizing|width|height|flex|grid|position)\s*:/i.test(
      trimmed
    ) ||
    /(?:box-sizing|border-radius|font-family|background-color)\s*:/i.test(trimmed)
  ) {
    return 'css';
  }

  // 3. Python detection: palabras clave, definiciones o módulos estándar
  if (
    /^(?:import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_.]+\s+import|def\s+[a-zA-Z0-9_]+\s*\(|class\s+[a-zA-Z0-9_]+.*:|print\(|elif\s+|if\s+__name__\s*==)/m.test(
      trimmed
    ) ||
    /\b(?:np\.|plt\.|self\.|theta_deg|deg2rad)\b/.test(trimmed)
  ) {
    return 'python';
  }

  // 4. JavaScript / TypeScript detection
  if (
    /\b(?:const|let|var)\s+[a-zA-Z0-9_$]+\s*=|function\s+[a-zA-Z0-9_$]*\s*\(|console\.(?:log|error|warn)\(|=>\s*\{|\bexport\s+(?:default\s+)?(?:function|class|const)/.test(
      trimmed
    )
  ) {
    return 'javascript';
  }

  // 5. SQL detection
  if (
    /^\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(
      trimmed
    )
  ) {
    return 'sql';
  }

  // 6. JSON detection
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  // 7. Bash / Shell detection
  if (
    /^#!\/(?:usr\/)?bin\/(?:bash|sh|zsh)/.test(trimmed) ||
    /^(?:npm|pnpm|yarn|git|cd|mkdir|rm|apt-get|brew|docker|curl|chmod|sudo)\s+[^\n]+/m.test(trimmed)
  ) {
    return 'bash';
  }

  // 8. C / C++ detection
  if (
    /#include\s+[<"][a-zA-Z0-9_.]+[>"]|\b(?:std::cout|std::vector|int\s+main\s*\()/.test(trimmed)
  ) {
    return 'cpp';
  }

  return normalizedHint && normalizedHint !== 'code' ? normalizedHint : 'text';
}
