import init, { ImageSession, decode_base62_to_image, get_palette_colors } from './nanoglyph_core/pkg/nanoglyph_core.js?v=22';

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
let wasmReadyPromise = null;

// DOM Elements
const encoderView = document.getElementById('encoder-view');
const decoderView = document.getElementById('decoder-view');
const appRoot = document.getElementById('app');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const imagePreview = document.getElementById('image-preview');
const previewFrame = document.querySelector('.preview-frame');
const encodeBtn = document.getElementById('encode-btn');
const settingsContainer = document.getElementById('settings-container');
const qualitySelect = document.getElementById('quality-select');
const compressionContainer = document.getElementById('compression-container');
const compressionSelect = document.getElementById('compression-select');
const transformContainer = document.getElementById('transform-container');
const transformLeftBtn = document.getElementById('transform-left');
const transformRightBtn = document.getElementById('transform-right');
const transformFlipHorizontalBtn = document.getElementById('transform-flip-horizontal');
const transformFlipVerticalBtn = document.getElementById('transform-flip-vertical');
const transformResetBtn = document.getElementById('transform-reset');
const transformStatus = document.getElementById('transform-status');
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
const paletteBtnAuto = document.getElementById('palette-btn-auto');
const paletteBtnManual = document.getElementById('palette-btn-manual');
const paletteModeLabel = document.getElementById('palette-mode-label');
const palettePrevBtn = document.getElementById('palette-prev');
const paletteNextBtn = document.getElementById('palette-next');
const chunkButtons = document.getElementById('chunk-buttons');
const savePngBtn = document.getElementById('save-png-btn');
const actionBlock = document.getElementById('action-block');
const mobileEditor = document.getElementById('mobile-adjustment-editor');
const mobileEditorNew = document.getElementById('mobile-editor-new');
const mobilePreviewSlot = document.getElementById('mobile-preview-slot');
const mobilePageSlot = document.getElementById('mobile-page-slot');
const mobileAdjustmentCounter = document.getElementById('mobile-adjustment-counter');
const mobileAdjustmentTitle = document.getElementById('mobile-adjustment-title');
const mobileAdjustmentValue = document.getElementById('mobile-adjustment-value');
const mobileAdjustmentPresets = document.getElementById('mobile-adjustment-presets');
const mobileAdjustmentPrev = document.getElementById('mobile-adjustment-prev');
const mobileAdjustmentNext = document.getElementById('mobile-adjustment-next');
const mobilePageReset = document.getElementById('mobile-page-reset');
const mobileInputStatus = document.getElementById('mobile-input-status');
const mobileColorRail = document.getElementById('mobile-color-rail');
const mobileColorSwatches = document.getElementById('mobile-color-swatches');
const mobileColorLabel = document.getElementById('mobile-color-label');
const mobileReceivedDialog = document.getElementById('mobile-received-dialog');
const mobileReceivedSlot = document.getElementById('mobile-received-slot');
const decoderHomeMarker = document.createComment('nanoglyph-decoder-home');
decoderView.before(decoderHomeMarker);

let selectedFileBuffer = null;
let imageSession = null;
let currentPreviewObjectUrl = null;
let heicLoaderPromise = null;

function initImageSession(buffer) {
    if (imageSession) {
        try { imageSession.free(); } catch (e) { }
    }
    imageSession = new ImageSession(buffer);
    imageSession.set_transform(rotationQuarterTurns, flipHorizontal, flipVertical);
    selectedFileBuffer = buffer;
}
let selectedPlatformLimit = 4096; // default: WhatsApp
let currentPaletteId = -1; // -1 = auto-detect
let paletteAutoMode = true;
let lastAutoPaletteId = 0;

// ── Image adjustments + mobile workflow ───────────────────────────────────
const ADJ_DEFAULTS = { exposure: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0 };
const mobileEditorMedia = window.matchMedia('(max-width: 560px)');

