import locales, { DEFAULT_LOCALE } from './locales/index.js';

export const LOCALE_STORAGE_KEY = 'nanoglyph_locale';

let currentLocale = DEFAULT_LOCALE;
const listeners = new Set();

function canonicalLocale(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return Object.keys(locales).find(code => code.toLowerCase() === normalized) || null;
}

export function resolveLocale(savedLocale, languages) {
  if (arguments.length === 0) {
    let stored = null;
    try { stored = localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* unavailable */ }
    const browserLanguages = typeof navigator === 'undefined'
      ? []
      : (navigator.languages?.length ? navigator.languages : [navigator.language]);
    return resolveLocale(stored, browserLanguages);
  }
  const saved = canonicalLocale(savedLocale);
  if (saved) return saved;

  const requested = Array.isArray(languages) ? languages : [];
  for (const language of requested) {
    const exact = canonicalLocale(language);
    if (exact) return exact;
  }
  for (const language of requested) {
    if (typeof language !== 'string') continue;
    const base = language.trim().toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (base === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

export function t(key, params = {}) {
  const selected = locales[currentLocale]?.messages[key];
  const fallback = locales[DEFAULT_LOCALE].messages[key];
  const template = selected ?? fallback ?? key;
  return template.replace(/\{([^{}]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function translateDocument(root = globalThis.document) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  const attributes = [
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title'],
    ['data-i18n-content', 'content'],
    ['data-i18n-alt', 'alt'],
  ];
  attributes.forEach(([dataAttribute, attribute]) => {
    root.querySelectorAll(`[${dataAttribute}]`).forEach(element => {
      element.setAttribute(attribute, t(element.getAttribute(dataAttribute)));
    });
  });
  const browserDocument = globalThis.document;
  if (root === browserDocument || root.documentElement) {
    const doc = root === browserDocument ? browserDocument : root;
    doc.documentElement.lang = currentLocale;
    doc.querySelectorAll('[data-locale-select]').forEach(select => { select.value = currentLocale; });
    const manifest = doc.querySelector('link[rel="manifest"]');
    if (manifest) manifest.setAttribute('href', currentLocale === 'pt-BR' ? './manifest.pt-BR.json' : './manifest.json');
  }
}

export function setLocale(locale, { persist = true } = {}) {
  const resolved = canonicalLocale(locale);
  if (!resolved) return false;
  const changed = currentLocale !== resolved;
  currentLocale = resolved;
  if (persist) {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, resolved); } catch { /* unavailable */ }
  }
  if (typeof document !== 'undefined') translateDocument(document);
  if (changed) listeners.forEach(listener => listener(resolved));
  return true;
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeI18n({ savedLocale, languages, root } = {}) {
  const hasExplicitInputs = savedLocale !== undefined || languages !== undefined;
  const locale = hasExplicitInputs
    ? resolveLocale(savedLocale, languages)
    : resolveLocale();
  setLocale(locale, { persist: false });
  if (typeof document !== 'undefined') {
    const target = root || document;
    translateDocument(target);
    target.querySelectorAll('[data-locale-select]').forEach(select => {
      if (select.dataset.i18nBound === 'true') return;
      select.dataset.i18nBound = 'true';
      select.addEventListener('change', () => setLocale(select.value));
    });
  }
  return locale;
}

export { locales };
