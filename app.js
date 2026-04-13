import init, { encode_image_to_base62, encode_image_to_base62_with_palette, decode_base62_to_image, get_palette_colors, preview_image_with_palette } from './nanoglyph_core/pkg/nanoglyph_core.js';

// Clipboard helper with fallback for non-HTTPS contexts
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback: hidden textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve();
    } catch (err) {
        document.body.removeChild(ta);
        return Promise.reject(err);
    }
}

// Save a canvas as a PNG, upscaling it dynamically to ~2560px horizontal using nearest-neighbor
function saveCanvasAsUpscaledPng(sourceCanvas, filename, successCallback) {
    if (!sourceCanvas) return;

    // Target 2560px width, but ensure scale is an integer to keep pixels perfectly square
    const TARGET_WIDTH = 2560;
    const scale = Math.max(1, Math.round(TARGET_WIDTH / sourceCanvas.width));

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width * scale;
    exportCanvas.height = sourceCanvas.height * scale;

    const ctx = exportCanvas.getContext('2d');

    // Disable anti-aliasing to keep pixel art looking crisp
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;

    ctx.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

    exportCanvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (successCallback) successCallback();
    }, 'image/png');
}

let wasmInitialized = false;

// DOM Elements
const encoderView = document.getElementById('encoder-view');
const decoderView = document.getElementById('decoder-view');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const imagePreview = document.getElementById('image-preview');
const encodeBtn = document.getElementById('encode-btn');
const settingsContainer = document.getElementById('settings-container');
const qualitySelect = document.getElementById('quality-select');
const compressionContainer = document.getElementById('compression-container');
const compressionSelect = document.getElementById('compression-select');
const adjustmentsContainer = document.getElementById('adjustments-container');
const adjustmentsToggle = document.getElementById('adjustments-toggle');
const adjustmentsBody = document.getElementById('adjustments-body');
const adjustmentsBadge = document.getElementById('adjustments-badge');
const adjExposure = document.getElementById('adj-exposure');
const adjContrast = document.getElementById('adj-contrast');
const adjSaturation = document.getElementById('adj-saturation');
const adjHue = document.getElementById('adj-hue');
const adjTemperature = document.getElementById('adj-temperature');
const resultContainer = document.getElementById('result-container');
const urlBox = document.getElementById('url-box');
const shareBtn = document.getElementById('share-btn');
const copyBtn = document.getElementById('copy-btn');
const resetBtn = document.getElementById('reset-btn');
const decodedCanvas = document.getElementById('decoded-canvas');
const decoderStatus = document.getElementById('decoder-status');
const platformContainer = document.getElementById('platform-container');
const platformGrid = document.getElementById('platform-grid');
const paletteContainer = document.getElementById('palette-container');
const paletteSwatches = document.getElementById('palette-swatches');
const paletteIdDisplay = document.getElementById('palette-id-display');
const paletteModeLabel = document.getElementById('palette-mode-label');
const palettePrevBtn = document.getElementById('palette-prev');
const paletteNextBtn = document.getElementById('palette-next');
const chunkButtons = document.getElementById('chunk-buttons');
const savePngBtn = document.getElementById('save-png-btn');

let selectedFileBuffer = null;
let selectedPlatformLimit = 4096; // default: WhatsApp
let currentPaletteId = -1; // -1 = auto-detect
let paletteAutoMode = true;

// ── Image Adjustments ──────────────────────────────────────────────────────
const ADJ_DEFAULTS = { exposure: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0 };

// Returns current slider values
function getAdjustments() {
    return {
        exposure: parseInt(adjExposure.value, 10),
        contrast: parseInt(adjContrast.value, 10),
        saturation: parseInt(adjSaturation.value, 10),
        hue: parseInt(adjHue.value, 10),
        temperature: parseInt(adjTemperature.value, 10),
    };
}

// Returns true if any slider differs from default
function hasAdjustments(adj) {
    return Object.keys(ADJ_DEFAULTS).some(k => adj[k] !== ADJ_DEFAULTS[k]);
}

// Update the track gradient fill % for a slider
function updateSliderTrack(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', `${pct}%`);
}

