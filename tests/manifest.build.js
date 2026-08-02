import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import locales from '../locales/index.js';

test('build generates localized manifests and caches both for offline use', async () => {
  const english = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  const portuguese = JSON.parse(await readFile(new URL('../dist/manifest.pt-BR.json', import.meta.url), 'utf8'));
  const serviceWorker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');

  assert.equal(english.lang, 'en');
  assert.equal(english.name, locales.en.messages['manifest.name']);
  assert.equal(english.description, locales.en.messages['manifest.description']);
  assert.equal(portuguese.lang, 'pt-BR');
  assert.equal(portuguese.name, locales['pt-BR'].messages['manifest.name']);
  assert.equal(portuguese.description, locales['pt-BR'].messages['manifest.description']);
  assert.match(serviceWorker, /manifest\.json/);
  assert.match(serviceWorker, /manifest\.pt-BR\.json/);
});
