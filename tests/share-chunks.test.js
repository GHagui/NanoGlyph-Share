import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectChunkPayload,
  MAX_NANOGLYPH_CHUNKS,
  MAX_NANOGLYPH_PAYLOAD_LENGTH,
  parseChunkMetadata,
  splitPayloadIntoChunks,
} from '../share-chunks.js';

const BASE_URL = 'https://ghagui.github.io/NanoGlyph-Share/';

test('splits and reconstructs payloads that need more than 256 parts', () => {
  const payload = 'A'.repeat(300_000);
  const chunks = splitPayloadIntoChunks(payload, BASE_URL, 1_000);

  assert.ok(chunks.length > 256);
  assert.equal(chunks.join(''), payload);
  chunks.forEach((chunk, index) => {
    const url = `${BASE_URL}#/${index + 1}-${chunks.length}/${chunk}`;
    assert.ok(url.length <= 1_000);
    assert.deepEqual(
      parseChunkMetadata(String(index + 1), String(chunks.length), chunk),
      { index: index + 1, total: chunks.length },
    );
  });
});

test('supports the full safe payload budget at the smallest platform limit', () => {
  const payload = 'Z'.repeat(MAX_NANOGLYPH_PAYLOAD_LENGTH);
  const chunks = splitPayloadIntoChunks(payload, BASE_URL, 1_000);
  const metadataDigits = String(chunks.length).length;
  const longestChunk = chunks.reduce(
    (maximum, chunk) => Math.max(maximum, chunk.length),
    0,
  );

  assert.ok(chunks.length <= MAX_NANOGLYPH_CHUNKS);
  assert.equal(chunks.join('').length, MAX_NANOGLYPH_PAYLOAD_LENGTH);
  assert.ok(BASE_URL.length + 4 + (metadataDigits * 2) + longestChunk <= 1_000);
});

test('rejects payloads and metadata outside the safety limits', () => {
  assert.throws(
    () => splitPayloadIntoChunks(
      'A'.repeat(MAX_NANOGLYPH_PAYLOAD_LENGTH + 1),
      BASE_URL,
      1_000,
    ),
    /8 MiB/,
  );
  assert.equal(
    parseChunkMetadata('1', String(MAX_NANOGLYPH_CHUNKS + 1), 'A'),
    null,
  );
  assert.equal(parseChunkMetadata('1x', '2', 'A'), null);
  assert.equal(parseChunkMetadata('2', '1', 'A'), null);
  assert.equal(parseChunkMetadata('1', '2', 'not-base62!'), null);
});

test('bounds aggregate chunk size while collecting', () => {
  const chunk = 'A'.repeat(Math.floor(MAX_NANOGLYPH_PAYLOAD_LENGTH / 2) + 1);
  assert.deepEqual(
    collectChunkPayload(2, () => chunk),
    { status: 'oversized' },
  );
  assert.deepEqual(
    collectChunkPayload(2, index => index === 1 ? 'A' : null),
    { status: 'missing' },
  );
  assert.deepEqual(
    collectChunkPayload(2, index => index === 1 ? 'ABC' : '123'),
    { status: 'complete', payload: 'ABC123' },
  );
});
