import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { MAXIMUM_BROTLI_COMPRESSION_MODE, NanoGlyphEngine } from '../engine-client.js';

test('new links always use maximum Brotli and expose no compression control', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.equal(MAXIMUM_BROTLI_COMPRESSION_MODE, 2);
  assert.doesNotMatch(html, /compression-(?:container|select)/);
  assert.doesNotMatch(app, /compressionSelect|compressionContainer/);
});

test('engine overrides caller compression choices with maximum Brotli', async () => {
  const messages = [];
  globalThis.Worker = class {
    addEventListener(type, listener) {
      if (type === 'message') this.messageListener = listener;
    }

    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.messageListener({
        data: { id: message.id, ok: true, result: {} },
      }));
    }
  };

  const engine = new NanoGlyphEngine();
  await engine.ready;
  await engine.encode({ compressionMode: 0, maxDimension: 128 });

  assert.equal(messages.at(-1).operation, 'encode');
  assert.equal(messages.at(-1).payload.compressionMode, MAXIMUM_BROTLI_COMPRESSION_MODE);
  delete globalThis.Worker;
});