// Sync display values + tracks + badge
function syncAdjustmentUI() {
    const adj = getAdjustments();
    document.getElementById('adj-exposure-val').textContent = adj.exposure > 0 ? `+${adj.exposure}` : adj.exposure;
    document.getElementById('adj-contrast-val').textContent = adj.contrast > 0 ? `+${adj.contrast}` : adj.contrast;
    document.getElementById('adj-saturation-val').textContent = adj.saturation > 0 ? `+${adj.saturation}` : adj.saturation;
    document.getElementById('adj-hue-val').textContent = `${adj.hue}°`;
    document.getElementById('adj-temperature-val').textContent = adj.temperature > 0 ? `+${adj.temperature}` : adj.temperature;

    [adjExposure, adjContrast, adjSaturation, adjHue, adjTemperature].forEach(updateSliderTrack);

    const active = hasAdjustments(adj);
    adjustmentsBadge.textContent = active ? 'Modified' : 'Default';
    adjustmentsBadge.classList.toggle('active', active);
}

// Returns the 5 adjustment values ready to pass to Wasm (UI range -100..100 → Rust -1..1, hue as-is)
function getAdjFloats() {
    const adj = getAdjustments();
    return [
        adj.exposure / 100,  // EV stops normalised
        adj.contrast / 100,
        adj.saturation / 100,
        adj.hue,                // degrees, Rust accepts -180..180
        adj.temperature / 100,
    ];
}

// Expand / collapse
adjustmentsToggle.addEventListener('click', () => {
    const expanded = adjustmentsToggle.getAttribute('aria-expanded') === 'true';
    adjustmentsToggle.setAttribute('aria-expanded', String(!expanded));
    adjustmentsBody.setAttribute('aria-hidden', String(expanded));
    adjustmentsBody.classList.toggle('open', !expanded);
});

// Individual slider live update
let adjDebounceTimer = null;

function debouncedPreviewUpdate() {
    if (adjDebounceTimer) clearTimeout(adjDebounceTimer);
    adjDebounceTimer = setTimeout(() => {
        if (selectedFileBuffer && wasmInitialized) {
            const effectiveId = currentPaletteId < 0 ? 0 : currentPaletteId;
            renderPalettePreview(effectiveId);
        }
    }, 125);
}

[adjExposure, adjContrast, adjSaturation, adjHue, adjTemperature].forEach(slider => {
    slider.addEventListener('input', () => {
        syncAdjustmentUI(); // Update UI instantly
        debouncedPreviewUpdate(); // Delay expensive Wasm computation
    });
});

// Per-slider reset buttons
document.querySelectorAll('.adj-reset').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) {
            target.value = 0;
            syncAdjustmentUI();
            debouncedPreviewUpdate();
        }
    });
});

// Reset all
document.getElementById('adj-reset-all').addEventListener('click', () => {
    [adjExposure, adjContrast, adjSaturation, adjHue, adjTemperature].forEach(s => s.value = 0);
    syncAdjustmentUI();
    debouncedPreviewUpdate();
});

// Platform selection logic
platformGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.platform-btn');
    if (!btn) return;
    platformGrid.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedPlatformLimit = parseInt(btn.dataset.limit, 10);
});

// Palette rendering
function renderPaletteSwatches(id) {
    paletteSwatches.innerHTML = '';
    const colors = get_palette_colors(id);
    for (let i = 0; i < 8; i++) {
        const div = document.createElement('div');
        div.className = 'palette-swatch';
        div.style.backgroundColor = `rgb(${colors[i * 3]}, ${colors[i * 3 + 1]}, ${colors[i * 3 + 2]})`;
        paletteSwatches.appendChild(div);
    }
}

// Real-time palette preview on the image
// Adjustments are passed as floats directly to Wasm — no JS canvas roundtrip
function renderPalettePreview(paletteId) {
    if (!selectedFileBuffer || !wasmInitialized) return;
    try {
        const maxDim = parseInt(qualitySelect.value, 10);
        const [exp, con, sat, hue, tmp] = getAdjFloats();
        const preview = preview_image_with_palette(selectedFileBuffer, maxDim, paletteId, exp, con, sat, hue, tmp);
        const rgba = preview.get_rgba();
        const w = preview.width;
        const h = preview.height;

        // Replace the image preview with a canvas showing the dithered result
        let previewCanvas = document.getElementById('palette-preview-canvas');
        if (!previewCanvas) {
            previewCanvas = document.createElement('canvas');
            previewCanvas.id = 'palette-preview-canvas';
        }
        previewCanvas.width = w;
        previewCanvas.height = h;
        const ctx = previewCanvas.getContext('2d');
        const imageData = new ImageData(new Uint8ClampedArray(rgba), w, h);
        ctx.putImageData(imageData, 0, 0);

        // Show canvas, hide original img
        imagePreview.style.display = 'none';
        if (!previewCanvas.parentElement) {
            previewContainer.appendChild(previewCanvas);
        }
        previewCanvas.style.display = 'block';

        preview.free();
    } catch (e) {
        console.error('Preview error:', e);
    }
}