const MOBILE_ADJUSTMENTS = [
    {
        key: 'exposure', label: 'EXPOSURE', slider: adjExposure,
        presets: [['DARK', -35], ['SOFT', -15], ['BRIGHT', 35]],
    },
    {
        key: 'contrast', label: 'CONTRAST', slider: adjContrast,
        presets: [['SOFT', -30], ['CRISP', 20], ['HARD', 45]],
    },
    {
        key: 'saturation', label: 'SATURATION', slider: adjSaturation,
        presets: [['MONO', -100], ['MUTED', -35], ['VIVID', 45]],
    },
    {
        key: 'hue', label: 'HUE ROTATE', slider: adjHue,
        presets: [['LEFT', -90], ['FLIP', 180], ['RIGHT', 90]],
    },
    {
        key: 'temperature', label: 'TEMPERATURE', slider: adjTemperature,
        presets: [['COOL', -40], ['DAYLIGHT', 10], ['WARM', 40]],
    },
];

MOBILE_ADJUSTMENTS.forEach(adjustment => {
    adjustment.row = adjustment.slider.closest('.adj-row');
});

const MOBILE_PAGES = [
    { key: 'input', label: 'IMAGE INPUT', value: () => imageSession ? 'READY' : 'SELECT' },
    { key: 'scale', label: 'OUTPUT SCALE', nodes: [settingsContainer], value: () => `${qualitySelect.value} PX` },
    { key: 'palette', label: 'COLOR MATRIX', nodes: [paletteContainer], value: () => paletteAutoMode ? 'AUTO' : `#${currentPaletteId}` },
    { key: 'transform', label: 'TRANSFORM IMAGE', nodes: [transformContainer], value: () => `${rotationQuarterTurns * 90}°` },
    ...MOBILE_ADJUSTMENTS.map(adjustment => ({
        key: adjustment.key,
        label: adjustment.label,
        nodes: [adjustmentsContainer],
        adjustment,
        value: () => formatAdjustmentValue(adjustment),
    })),
    { key: 'compression', label: 'COMPRESSION', nodes: [compressionContainer], value: () => compressionSelect.value.toUpperCase() },
    { key: 'route', label: 'TRANSMISSION ROUTE', nodes: [platformContainer], value: () => getSelectedPlatformName().toUpperCase() },
    { key: 'export', label: 'EXPORT GLYPH', nodes: [actionBlock, resultContainer], value: () => resultContainer.classList.contains('hidden') ? 'READY' : 'DONE' },
];

const MOVABLE_MOBILE_NODES = [
    dropZone,
    previewContainer,
    settingsContainer,
    paletteContainer,
    transformContainer,
    adjustmentsContainer,
    compressionContainer,
    platformContainer,
    actionBlock,
    resultContainer,
];
const mobileHomeMarkers = new Map();
MOVABLE_MOBILE_NODES.forEach(node => {
    const marker = document.createComment(`nanoglyph-${node.id || 'node'}-home`);
    node.before(marker);
    mobileHomeMarkers.set(node, marker);
});

let activeMobilePage = 0;
let rotationQuarterTurns = 0;
let flipHorizontal = false;
let flipVertical = false;

function restoreMobileNode(node) {
    const marker = mobileHomeMarkers.get(node);
    if (marker?.parentNode && node.parentNode !== marker.parentNode) {
        marker.parentNode.insertBefore(node, marker.nextSibling);
    }
}

function getSelectedPlatformName() {
    return platformGrid.querySelector('.platform-btn.selected .platform-name')?.textContent || 'WhatsApp';
}

function formatAdjustmentValue(adjustment) {
    const value = parseInt(adjustment.slider.value, 10);
    if (adjustment.key === 'hue') return `${value}°`;
    return value > 0 ? `+${value}` : String(value);
}

