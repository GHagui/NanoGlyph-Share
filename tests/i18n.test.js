import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getLocale,
  initializeI18n,
  LOCALE_STORAGE_KEY,
  onLocaleChange,
  resolveLocale,
  setLocale,
  t,
} from '../i18n.js';
import locales from '../locales/index.js';

const placeholders = value => [...value.matchAll(/\{([^{}]+)\}/g)]
  .map(match => match[1])
  .sort();

test('resolves a saved locale before exact and base browser matches', () => {
  assert.equal(resolveLocale('en', ['pt-BR']), 'en');
  assert.equal(resolveLocale(null, ['pt-BR', 'en-US']), 'pt-BR');
  assert.equal(resolveLocale(null, ['pt-PT']), 'pt-BR');
  assert.equal(resolveLocale('invalid', ['en-GB']), 'en');
  assert.equal(resolveLocale('invalid', ['fr-FR']), 'en');
});

test('persists only explicit locale changes', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  initializeI18n({ languages: ['pt-PT'] });
  assert.equal(getLocale(), 'pt-BR');
  assert.equal(values.has(LOCALE_STORAGE_KEY), false);

  assert.equal(setLocale('en'), true);
  assert.equal(values.get(LOCALE_STORAGE_KEY), 'en');
  assert.equal(setLocale('not-a-locale'), false);
  assert.equal(getLocale(), 'en');
  delete globalThis.localStorage;
});

test('catalogs have identical keys and placeholders', () => {
  const reference = Object.keys(locales.en.messages).sort();
  for (const locale of Object.values(locales)) {
    assert.deepEqual(Object.keys(locale.messages).sort(), reference, `${locale.code} keys`);
    for (const key of reference) {
      assert.deepEqual(
        placeholders(locale.messages[key]),
        placeholders(locales.en.messages[key]),
        `${locale.code}:${key} placeholders`,
      );
    }
  }
});

test('interpolates parameters and falls back to English', () => {
  setLocale('pt-BR', { persist: false });
  assert.equal(t('decoder.waiting', { index: 2, total: 3 }), 'Parte 2 de 3 recebida. Aguardando as outras partes…');
  delete locales['pt-BR'].messages.__fallback_test;
  locales.en.messages.__fallback_test = 'Fallback {value}';
  assert.equal(t('__fallback_test', { value: 7 }), 'Fallback 7');
  delete locales.en.messages.__fallback_test;
});

test('translates document text and attributes during a runtime change', () => {
  const text = { dataset: { i18n: 'encoder.title' }, textContent: '' };
  const description = {
    getAttribute: attribute => attribute === 'data-i18n-content' ? 'meta.description' : null,
    setAttribute: (attribute, value) => { description[attribute] = value; },
  };
  const select = { value: '', dataset: {}, addEventListener() {} };
  const manifest = { setAttribute: (attribute, value) => { manifest[attribute] = value; } };
  const fakeDocument = {
    documentElement: { lang: '' },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [text];
      if (selector === '[data-i18n-content]') return [description];
      if (selector === '[data-locale-select]') return [select];
      return [];
    },
    querySelector: selector => selector === 'link[rel="manifest"]' ? manifest : null,
  };
  globalThis.document = fakeDocument;

  setLocale('en', { persist: false });
  let changedTo = null;
  const unsubscribe = onLocaleChange(locale => { changedTo = locale; });
  setLocale('pt-BR', { persist: false });

  assert.equal(fakeDocument.documentElement.lang, 'pt-BR');
  assert.equal(text.textContent, locales['pt-BR'].messages['encoder.title']);
  assert.match(description.content, /^O NanoGlyph transforma/);
  assert.equal(select.value, 'pt-BR');
  assert.equal(manifest.href, './manifest.pt-BR.json');
  assert.equal(changedTo, 'pt-BR');

  unsubscribe();
  delete globalThis.document;
});

test('every translation key referenced by HTML attributes exists', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-aria-label|-title|-content|-alt)?="([^"]+)"/g)]
    .map(match => match[1]);
  assert.ok(keys.length > 0);
  keys.forEach(key => assert.ok(key in locales.en.messages, key));
});
