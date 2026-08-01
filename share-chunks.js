export const MAX_NANOGLYPH_PAYLOAD_LENGTH = 8 * 1024 * 1024;

// An 8 MiB payload split for the smallest supported platform limit (1,000
// characters) needs fewer than 10,000 parts, including four-digit metadata.
export const MAX_NANOGLYPH_CHUNKS = 10_000;

const BASE62_PATTERN = /^[0-9A-Za-z]+$/;

export function parseChunkMetadata(indexText, totalText, chunkData) {
  if (
    !/^\d+$/.test(indexText)
    || !/^\d+$/.test(totalText)
    || !chunkData
    || chunkData.length > MAX_NANOGLYPH_PAYLOAD_LENGTH
    || !BASE62_PATTERN.test(chunkData)
  ) {
    return null;
  }

  const index = Number(indexText);
  const total = Number(totalText);
  if (
    !Number.isSafeInteger(index)
    || !Number.isSafeInteger(total)
    || index < 1
    || total < 1
    || index > total
    || total > MAX_NANOGLYPH_CHUNKS
  ) {
    return null;
  }

  return { index, total };
}

export function splitPayloadIntoChunks(payload, baseUrl, linkLimit) {
  if (!payload || !BASE62_PATTERN.test(payload)) {
    throw new TypeError('NanoGlyph payload must contain base62 data.');
  }
  if (payload.length > MAX_NANOGLYPH_PAYLOAD_LENGTH) {
    throw new RangeError('Encoded payload exceeds the 8 MiB NanoGlyph link limit.');
  }
  if (!Number.isSafeInteger(linkLimit) || linkLimit < 1) {
    throw new RangeError('Platform link limit must be a positive integer.');
  }

  let metadataDigits = 1;
  let chunkDataLimit;
  let total;

  while (true) {
    // `${baseUrl}#/${index}-${total}/${chunk}`:
    // "#/", "-", and "/" use four characters; index and total use up to
    // metadataDigits characters each.
    const urlOverhead = baseUrl.length + 4 + (metadataDigits * 2);
    chunkDataLimit = linkLimit - urlOverhead;
    if (chunkDataLimit < 1) {
      throw new RangeError('Platform link limit is too small for chunk metadata.');
    }

    total = Math.ceil(payload.length / chunkDataLimit);
    if (total > MAX_NANOGLYPH_CHUNKS) {
      throw new RangeError(`Encoded payload requires more than ${MAX_NANOGLYPH_CHUNKS} parts.`);
    }

    const requiredDigits = String(total).length;
    if (requiredDigits === metadataDigits) break;
    metadataDigits = requiredDigits;
  }

  const chunks = [];
  for (let offset = 0; offset < payload.length; offset += chunkDataLimit) {
    chunks.push(payload.substring(offset, offset + chunkDataLimit));
  }
  return chunks;
}

export function collectChunkPayload(total, getChunk) {
  const chunks = [];
  let payloadLength = 0;

  for (let index = 1; index <= total; index++) {
    const chunk = getChunk(index);
    if (!chunk) return { status: 'missing' };

    payloadLength += chunk.length;
    if (payloadLength > MAX_NANOGLYPH_PAYLOAD_LENGTH) {
      return { status: 'oversized' };
    }
    chunks.push(chunk);
  }

  return { status: 'complete', payload: chunks.join('') };
}
