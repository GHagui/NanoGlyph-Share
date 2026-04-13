# NanoGlyph TODO

## Phase 1: Project Setup
- [x] Initialize Git repository
- [x] Create TODO.md and progress.txt
- [x] Initialize Rust project (`nanoglyph_core`) with `wasm-pack` configuration
- [x] Set up `build.sh` script
- [x] Implement `NanoGlyphHeader` and `Flags` bitfield in Rust
- [x] Write unit tests for `NanoGlyphHeader` serialization/deserialization
- [x] Commit initial setup

## Phase 2: Binary Data Model (Rust)
- [x] Define structs for representing indexed pixel data
- [x] Define the core payload structure (Header + Pixel Data)

## Phase 3: Encoder Implementation (Rust/Wasm)
- [x] Image resizing logic (max 128x128)
- [x] Image quantization (8-color indexed palette, Bayer matrix dithering)
- [x] Compression pipeline (RLE on pixel data, Deflate on full payload)
- [x] Base62 encoding logic
- [x] Expose Wasm encoder function

## Phase 4: Frontend PWA Shell (JS/HTML)
- [x] Setup offline-first Service Worker
- [x] Create basic UI for image selection and Magic Link generation
- [x] Implement Web Share API integration
- [x] Setup Web App Manifest with proper PNG icons (192px + 512px)
- [x] Add `navigator.storage.persist()` for persistent storage
- [x] Add SEO meta description

## Phase 5: Decoder Logic (JS)
- [x] URL parsing logic to extract Base62 payload
- [x] Base62 decoding to binary byte array (via Wasm)
- [x] Decompression pipeline (Deflate -> RLE) (via Wasm)
- [x] Deserialization of header and pixel data (via Wasm)
- [x] Render decoded image to `<canvas>` using correct palette
- [x] Handle payload chunking (LocalStorage) — both encoder and decoder sides

## Phase 6: Advanced Features
- [x] Animation support (keyframe + delta compression for frames 2-5)
- [x] Encoder-side payload chunking (split at 3000 chars into `#/<idx>-<total>/<chunk>` links)
- [x] Chunk URL format matches spec: `#/1-2/CHUNK_1`, `#/2-2/CHUNK_2`

## Phase 7: Testing
- [x] Unit tests for NanoGlyphHeader serialization/deserialization (3 tests)
- [x] Unit tests for pixel packing/unpacking roundtrip (2 tests)
- [x] Unit tests for RLE encode/decode roundtrip (4 tests)
- [x] Unit tests for Base62 encode/decode roundtrip (3 tests)