function syncMobilePresetState() {
    if (!mobileEditor.open) return;
    const adjustment = MOBILE_PAGES[activeMobilePage]?.adjustment;
    if (!adjustment) return;
    const value = parseInt(adjustment.slider.value, 10);

    mobileAdjustmentValue.textContent = formatAdjustmentValue(adjustment);
    mobileAdjustmentPresets.querySelectorAll('button[data-value]').forEach(button => {
        const selected = parseInt(button.dataset.value, 10) === value;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

function setAdjustmentValue(adjustment, value) {
    adjustment.slider.value = value;
    adjustment.slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderMobilePresets(adjustment) {
    mobileAdjustmentPresets.innerHTML = '';
    [...adjustment.presets, ['RESET', 0]].forEach(([label, value]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-preset';
        button.dataset.value = String(value);
        button.textContent = label;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => setAdjustmentValue(adjustment, value));
        mobileAdjustmentPresets.appendChild(button);
    });
}

function syncMobilePageValue() {
    if (!mobileEditor.open) return;
    const page = MOBILE_PAGES[activeMobilePage];
    mobileAdjustmentValue.textContent = page.value?.() || '';
    syncMobilePresetState();
}

function updateMobileColorRail(paletteId = lastAutoPaletteId) {
    mobileColorSwatches.innerHTML = '';
    const colors = wasmInitialized
        ? get_palette_colors(Math.max(0, Math.min(98, paletteId)))
        : new Uint8Array(24).fill(68);
    for (let index = 0; index < 8; index++) {
        const swatch = document.createElement('span');
        swatch.style.backgroundColor = `rgb(${colors[index * 3]}, ${colors[index * 3 + 1]}, ${colors[index * 3 + 2]})`;
        mobileColorSwatches.appendChild(swatch);
    }
    mobileColorRail.disabled = !imageSession;
    mobileColorLabel.textContent = imageSession
        ? `COLOR MATRIX / ${paletteAutoMode ? `AUTO #${lastAutoPaletteId}` : `MANUAL #${currentPaletteId}`}`
        : 'COLOR MATRIX / WAITING';
}

function showMobilePage(index, focusControl = false) {
    if (!mobileEditor.open) return;
    if (!imageSession && index > 0) index = 0;
    activeMobilePage = Math.max(0, Math.min(index, MOBILE_PAGES.length - 1));
    const page = MOBILE_PAGES[activeMobilePage];

    MOBILE_PAGES.forEach(item => item.nodes?.forEach(restoreMobileNode));
    restoreMobileNode(dropZone);
    restoreMobileNode(previewContainer);
    MOBILE_ADJUSTMENTS.forEach(item => {
        const active = item === page.adjustment;
        item.row.classList.toggle('mobile-active', active);
        item.row.setAttribute('aria-hidden', String(!active));
    });

    if (!imageSession && page.key === 'input') {
        dropZone.classList.remove('hidden');
        mobilePreviewSlot.appendChild(dropZone);
    } else if (imageSession) {
        dropZone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        mobilePreviewSlot.appendChild(previewContainer);
    }

    page.nodes?.forEach(node => {
        if (node !== resultContainer) node.classList.remove('hidden');
        mobilePageSlot.appendChild(node);
    });

    if (page.adjustment) {
        adjustmentsToggle.setAttribute('aria-expanded', 'true');
        adjustmentsBody.setAttribute('aria-hidden', 'false');
        adjustmentsBody.classList.add('open');
        renderMobilePresets(page.adjustment);
        mobileAdjustmentPresets.classList.remove('hidden');
    } else {
        mobileAdjustmentPresets.innerHTML = '';
        mobileAdjustmentPresets.classList.add('hidden');
    }

    mobileEditor.classList.toggle('mobile-input-page', page.key === 'input');
    mobileEditor.classList.toggle('mobile-no-image', !imageSession);
    mobileEditor.classList.toggle('mobile-export-page', page.key === 'export');
    mobileAdjustmentCounter.textContent = `STEP ${String(activeMobilePage + 1).padStart(2, '0')} / ${MOBILE_PAGES.length}`;
    mobileAdjustmentTitle.textContent = page.label;
    mobileAdjustmentPrev.disabled = activeMobilePage === 0;
    mobileAdjustmentNext.disabled = !imageSession || activeMobilePage === MOBILE_PAGES.length - 1;
    mobilePageReset.classList.toggle('hidden', page.key === 'input' || page.key === 'export');
    mobileEditorNew.classList.toggle('hidden', !imageSession);
    mobileInputStatus.classList.toggle('hidden', page.key !== 'input' || !mobileInputStatus.textContent);
    syncMobilePageValue();
    updateMobileColorRail();
    mobilePageSlot.scrollTop = 0;

    if (focusControl) {
        const target = page.adjustment?.slider || mobilePageSlot.querySelector('select, button:not(.hidden), input');
        requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    }
}

function restoreMobileEditorNodes() {
    MOVABLE_MOBILE_NODES.forEach(restoreMobileNode);
    document.body.classList.remove('mobile-editor-open');
    adjustmentsToggle.setAttribute('aria-expanded', 'false');
    adjustmentsBody.setAttribute('aria-hidden', 'true');
    adjustmentsBody.classList.remove('open');
    MOBILE_ADJUSTMENTS.forEach(item => {
        item.row.classList.remove('mobile-active');
        item.row.removeAttribute('aria-hidden');
    });

}

function closeMobileEditor() {
    if (!mobileEditor.open) return;
    mobileEditor.close();
}

function openMobileEditor(initialPage = activeMobilePage) {
    if (!mobileEditorMedia.matches || mobileEditor.open || mobileReceivedDialog.open) return;
    document.body.classList.add('mobile-editor-open');
    mobileEditor.showModal();
    showMobilePage(initialPage, false);
}

function restoreMobileReceivedNode() {
    if (decoderHomeMarker.parentNode && decoderView.parentNode !== decoderHomeMarker.parentNode) {
        decoderHomeMarker.parentNode.insertBefore(decoderView, decoderHomeMarker.nextSibling);
    }
    document.body.classList.remove('mobile-received-open');
}

function closeMobileReceivedView() {
    if (mobileReceivedDialog.open) mobileReceivedDialog.close();
    else restoreMobileReceivedNode();
}

function openMobileReceivedView() {
    if (!mobileEditorMedia.matches) return;
    closeMobileEditor();
    decoderView.classList.remove('hidden');
    mobileReceivedSlot.appendChild(decoderView);
    document.body.classList.add('mobile-received-open');
    if (!mobileReceivedDialog.open) mobileReceivedDialog.showModal();
}

mobileReceivedDialog.addEventListener('cancel', event => event.preventDefault());
mobileReceivedDialog.addEventListener('close', restoreMobileReceivedNode);

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
    adjustmentsBadge.textContent = active ? 'MODIFIED' : 'DEFAULT';
    adjustmentsBadge.classList.toggle('active', active);
    syncMobilePresetState();
    syncMobilePageValue();
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
    if (mobileEditorMedia.matches && !previewContainer.classList.contains('hidden')) {
        openMobileEditor(4);
        showMobilePage(4, true);
        return;
    }

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
            const effectiveId = currentPaletteId < 0 ? 99 : currentPaletteId;
            renderPalettePreview(effectiveId);
        }
    }, 2);
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
function resetAllAdjustments() {
    [adjExposure, adjContrast, adjSaturation, adjHue, adjTemperature].forEach(s => s.value = 0);
    syncAdjustmentUI();
    debouncedPreviewUpdate();
}

