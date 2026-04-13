#!/bin/bash
set -e

echo "Building NanoGlyph Core WebAssembly module..."
cd nanoglyph_core
wasm-pack build --target web

echo "Build complete."