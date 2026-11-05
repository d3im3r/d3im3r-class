import {existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {dataDirectory} from '@/features/administration/server/database';

export const runtime = 'nodejs';

const mimeTypes: Record<string, string> = {
 '.svg': 'image/svg+xml',
 '.png': 'image/png',
 '.jpg': 'image/jpeg',
 '.jpeg': 'image/jpeg',
 '.webp': 'image/webp',
 '.pdf': 'application/pdf',
 '.json': 'application/json',
};

export async function GET(
 request: Request,
 { params }: { params: Promise<{ path: string[] }> }
) {
 const { path: segments } = await params;
 if (!segments || !segments.length) {
  return new Response('Not Found', { status: 404 });
 }

 // Sanitize segments to prevent directory traversal
 const safeSegments = segments.filter(s => s && s !== '..' && s !== '.');
 const relativePath = safeSegments.join('/');
 const ext = path.extname(relativePath).toLowerCase();
 const mime = mimeTypes[ext] || 'application/octet-stream';
 const filename = safeSegments[safeSegments.length - 1];

 const cwd = process.cwd();
 const candidates = [
  path.join(cwd, 'public/assets', relativePath),
  path.join(cwd, 'content/materials/assets', relativePath),
  path.join(cwd, 'public/assets/diagrams', filename),
  path.join(cwd, 'public/assets/teaching', filename),
  path.join(cwd, 'content/materials/assets/diagrams', filename),
  path.join(cwd, 'content/materials/assets/teaching', filename),
  path.join(dataDirectory(), 'cache/diagrams', filename),
 ];

 let foundPath: string | null = null;
 for (const c of candidates) {
  if (existsSync(c)) {
   foundPath = c;
   break;
  }
 }

 if (!foundPath) {
  return new Response('Not Found', { status: 404 });
 }

 try {
  const info = await stat(foundPath);
  const etag = `"${filename}-${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
   'Content-Type': mime,
   'Content-Disposition': 'inline',
   'Cache-Control': 'public, max-age=31536000, immutable',
   'ETag': etag,
   'X-Content-Type-Options': 'nosniff',
  };

  if (request.headers.get('if-none-match') === etag) {
   return new Response(null, { status: 304, headers });
  }

  const bytes = await readFile(foundPath);
  return new Response(bytes, { headers });
 } catch {
  return new Response('Not Found', { status: 404 });
 }
}