function updatePaletteUI() {
    const effectiveId = currentPaletteId < 0 ? 0 : currentPaletteId;
    if (paletteAutoMode) {
        paletteIdDisplay.textContent = 'Auto-detect';
        paletteModeLabel.textContent = 'Auto — best match';
    } else {
        paletteIdDisplay.textContent = `Palette #${currentPaletteId}`;
        paletteModeLabel.textContent = `Manual — ${currentPaletteId}/98`;
    }
    // Always render dithered preview when image is loaded
    if (selectedFileBuffer && wasmInitialized) {
        renderPalettePreview(effectiveId);
    }
    paletteSwatches.classList.add('active');
    renderPaletteSwatches(effectiveId);
}

palettePrevBtn.addEventListener('click', () => {
    paletteAutoMode = false;
    if (currentPaletteId <= 0) currentPaletteId = 98;
    else currentPaletteId--;
    updatePaletteUI();
});

paletteNextBtn.addEventListener('click', () => {
    paletteAutoMode = false;
    if (currentPaletteId >= 98) currentPaletteId = 0;
    else currentPaletteId++;
    updatePaletteUI();
});

// Double-click swatches to toggle auto
paletteSwatches.addEventListener('dblclick', () => {
    paletteAutoMode = true;
    currentPaletteId = -1;
    updatePaletteUI();
});

const warningHigh = document.getElementById('warning-high');
const warningZen = document.getElementById('warning-zen');
const warningCosmic = document.getElementById('warning-cosmic');
const savePreviewBtn = document.getElementById('save-preview-btn');

// Re-render preview when quality/max-size changes
qualitySelect.addEventListener('change', () => {
    const val = parseInt(qualitySelect.value, 10);

    // Hide all warnings by default
    if (warningHigh) warningHigh.classList.add('hidden');
    if (warningZen) warningZen.classList.add('hidden');
    if (warningCosmic) warningCosmic.classList.add('hidden');

    // Show appropriate warning
    if (val === 2048) {
        if (warningCosmic) warningCosmic.classList.remove('hidden');
    } else if (val === 1024) {
        if (warningZen) warningZen.classList.remove('hidden');
    } else if (val >= 256) {
        if (warningHigh) warningHigh.classList.remove('hidden');
    }

    if (selectedFileBuffer && wasmInitialized) {
        const effectiveId = currentPaletteId < 0 ? 0 : currentPaletteId;
        renderPalettePreview(effectiveId);
    }
});

// Save the dithered preview canvas as PNG (without sharing)
savePreviewBtn.addEventListener('click', () => {
    const previewCanvas = document.getElementById('palette-preview-canvas');
    saveCanvasAsUpscaledPng(previewCanvas, 'nanoglyph-preview.png', () => {
        savePreviewBtn.textContent = '✅ Saved!';
        setTimeout(() => { savePreviewBtn.textContent = '💾 Save as PNG'; }, 2000);
    });
});

async function bootstrap() {
    try {
        await init();
        wasmInitialized = true;
        console.log("Wasm initialized.");

        // Request persistent storage as specified
        if (navigator.storage && navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            console.log(`Persistent storage ${granted ? 'granted' : 'denied'}.`);
        }

        checkHash();
    } catch (e) {
        console.error("Failed to initialize Wasm:", e);
    }
}

