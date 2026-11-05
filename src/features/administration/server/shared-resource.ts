import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDirectory } from './database';
export type StoredResource = { key: string; name: string; path: string; mime: string };
export function sharedImage(name: string): StoredResource | null {
  const base = path.basename(name.replace(/\\/g, '/')).toLowerCase();
  const folders = [
    path.join(process.cwd(), 'public/assets/teaching'),
    path.join(process.cwd(), 'content/materials/assets/teaching'),
  ];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    const match = readdirSync(folder).find(
      (file) => file.toLowerCase() === base && /\.(png|jpe?g|webp)$/i.test(file)
    );
    if (match) {
      const extension = path.extname(match).toLowerCase(),
        key = createHash('sha256').update(`shared:${match}`).digest('hex').slice(0, 24);
      return {
        key,
        name: match,
        path: path.join(folder, match),
        mime:
          extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg',
      };
    }
  }
  return null;
}
function isValidDiagramFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const content = readFileSync(filePath, 'utf8');
    if (!content || content.length < 50) return false;
    // TikZJax SVGs contain <text tags with un-embedded TeX fonts, which fail inside <img>
    if (content.includes('<text ') || content.includes('<text>')) return false;
    return true;
  } catch {
    return false;
  }
}
export function cachedDiagramPath(hash: string): string | null {
  const inPublic = path.join(process.cwd(), 'public/assets/diagrams', `${hash}.svg`);
  if (isValidDiagramFile(inPublic)) return inPublic;
  const precompiled = path.join(process.cwd(), 'content/materials/assets/diagrams', `${hash}.svg`);
  if (isValidDiagramFile(precompiled)) return precompiled;
  const cached = path.join(dataDirectory(), 'cache/diagrams', `${hash}.svg`);
  if (isValidDiagramFile(cached)) return cached;
  return null;
}
export function cacheDiagram(hash: string, sourcePath: string): string {
  try {
    const dir = path.join(dataDirectory(), 'cache/diagrams');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, `${hash}.svg`);
    if (path.resolve(sourcePath) !== path.resolve(dest)) copyFileSync(sourcePath, dest);
    return dest;
  } catch {
    return sourcePath;
  }
}
