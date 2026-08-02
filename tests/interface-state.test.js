import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('image adjustments remain expanded in the static and runtime interface', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(html, /id="adjustments-toggle"[\s\S]*?aria-expanded="true"/);
  assert.match(html, /class="expandable-body open" id="adjustments-body" aria-hidden="false"/);
  assert.doesNotMatch(app, /adjustmentsToggle\.setAttribute\('aria-expanded', 'false'\)/);
  assert.doesNotMatch(app, /adjustmentsBody\.setAttribute\('aria-hidden', 'true'\)/);
});

test('adjustment previews use the next animation frame without a fixed delay', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /function schedulePreviewUpdate\(\)/);
  assert.match(app, /adjPreviewFrame = requestAnimationFrame/);
  assert.doesNotMatch(app, /adjDebounceTimer|debouncedPreviewUpdate/);
});