function checkHash() {
    if (window.location.hash.length > 1) {
        const hash = window.location.hash.substring(1);

        // Skip empty or slash-only hashes
        if (!hash || hash === '/' || hash.length < 2) {
            encoderView.classList.remove('hidden');
            decoderView.classList.add('hidden');
            return;
        }

        encoderView.classList.add('hidden');
        decoderView.classList.remove('hidden');

        if (!wasmInitialized) {
            decoderStatus.textContent = "Loading decoder...";
            return;
        }

        // Handle chunked links: format is /<index>-<total>/<chunk_data>
        if (hash.startsWith('/')) {
            const withoutLeadingSlash = hash.substring(1);
            const slashIdx = withoutLeadingSlash.indexOf('/');
            if (slashIdx !== -1) {
                const meta = withoutLeadingSlash.substring(0, slashIdx).split('-');
                if (meta.length === 2) {
                    const index = parseInt(meta[0]);
                    const total = parseInt(meta[1]);
                    const chunkData = withoutLeadingSlash.substring(slashIdx + 1);

                    if (isNaN(index) || isNaN(total) || !chunkData) {
                        decoderStatus.textContent = "Invalid link format.";
                        return;
                    }

                    localStorage.setItem(`ng_chunk_${index}_${total}`, chunkData);

                    // Check if we have all chunks
                    let allChunks = '';
                    let missing = false;
                    for (let i = 1; i <= total; i++) {
                        const c = localStorage.getItem(`ng_chunk_${i}_${total}`);
                        if (!c) {
                            missing = true;
                            break;
                        }
                        allChunks += c;
                    }

                    if (missing) {
                        decoderStatus.textContent = `Received part ${index} of ${total}. Waiting for other parts...`;
                        decodedCanvas.classList.add('hidden');
                        return;
                    } else {
                        decoderStatus.textContent = "All parts received! Decoding...";
                        for (let i = 1; i <= total; i++) {
                            localStorage.removeItem(`ng_chunk_${i}_${total}`);
                        }
                        decodeAndRender(allChunks);
                        return;
                    }
                }
            }
        }

        // Single payload
        decoderStatus.textContent = "Decoding...";
        decodeAndRender(hash);
    } else {
        encoderView.classList.remove('hidden');
        decoderView.classList.add('hidden');
    }
}

function decodeAndRender(base62Str) {
    try {
        const decoded = decode_base62_to_image(base62Str);

        const rgba = decoded.get_rgba();
        const width = decoded.width;
        const height = decoded.height;
        const frameCount = decoded.frame_count;

        if (!width || !height || width === 0 || height === 0) {
            decoded.free();
            decoderStatus.textContent = "Invalid image data (zero dimensions).";
            decoderStatus.classList.remove('hidden');
            return;
        }

        decodedCanvas.width = width;
        decodedCanvas.height = height;
        decodedCanvas.classList.remove('hidden');

        const ctx = decodedCanvas.getContext('2d');
        const frameSize = width * height * 4;

        if (window.animationInterval) {
            clearInterval(window.animationInterval);
        }

        if (frameCount > 1) {
            let currentFrame = 0;
            const drawFrame = () => {
                const offset = currentFrame * frameSize;
                const frameRgba = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset + offset, frameSize);
                const imageData = new ImageData(frameRgba, width, height);
                ctx.putImageData(imageData, 0, 0);
                currentFrame = (currentFrame + 1) % frameCount;
            };
            drawFrame();
            window.animationInterval = setInterval(drawFrame, 200);
        } else {
            const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
            ctx.putImageData(imageData, 0, 0);
        }

        decoderStatus.classList.add('hidden');
        savePngBtn.classList.remove('hidden');
        decoded.free();
    } catch (e) {
        console.error("Failed to decode:", e);
        decoderStatus.textContent = "Failed to decode image: " + e;
        decoderStatus.classList.remove('hidden');
    }
}

// Save decoded image as PNG
savePngBtn.addEventListener('click', () => {
    saveCanvasAsUpscaledPng(decodedCanvas, 'nanoglyph-image.png', () => {
        savePngBtn.textContent = '✅ Saved!';
        setTimeout(() => { savePngBtn.textContent = '💾 Save as PNG'; }, 2000);
    });
});

window.addEventListener('hashchange', checkHash);

// File Selection Logic
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// Check if file is HEIF/HEIC format (not supported by Rust image crate)
function isHeifFormat(file) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return type === 'image/heif' || type === 'image/heic' ||
        name.endsWith('.heif') || name.endsWith('.heic');
}

