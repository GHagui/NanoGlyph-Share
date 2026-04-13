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

let selectedFileBuffer = null;
let selectedPlatformLimit = 65536; // default: WhatsApp
let currentPaletteId = -1; // -1 = auto-detect
let paletteAutoMode = true;

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
        div.style.backgroundColor = `rgb(${colors[i*3]}, ${colors[i*3+1]}, ${colors[i*3+2]})`;
        paletteSwatches.appendChild(div);
    }
}

// Real-time palette preview on the image
function renderPalettePreview(paletteId) {
    if (!selectedFileBuffer || !wasmInitialized) return;
    try {
        const maxDim = parseInt(qualitySelect.value, 10);
        const preview = preview_image_with_palette(selectedFileBuffer, maxDim, paletteId);
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

// Re-render preview when quality/max-size changes
qualitySelect.addEventListener('change', () => {
    if (!paletteAutoMode && selectedFileBuffer && wasmInitialized) {
        renderPalettePreview(currentPaletteId);
    }
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
        encoderView.classList.add('hidden');
        decoderView.classList.remove('hidden');
        
        if (!wasmInitialized) {
            decoderStatus.textContent = "Loading decoder...";
            return;
        }
        
        const hash = window.location.hash.substring(1);
        
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
                        // Clean up
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
            window.animationInterval = setInterval(drawFrame, 200); // 5 FPS
        } else {
            const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
            ctx.putImageData(imageData, 0, 0);
        }
        
        decoderStatus.classList.add('hidden');
        decoded.free(); // Free memory
    } catch(e) {
        console.error("Failed to decode:", e);
        decoderStatus.textContent = "Failed to decode image: " + e;
        decoderStatus.classList.remove('hidden');
    }
}

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

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please select an image file.");
        return;
    }

    // Read array buffer (needed for Wasm preview)
    const arrayBufferReader = new FileReader();
    arrayBufferReader.onload = (e) => {
        selectedFileBuffer = new Uint8Array(e.target.result);
        // Trigger real-time preview immediately on upload
        if (wasmInitialized && !paletteAutoMode) {
            renderPalettePreview(currentPaletteId);
        } else if (wasmInitialized) {
            renderPalettePreview(0);
        }
    };
    arrayBufferReader.readAsArrayBuffer(file);

    // Read data URL for img preview
    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        previewContainer.classList.remove('hidden');
        settingsContainer.classList.remove('hidden');
        platformContainer.classList.remove('hidden');
        paletteContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        encodeBtn.disabled = !wasmInitialized;
        if (wasmInitialized) {
            updatePaletteUI();
        }
    };
    reader.readAsDataURL(file);
}

const DEFAULT_CHUNK_CHAR_LIMIT = 3000;

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
        
        const base62Str = paletteAutoMode
            ? encode_image_to_base62(selectedFileBuffer, maxDimension)
            : encode_image_to_base62_with_palette(selectedFileBuffer, maxDimension, currentPaletteId);
        
        const baseUrl = window.location.origin + window.location.pathname;
        const platformLimit = getChunkLimit();
        // Reserve chars for URL overhead: baseUrl + "#/99-99/" (worst-case chunk prefix = 8 chars)
        const urlOverhead = baseUrl.length + 8; // e.g. "http://192.168.15.20:8080/#/99-99/"
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
                    const data = { title: `NanoGlyph Part ${idx+1}/${total}`, text: `Part ${idx+1} of ${total}`, url: chunkUrl };
                    if (navigator.share) {
                        try { await navigator.share(data); } catch(e) { console.log(e); }
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
    
    const shareData = {
        title: 'NanoGlyph Image',
        text: 'I shared an offline image with you via NanoGlyph!',
        url: firstUrl
    };
    
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

// Initialize
bootstrap();
