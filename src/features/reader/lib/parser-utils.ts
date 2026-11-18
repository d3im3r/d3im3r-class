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