document.getElementById('adj-reset-all').addEventListener('click', resetAllAdjustments);

function syncTransformUI() {
    const parts = [`${rotationQuarterTurns * 90}°`];
    if (flipHorizontal) parts.push('FLIP H');
    if (flipVertical) parts.push('FLIP V');
    if (parts.length === 1 && rotationQuarterTurns === 0) parts.push('ORIGINAL');
    transformStatus.textContent = parts.join(' / ');
    transformFlipHorizontalBtn.classList.toggle('active', flipHorizontal);
    transformFlipVerticalBtn.classList.toggle('active', flipVertical);
    transformFlipHorizontalBtn.setAttribute('aria-pressed', String(flipHorizontal));
    transformFlipVerticalBtn.setAttribute('aria-pressed', String(flipVertical));
    syncMobilePageValue();
}

function applyTransform() {
    syncTransformUI();
    if (!imageSession || !wasmInitialized) return;
    imageSession.set_transform(rotationQuarterTurns, flipHorizontal, flipVertical);
    const effectiveId = currentPaletteId < 0 ? 99 : currentPaletteId;
    renderPalettePreview(effectiveId);
}

function resetTransform() {
    rotationQuarterTurns = 0;
    flipHorizontal = false;
    flipVertical = false;
    applyTransform();
}

