import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import locales from '../locales/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

execFileSync(
  'wasm-pack',
  [
    'build',
    '--target',
    'web',
    '--release',
    '--out-dir',
    join(dist, 'nanoglyph_core', 'pkg'),
  ],
  {
    cwd: join(root, 'nanoglyph_core'),
    env: {
      ...process.env,
      RUSTFLAGS: [
        process.env.RUSTFLAGS,
        '-C',
        'target-feature=-bulk-memory,-nontrapping-fptoint',
      ].filter(Boolean).join(' '),
    },
    stdio: 'inherit',
  },
);

await build({
  entryPoints: [join(root, 'app.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'app.js'),
  define: {
    __NANOGLYPH_VERSION__: JSON.stringify(pkg.version),
  },
});

for (const file of ['index.html', 'style.css', 'wasm-worker.js']) {
  await cp(join(root, file), join(dist, file));
}

const manifestTemplate = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
for (const locale of Object.values(locales)) {
  const localizedManifest = {
    ...manifestTemplate,
    name: locale.messages['manifest.name'],
    description: locale.messages['manifest.description'],
    lang: locale.code,
  };
  const filename = locale.code === 'en' ? 'manifest.json' : `manifest.${locale.code}.json`;
  await writeFile(join(dist, filename), `${JSON.stringify(localizedManifest, null, 2)}\n`);
}

await cp(join(root, 'icons'), join(dist, 'icons'), { recursive: true });
await mkdir(join(dist, 'vendor'), { recursive: true });
await cp(
  join(root, 'vendor', 'heic-to-1.5.2.min.js'),
  join(dist, 'vendor', 'heic-to-1.5.2.min.js'),
);
await cp(
  join(root, 'vendor', 'heic-to-LICENSE.txt'),
  join(dist, 'vendor', 'heic-to-LICENSE.txt'),
);

const swSource = await readFile(join(root, 'sw.js'), 'utf8');
await writeFile(
  join(dist, 'sw.js'),
  swSource.replaceAll('__NANOGLYPH_VERSION__', pkg.version),
);

console.log(`NanoGlyph web bundle ${pkg.version} created in ${dist}`);
