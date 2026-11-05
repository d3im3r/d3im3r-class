export const palettes = [
  { id: 'default', label: 'Default' },
  { id: 'tweakcn', label: 'Invincible' },
  { id: 'clean-slate', label: 'Clean Slate' },
  { id: 'supabase', label: 'Supabase Emerald' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'claude', label: 'Claude Terracotta' },
  { id: 'interstellar', label: 'Interstellar Gold' },
  { id: 'cyberpunk', label: 'Cyberpunk Neon' },
] as const;
export type Palette = (typeof palettes)[number]['id'];
export function isPalette(value: unknown): value is Palette {
  return palettes.some((p) => p.id === value);
}
