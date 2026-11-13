// Minimal static file server used by the Playwright tests.
//
// It deliberately behaves like VS Code Live Server / GitHub Pages: files are served
// as-is (no TypeScript compilation), with the repository root as the server root. A page
// that only works under a dev-server (e.g. one loading "/src/main.ts", which only Vite
// could compile) therefore fails the tests.
//
// Usage: node scripts/static-server.mjs [--port 5199]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const PREFIX = '/';
const portFlag = process.argv.indexOf('--port');
const PORT = portFlag > -1 ? Number(process.argv[portFlag + 1]) : 5199;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (!pathname.startsWith(PREFIX)) return send(res, 404, 'Not found');

  let file = resolve(ROOT, '.' + decodeURIComponent(pathname.slice(PREFIX.length - 1)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}${PREFIX}`);
});