// Convert image file to PNG via canvas (for formats Wasm can't decode directly)
function convertToPngBuffer(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob((blob) => {
                if (!blob) { reject(new Error('Canvas conversion failed')); return; }
                blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
            }, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Browser cannot decode this image format. Try converting to JPEG/PNG first.'));
        };
        img.src = url;
    });
}

function handleFile(file) {
    if (!file.type.startsWith('image/') && !isHeifFormat(file)) {
        alert("Please select an image file.");
        return;
    }

    const needsConversion = isHeifFormat(file);

    // Show UI immediately
    const dataUrlReader = new FileReader();
    dataUrlReader.onload = (e) => {
        imagePreview.src = e.target.result;
        previewContainer.classList.remove('hidden');
        settingsContainer.classList.remove('hidden');
        compressionContainer.classList.remove('hidden');
        adjustmentsContainer.classList.remove('hidden');
        platformContainer.classList.remove('hidden');
        paletteContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        savePreviewBtn.classList.remove('hidden');
        syncAdjustmentUI();
        encodeBtn.disabled = !wasmInitialized;
        if (wasmInitialized) {
            updatePaletteUI();
        }
    };
    dataUrlReader.readAsDataURL(file);

    if (needsConversion) {
        // HEIF/HEIC: convert via canvas to PNG buffer
        convertToPngBuffer(file).then(pngBuffer => {
            selectedFileBuffer = pngBuffer;
            if (wasmInitialized) {
                const effectiveId = currentPaletteId < 0 ? 0 : currentPaletteId;
                renderPalettePreview(effectiveId);
            }
        }).catch(err => {
            alert(err.message);
        });
    } else {
        // Standard format: read directly
        const arrayBufferReader = new FileReader();
        arrayBufferReader.onload = (e) => {
            selectedFileBuffer = new Uint8Array(e.target.result);
            if (wasmInitialized) {
                const effectiveId = currentPaletteId < 0 ? 0 : currentPaletteId;
                renderPalettePreview(effectiveId);
            }
        };
        arrayBufferReader.readAsArrayBuffer(file);
    }
}

const DEFAULT_CHUNK_CHAR_LIMIT = 3000;
const BROWSER_URL_MAX = 32779; // Chrome's max URL length

function getChunkLimit() {
    return selectedPlatformLimit || DEFAULT_CHUNK_CHAR_LIMIT;
}

