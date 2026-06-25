import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const rootArg = process.argv[2];
const portArg = process.argv[3];

if (!rootArg || !portArg) {
  console.error('Usage: node scripts/local-static-server.mjs <rootDir> <port>');
  process.exit(1);
}

const rootDir = path.resolve(rootArg);
const port = Number.parseInt(portArg, 10);

if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
  console.error(`Root directory does not exist: ${rootDir}`);
  process.exit(1);
}

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port: ${portArg}`);
  process.exit(1);
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.pdf', 'application/pdf'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function sendFile(res, filePath, statusCode = 200) {
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = statusCode;
  res.setHeader('Content-Type', mimeTypes.get(ext) || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

function resolveRequestPath(urlPath) {
  const safePath = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(safePath).replace(/^([/\\])+/, '');
  const candidate = path.resolve(rootDir, normalized);

  if (!candidate.startsWith(rootDir)) {
    return null;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const indexFile = path.join(candidate, 'index.html');
    if (fs.existsSync(indexFile)) {
      return indexFile;
    }
  }

  const htmlFile = `${candidate}.html`;
  if (fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
    return htmlFile;
  }

  const nestedIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(nestedIndex) && fs.statSync(nestedIndex).isFile()) {
    return nestedIndex;
  }

  return null;
}

const server = http.createServer((req, res) => {
  const targetFile = resolveRequestPath(req.url || '/');
  if (targetFile) {
    sendFile(res, targetFile);
    return;
  }

  const fallback404 = path.join(rootDir, '404.html');
  if (fs.existsSync(fallback404)) {
    sendFile(res, fallback404, 404);
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${rootDir} at http://127.0.0.1:${port}`);
});

