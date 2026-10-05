// Minimal static file server for trying the app locally (no dependencies).
//   node tools/serve.mjs            -> http://localhost:8000
//   node tools/serve.mjs 8080       -> http://localhost:8080
// Any static server works (e.g. `python -m http.server`); this one just gets
// the MIME types right on every platform and turns caching off.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    const status = err.code === 'EACCES' ? 403 : 404;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 403 ? 'Forbidden' : 'Not found');
  }
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`Port ${port} is already in use: the app may already be running at http://localhost:${port}/`);
  console.log(`To use another port: node tools/serve.mjs ${port === 8000 ? 8080 : port + 1}`);
  process.exit(1);
});

server.listen(port, 'localhost', () => {
  console.log(`Workshop app: http://localhost:${port}/  (facilitator: http://localhost:${port}/facilitator.html)`);
});