transformLeftBtn.addEventListener('click', () => {
    rotationQuarterTurns = (rotationQuarterTurns + 3) % 4;
    applyTransform();
});
transformRightBtn.addEventListener('click', () => {
    rotationQuarterTurns = (rotationQuarterTurns + 1) % 4;
    applyTransform();
});
transformFlipHorizontalBtn.addEventListener('click', () => {
    flipHorizontal = !flipHorizontal;
    applyTransform();
});
transformFlipVerticalBtn.addEventListener('click', () => {
    flipVertical = !flipVertical;
    applyTransform();
});
transformResetBtn.addEventListener('click', resetTransform);

function resetCurrentMobilePage() {
    const page = MOBILE_PAGES[activeMobilePage];
    if (page.adjustment) {
        setAdjustmentValue(page.adjustment, 0);
        return;
    }

    if (page.key === 'scale') {
        qualitySelect.value = '128';
        qualitySelect.dispatchEvent(new Event('change'));
    } else if (page.key === 'palette') {
        paletteBtnAuto.click();
    } else if (page.key === 'transform') {
        resetTransform();
    } else if (page.key === 'compression') {
        compressionSelect.value = 'brotli';
    } else if (page.key === 'route') {
        platformGrid.querySelector('[data-platform="whatsapp"]')?.click();
    }
    syncMobilePageValue();
}

mobilePageReset.addEventListener('click', resetCurrentMobilePage);
mobileAdjustmentPrev.addEventListener('click', () => showMobilePage(activeMobilePage - 1, true));
mobileAdjustmentNext.addEventListener('click', () => showMobilePage(activeMobilePage + 1, true));
mobileColorRail.addEventListener('click', () => {
    if (imageSession) showMobilePage(2, true);
});
mobileEditorNew.addEventListener('click', () => resetProject());

mobileEditor.addEventListener('cancel', event => {
    event.preventDefault();
});

mobileEditor.addEventListener('close', restoreMobileEditorNodes);

mobileEditorMedia.addEventListener('change', event => {
    if (!event.matches) {
        closeMobileEditor();
        closeMobileReceivedView();
    } else if (window.location.hash.length <= 1) {
        openMobileEditor(activeMobilePage);
    }
});

// Platform selection logic
platformGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.platform-btn');
    if (!btn) return;
    platformGrid.querySelectorAll('.platform-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');
    selectedPlatformLimit = parseInt(btn.dataset.limit, 10);
    syncMobilePageValue();
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
    if (!imageSession || !wasmInitialized) return;
    try {
        const maxDim = parseInt(qualitySelect.value, 10);
        const [exp, con, sat, hue, tmp] = getAdjFloats();

        // Cache layer via imageSession avoids re-decoding JPEG/PNG files per-slider change
        const preview = imageSession.preview(maxDim, paletteId, exp, con, sat, hue, tmp);
        const rgba = preview.get_rgba();
        const w = preview.width;
        const h = preview.height;
        const actualPaletteId = preview.palette_id;
        lastAutoPaletteId = actualPaletteId;
        
        if (paletteAutoMode) {
             renderPaletteSwatches(actualPaletteId);
             paletteModeLabel.textContent = `Auto — Match #${actualPaletteId}`;
        }
        updateMobileColorRail(actualPaletteId);
        syncMobilePageValue();

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
            previewFrame.appendChild(previewCanvas);
        }
        previewCanvas.style.display = 'block';

        preview.free();
    } catch (e) {
        console.error('Preview error:', e);
    }
}

