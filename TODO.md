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
- [ ] Define structs for representing indexed pixel data
- [ ] Define the core payload structure (Header + Pixel Data)

## Phase 3: Encoder Implementation (Rust/Wasm)
- [ ] Image resizing logic (max 128x128)
- [ ] Image quantization (8-color indexed palette, Bayer matrix dithering)
- [ ] Compression pipeline (RLE on pixel data, Deflate on full payload)
- [ ] Base62 encoding logic
- [ ] Expose Wasm encoder function

## Phase 4: Frontend PWA Shell (JS/HTML)
- [ ] Setup offline-first Service Worker
- [ ] Create basic UI for image selection and Magic Link generation
- [ ] Implement Web Share API integration
- [ ] Setup Web App Manifest

## Phase 5: Decoder Logic (JS)
- [ ] URL parsing logic to extract Base62 payload
- [ ] Base62 decoding to binary byte array
- [ ] Decompression pipeline (Deflate -> RLE)
- [ ] Deserialization of header and pixel data
- [ ] Render decoded image to `<canvas>` using correct palette
- [ ] Handle payload chunking (IndexedDB/LocalStorage)

## Phase 6: Advanced Features
- [ ] Animation support (keyframe + delta compression for frames 2-5)
