import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const host = option('--host', '0.0.0.0');
const port = Number(option('--port', '8081'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await stat(join(dist, 'nanoglyph_core', 'pkg', 'nanoglyph_core_bg.wasm')).catch(() => {
  throw new Error('The Wasm bundle is missing. Run `npm run build:web` once before `npm run dev`.');
});

const reloadClients = new Set();
let reloadTimer = null;
function reloadBrowsers() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const response of reloadClients) response.write('data: reload\n\n');
  }, 80);
}

const buildContext = await context({
  entryPoints: [join(root, 'app.js')],
  bundle: true,
  format: 'esm',
  sourcemap: 'inline',
  outfile: join(dist, 'app.js'),
  define: { __NANOGLYPH_VERSION__: JSON.stringify(pkg.version) },
  plugins: [{
    name: 'nanoglyph-live-reload',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length === 0) reloadBrowsers();
      });
    },
  }],
});
await buildContext.rebuild();
await buildContext.watch();

const staticFiles = ['index.html', 'style.css', 'wasm-worker.js'];
await Promise.all(staticFiles.map(async file => {
  await writeFile(join(dist, file), await readFile(join(root, file)));
}));

async function writeLocalizedManifests() {
  const stamp = Date.now();
  const [english, portuguese] = await Promise.all([
    import(`${pathToFileURL(join(root, 'locales', 'en.js')).href}?update=${stamp}`),
    import(`${pathToFileURL(join(root, 'locales', 'pt-BR.js')).href}?update=${stamp}`),
  ]);
  const template = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  for (const locale of [english, portuguese]) {
    const manifest = {
      ...template,
      name: locale.messages['manifest.name'],
      description: locale.messages['manifest.description'],
      lang: locale.code,
    };
    const filename = locale.code === 'en' ? 'manifest.json' : `manifest.${locale.code}.json`;
    await writeFile(join(dist, filename), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
await writeLocalizedManifests();

const watchers = [];
const staticRefreshTimers = new Map();
for (const file of staticFiles) {
  watchers.push(watch(join(root, file), () => {
    clearTimeout(staticRefreshTimers.get(file));
    staticRefreshTimers.set(file, setTimeout(async () => {
      try {
        await writeFile(join(dist, file), await readFile(join(root, file)));
        reloadBrowsers();
      } catch (error) {
        console.error(`Could not refresh ${file}:`, error);
      }
    }, 80));
  }));
}
let manifestRefreshTimer = null;
for (const file of ['manifest.json', 'locales/en.js', 'locales/pt-BR.js']) {
  watchers.push(watch(join(root, file), () => {
    clearTimeout(manifestRefreshTimer);
    manifestRefreshTimer = setTimeout(async () => {
      try {
        await writeLocalizedManifests();
        reloadBrowsers();
      } catch (error) {
        console.error('Could not refresh localized manifests:', error);
      }
    }, 80);
  }));
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};
const liveReloadScript = `<script>
(() => {
  const source = new EventSource('/__nanoglyph_reload');
  source.onmessage = () => location.reload();
})();
</script>`;

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/__nanoglyph_reload') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    reloadClients.add(response);
    request.on('close', () => reloadClients.delete(response));
    return;
  }

  // Avoid production cache interception while developing.
  if (pathname === '/sw.js') {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));");
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(dist, relativePath));
  if (!filePath.startsWith(`${dist}/`) && filePath !== join(dist, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    const finalPath = fileStat.isDirectory() ? join(filePath, 'index.html') : filePath;
    let body = await readFile(finalPath);
    if (extname(finalPath) === '.html') {
      body = Buffer.from(body.toString('utf8').replace('</body>', `${liveReloadScript}</body>`));
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(finalPath)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`NanoGlyph live reload server: http://${host}:${port}/`);
});

async function shutdown() {
  watchers.forEach(fileWatcher => fileWatcher.close());
  reloadClients.forEach(response => response.end());
  await buildContext.dispose();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