function updatePaletteUI() {
    const effectiveId = currentPaletteId < 0 ? 99 : currentPaletteId;
    
    if (paletteAutoMode) {
        paletteBtnAuto.classList.add('active');
        paletteBtnManual.classList.remove('active');
        paletteBtnAuto.setAttribute('aria-pressed', 'true');
        paletteBtnManual.setAttribute('aria-pressed', 'false');
        paletteModeLabel.textContent = 'Auto / best match';
    } else {
        paletteBtnAuto.classList.remove('active');
        paletteBtnManual.classList.add('active');
        paletteBtnAuto.setAttribute('aria-pressed', 'false');
        paletteBtnManual.setAttribute('aria-pressed', 'true');
        paletteModeLabel.textContent = `Manual — ${currentPaletteId}/98`;
    }
    // Always render dithered preview when image is loaded
    if (selectedFileBuffer && wasmInitialized) {
        renderPalettePreview(effectiveId);
    }
    paletteSwatches.classList.add('active');
    if (!paletteAutoMode) {
        renderPaletteSwatches(effectiveId);
    }
    updateMobileColorRail(paletteAutoMode ? lastAutoPaletteId : effectiveId);
    syncMobilePageValue();
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

paletteBtnAuto.addEventListener('click', () => {
    paletteAutoMode = true;
    currentPaletteId = -1;
    updatePaletteUI();
});

paletteBtnManual.addEventListener('click', () => {
    if (paletteAutoMode) {
        paletteAutoMode = false;
        currentPaletteId = lastAutoPaletteId;
    }
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
        const effectiveId = currentPaletteId < 0 ? 99 : currentPaletteId;
        renderPalettePreview(effectiveId);
    }
    syncMobilePageValue();
});

compressionSelect.addEventListener('change', syncMobilePageValue);

// Save the dithered preview canvas as PNG (without sharing)
savePreviewBtn.addEventListener('click', () => {
    const previewCanvas = document.getElementById('palette-preview-canvas');
    saveCanvasAsUpscaledPng(previewCanvas, 'nanoglyph-preview.png', () => {
        savePreviewBtn.textContent = 'SAVED ✓';
        setTimeout(() => { savePreviewBtn.textContent = 'SAVE PIXEL PNG ↓'; }, 2000);
    });
});

async function bootstrap() {
    try {
        await init();
        wasmInitialized = true;
        console.log("Wasm initialized.");

        if (imageSession) {
            encodeBtn.disabled = false;
            updatePaletteUI();
        }
        updateMobileColorRail();

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
            if (mobileEditorMedia.matches) {
                closeMobileReceivedView();
                openMobileEditor(activeMobilePage);
            }
            return;
        }

        encoderView.classList.add('hidden');
        decoderView.classList.remove('hidden');
        if (mobileEditorMedia.matches) openMobileReceivedView();

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
        if (mobileEditorMedia.matches) {
            closeMobileReceivedView();
            openMobileEditor(activeMobilePage);
        }
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
        savePngBtn.textContent = 'SAVED ✓';
        setTimeout(() => { savePngBtn.textContent = 'SAVE PIXEL PNG ↓'; }, 2000);
    });
});

window.addEventListener('hashchange', checkHash);

// File Selection Logic
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
    }
});

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

function clearCurrentImage() {
    if (imageSession) {
        try { imageSession.free(); } catch (error) { }
    }
    imageSession = null;
    selectedFileBuffer = null;
    if (currentPreviewObjectUrl) URL.revokeObjectURL(currentPreviewObjectUrl);
    currentPreviewObjectUrl = null;
    imagePreview.removeAttribute('src');
    imagePreview.style.display = 'none';
    document.getElementById('palette-preview-canvas')?.style.setProperty('display', 'none');
    previewContainer.classList.add('hidden');
    [settingsContainer, paletteContainer, transformContainer, adjustmentsContainer, compressionContainer, platformContainer]
        .forEach(node => node.classList.add('hidden'));
    savePreviewBtn.classList.add('hidden');
    encodeBtn.disabled = true;
}

