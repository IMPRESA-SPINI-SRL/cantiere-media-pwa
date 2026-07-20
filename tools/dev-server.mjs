import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Permissions-Policy': 'web-share=(self)',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relativePath) relativePath = 'index.html';
    let absolutePath = resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
      send(response, 403, 'Forbidden');
      return;
    }

    const information = await stat(absolutePath);
    if (information.isDirectory()) absolutePath = resolve(absolutePath, 'index.html');
    const data = await readFile(absolutePath);
    const headers = {
      'Content-Type': mimeTypes[extname(absolutePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': absolutePath.endsWith('service-worker.js') ? 'no-cache' : 'no-cache',
      'Permissions-Policy': 'web-share=(self)',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
    };
    response.writeHead(200, headers);
    response.end(data);
  } catch (error) {
    send(response, error?.code === 'ENOENT' ? 404 : 500, error?.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Cantiere Media: http://127.0.0.1:${port}`);
});