// Encoding Logic
encodeBtn.addEventListener('click', () => {
    if (!selectedFileBuffer) return;

    try {
        encodeBtn.disabled = true;
        encodeBtn.textContent = 'Encoding...';

        const maxDimension = parseInt(qualitySelect.value, 10);
        const useBrotli = compressionSelect.value === 'brotli';

        // Get adjustment values (floats)
        const [exp, con, sat, hue, tmp] = getAdjFloats();

        // Encode directly with Wasm, passing the adjustment values
        const base62Str = paletteAutoMode
            ? encode_image_to_base62(selectedFileBuffer, maxDimension, useBrotli, exp, con, sat, hue, tmp)
            : encode_image_to_base62_with_palette(selectedFileBuffer, maxDimension, currentPaletteId, useBrotli, exp, con, sat, hue, tmp);

        const baseUrl = window.location.origin + window.location.pathname;
        const platformLimit = Math.min(getChunkLimit(), BROWSER_URL_MAX);
        // Reserve chars for URL overhead: baseUrl + "#/99-99/" (worst-case chunk prefix = 8 chars)
        const urlOverhead = baseUrl.length + 8;
        const chunkDataLimit = platformLimit - urlOverhead;
        // For single links the overhead is just baseUrl + "#" (1 char less)
        const singleUrlOverhead = baseUrl.length + 1;

        if (base62Str.length + singleUrlOverhead <= platformLimit) {
            // Single link — fits within the limit
            const url = baseUrl + '#' + base62Str;
            urlBox.innerHTML = '';
            urlBox.textContent = url;
            chunkButtons.innerHTML = '';
            // Show normal share/copy buttons
            shareBtn.classList.remove('hidden');
            copyBtn.classList.remove('hidden');
            resultContainer.classList.remove('hidden');
        } else {
            // Payload exceeds limit — split into chunks
            const chunks = [];
            for (let i = 0; i < base62Str.length; i += chunkDataLimit) {
                chunks.push(base62Str.substring(i, i + chunkDataLimit));
            }
            const total = chunks.length;

            // URL box shows the full unbroken payload
            urlBox.innerHTML = '';
            const fullUrl = baseUrl + '#' + base62Str;
            urlBox.textContent = fullUrl;

            // Hide default share/copy, show per-chunk buttons
            shareBtn.classList.add('hidden');
            copyBtn.classList.add('hidden');

            chunkButtons.innerHTML = '';
            const info = document.createElement('p');
            info.style.color = 'var(--secondary-color)';
            info.style.fontSize = '0.85rem';
            info.style.marginBottom = '0.25rem';
            info.textContent = `Split into ${total} parts for sharing:`;
            chunkButtons.appendChild(info);

            const list = document.createElement('div');
            list.className = 'chunk-buttons-list';

            chunks.forEach((chunk, idx) => {
                const chunkUrl = `${baseUrl}#/${idx + 1}-${total}/${chunk}`;

                const row = document.createElement('div');
                row.className = 'chunk-btn-row';

                const shareChunkBtn = document.createElement('button');
                shareChunkBtn.className = 'btn secondary';
                shareChunkBtn.textContent = `Share Part ${idx + 1}`;
                shareChunkBtn.addEventListener('click', async () => {
                    const data = { url: chunkUrl };
                    if (navigator.share) {
                        try { await navigator.share(data); } catch (e) { console.log(e); }
                    } else {
                        copyToClipboard(chunkUrl).then(() => {
                            shareChunkBtn.textContent = 'Copied!';
                            setTimeout(() => { shareChunkBtn.textContent = `Share Part ${idx + 1}`; }, 1500);
                        });
                    }
                });
                row.appendChild(shareChunkBtn);

                const copyChunkBtn = document.createElement('button');
                copyChunkBtn.className = 'btn outline';
                copyChunkBtn.textContent = `Copy Part ${idx + 1}`;
                copyChunkBtn.addEventListener('click', () => {
                    copyToClipboard(chunkUrl).then(() => {
                        copyChunkBtn.textContent = 'Copied!';
                        setTimeout(() => { copyChunkBtn.textContent = `Copy Part ${idx + 1}`; }, 1500);
                    });
                });
                row.appendChild(copyChunkBtn);

                list.appendChild(row);
            });

            chunkButtons.appendChild(list);
            resultContainer.classList.remove('hidden');
        }

    } catch (e) {
        console.error("Encoding error:", e);
        alert("Failed to encode image. See console.");
    } finally {
        encodeBtn.disabled = false;
        encodeBtn.textContent = 'Generate Magic Link';
    }
});

// Share and Copy Logic
shareBtn.addEventListener('click', async () => {
    // For chunked payloads, share only the first chunk link; for single, share the full URL
    const firstUrl = urlBox.querySelector('div')
        ? urlBox.querySelector('div div')?.textContent || urlBox.textContent
        : urlBox.textContent;

    const shareData = { url: firstUrl };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
        } catch (e) {
            console.log('Share canceled or failed', e);
        }
    } else {
        // Fallback: copy URL to clipboard
        copyToClipboard(firstUrl).then(() => {
            shareBtn.textContent = 'Link Copied!';
            setTimeout(() => { shareBtn.textContent = 'Share Link'; }, 2000);
        }).catch(() => {
            // Last resort: prompt with the URL
            prompt('Copy this link:', firstUrl);
        });
    }
});

copyBtn.addEventListener('click', () => {
    copyToClipboard(urlBox.textContent)
        .then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
        })
        .catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Failed to copy link.");
        });
});

resetBtn.addEventListener('click', () => {
    window.location.hash = '';
});

// Clear cache & data
document.getElementById('clear-cache-btn').addEventListener('click', async () => {
    const confirmed = confirm('Clear all cached data and force a fresh reload?\n\nThis will remove the offline cache and any stored image chunks.');
    if (!confirmed) return;

    try {
        // 1. Delete all Cache Storage entries (Service Worker cache)
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        // 2. Clear localStorage (chunk fragments)
        localStorage.clear();

        // 3. Unregister all Service Workers so fresh one installs on reload
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
        }

        // 4. Hard reload (bypasses browser cache)
        window.location.reload(true);
    } catch (e) {
        console.error('Clear cache failed:', e);
        alert('Failed to clear cache: ' + e.message);
    }
});

// Initialize
bootstrap();