function resetEditorOptions() {
    qualitySelect.value = '128';
    [warningHigh, warningZen, warningCosmic].forEach(node => node?.classList.add('hidden'));
    paletteAutoMode = true;
    currentPaletteId = -1;
    lastAutoPaletteId = 0;
    resetAllAdjustments();
    resetTransform();
    compressionSelect.value = 'brotli';
    selectedPlatformLimit = 4096;
    platformGrid.querySelectorAll('.platform-btn').forEach(button => {
        const selected = button.dataset.platform === 'whatsapp';
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    resultContainer.classList.add('hidden');
    urlBox.textContent = '';
    chunkButtons.innerHTML = '';
    shareBtn.classList.remove('hidden');
    copyBtn.classList.remove('hidden');
    encodeBtn.removeAttribute('aria-busy');
    encodeBtn.innerHTML = '<span class="btn-label">ENCODE MAGIC LINK</span><span aria-hidden="true">→</span>';
    updatePaletteUI();
    syncMobilePageValue();
}

function resetProject() {
    clearCurrentImage();
    resetEditorOptions();
    resultContainer.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    mobileInputStatus.textContent = '';
    activeMobilePage = 0;
    updateMobileColorRail();
    if (mobileEditor.open) showMobilePage(0, true);
}

// Check if file is HEIF/HEIC format (not supported by Rust image crate)
function isHeifFormat(file) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return type === 'image/heif' || type === 'image/heic' ||
        name.endsWith('.heif') || name.endsWith('.heic');
}

function loadHeicConverter() {
    if (window.HeicTo) return Promise.resolve(window.HeicTo);
    if (heicLoaderPromise) return heicLoaderPromise;

    heicLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './vendor/heic-to-1.5.2.min.js';
        script.async = true;
        script.onload = () => window.HeicTo
            ? resolve(window.HeicTo)
            : reject(new Error('HEIF decoder loaded without its public API.'));
        script.onerror = () => reject(new Error('Could not load the local HEIF decoder.'));
        document.head.appendChild(script);
    }).catch(error => {
        heicLoaderPromise = null;
        throw error;
    });

    return heicLoaderPromise;
}

async function convertHeifToJpeg(file) {
    const heicTo = await loadHeicConverter();
    const converted = await heicTo({
        blob: file,
        type: 'image/jpeg',
        quality: 0.92,
    });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    if (!(jpeg instanceof Blob) || jpeg.size === 0) {
        throw new Error('The HEIF file did not contain a decodable primary image.');
    }
    return jpeg;
}

async function handleFile(file) {
    if (!file.type.startsWith('image/') && !isHeifFormat(file)) {
        mobileInputStatus.textContent = 'UNSUPPORTED FILE / SELECT AN IMAGE';
        if (!mobileEditorMedia.matches) alert('Please select an image file.');
        return;
    }

    const needsConversion = isHeifFormat(file);
    clearCurrentImage();
    resetEditorOptions();
    encodeBtn.disabled = true;
    resultContainer.classList.add('hidden');
    mobileInputStatus.textContent = needsConversion ? 'CONVERTING HEIF → JPG…' : 'READING IMAGE…';
    mobileInputStatus.classList.remove('hidden');
    if (mobileEditor.open) showMobilePage(0);

    try {
        const browserReadyBlob = needsConversion ? await convertHeifToJpeg(file) : file;
        const arrayBuffer = await browserReadyBlob.arrayBuffer();
        await wasmReadyPromise;
        if (!wasmInitialized) throw new Error('The local image engine could not be initialized.');
        initImageSession(new Uint8Array(arrayBuffer));

        if (currentPreviewObjectUrl) URL.revokeObjectURL(currentPreviewObjectUrl);
        currentPreviewObjectUrl = URL.createObjectURL(browserReadyBlob);
        imagePreview.src = currentPreviewObjectUrl;
        imagePreview.style.display = 'block';
        const previousPreview = document.getElementById('palette-preview-canvas');
        if (previousPreview) previousPreview.style.display = 'none';
        previewContainer.classList.remove('hidden');
        settingsContainer.classList.remove('hidden');
        compressionContainer.classList.remove('hidden');
        transformContainer.classList.remove('hidden');
        adjustmentsContainer.classList.remove('hidden');
        platformContainer.classList.remove('hidden');
        paletteContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        savePreviewBtn.classList.remove('hidden');
        syncAdjustmentUI();
        syncTransformUI();
        mobileInputStatus.textContent = needsConversion ? 'HEIF CONVERTED TO JPG ✓' : `${file.name || 'IMAGE'} READY`;
        if (wasmInitialized) {
            updatePaletteUI();
        }
        if (mobileEditorMedia.matches) {
            openMobileEditor(1);
            showMobilePage(1, true);
        }
        encodeBtn.disabled = !wasmInitialized;
    } catch (error) {
        console.error('Image preparation failed:', error);
        clearCurrentImage();
        const detail = needsConversion
            ? 'HEIF CONVERSION FAILED / TRY ANOTHER FILE'
            : 'IMAGE COULD NOT BE DECODED';
        mobileInputStatus.textContent = detail;
        dropZone.classList.remove('hidden');
        if (mobileEditor.open) showMobilePage(0);
        if (!mobileEditorMedia.matches) alert(`${detail}. ${error.message || error}`);
    } finally {
        fileInput.value = '';
    }
}

const DEFAULT_CHUNK_CHAR_LIMIT = 3000;
const BROWSER_URL_MAX = 32779; // Chrome's max URL length

function getChunkLimit() {
    return selectedPlatformLimit || DEFAULT_CHUNK_CHAR_LIMIT;
}

// Encoding Logic
encodeBtn.addEventListener('click', async () => {
    if (!imageSession) return;

    try {
        encodeBtn.disabled = true;
        encodeBtn.setAttribute('aria-busy', 'true');
        encodeBtn.innerHTML = '<span class="btn-label">ENCODING PIXELS</span><span aria-hidden="true">•••</span>';
        appRoot.classList.add('is-encoding');
        mobileEditor.classList.add('is-encoding');
        resultContainer.classList.add('hidden');

        // Give the stepped dither overlay one full paint before the synchronous Wasm work begins.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const maxDimension = parseInt(qualitySelect.value, 10);
        const useBrotli = compressionSelect.value === 'brotli';

        // Get adjustment values (floats)
        const [exp, con, sat, hue, tmp] = getAdjFloats();

        // Encode directly with Wasm, passing the adjustment values
        const base62Str = paletteAutoMode
            ? imageSession.encode_auto(maxDimension, useBrotli, exp, con, sat, hue, tmp)
            : imageSession.encode_with_palette(maxDimension, currentPaletteId, useBrotli, exp, con, sat, hue, tmp);

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
            info.className = 'chunk-info';
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
        appRoot.classList.remove('is-encoding');
        mobileEditor.classList.remove('is-encoding');
        encodeBtn.disabled = false;
        encodeBtn.removeAttribute('aria-busy');
        encodeBtn.innerHTML = '<span class="btn-label">ENCODE MAGIC LINK</span><span aria-hidden="true">→</span>';

        if (!resultContainer.classList.contains('hidden')) {
            syncMobilePageValue();
            if (mobileEditor.open) {
                requestAnimationFrame(() => {
                    mobilePageSlot.scrollTop = Math.max(0, resultContainer.offsetTop - mobilePageSlot.offsetTop);
                });
            } else {
                requestAnimationFrame(() => {
                    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    resultContainer.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
                });
            }
        }
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
    resetProject();
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
if (mobileEditorMedia.matches && window.location.hash.length <= 1) {
    openMobileEditor(0);
}
wasmReadyPromise = bootstrap();
