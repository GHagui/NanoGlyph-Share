import { NanoGlyphEngine } from './engine-client.js';
import {
    CANONICAL_APP_URL,
    initializePlatform,
    savePngBlob,
    shareUrl,
} from './native-platform.js';
import {
    collectChunkPayload,
    MAX_NANOGLYPH_PAYLOAD_LENGTH,
    parseChunkMetadata,
    splitPayloadIntoChunks,
} from './share-chunks.js';
import {
    initializeI18n,
    onLocaleChange,
    t,
    translateDocument,
} from './i18n.js';

initializeI18n();

const engine = new NanoGlyphEngine();

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

    exportCanvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
            await savePngBlob(blob, filename);
            if (successCallback) successCallback();
        } catch (error) {
            console.error('PNG save failed:', error);
            alert(t('error.savePng'));
        }
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
const desktopInfo = document.getElementById('desktop-info');
const mobileEditor = document.getElementById('mobile-adjustment-editor');
const mobileEditorInfo = document.getElementById('mobile-editor-info');
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
const onboardingDialog = document.getElementById('onboarding-dialog');
const onboardingCounter = document.getElementById('onboarding-counter');
const onboardingArt = document.getElementById('onboarding-art');
const onboardingEyebrow = document.getElementById('onboarding-eyebrow');
const onboardingTitle = document.getElementById('onboarding-title');
const onboardingCopy = document.getElementById('onboarding-copy');
const onboardingHint = document.getElementById('onboarding-hint');
const onboardingSkip = document.getElementById('onboarding-skip');
const onboardingPrev = document.getElementById('onboarding-prev');
const onboardingNext = document.getElementById('onboarding-next');
const mobileReceivedDialog = document.getElementById('mobile-received-dialog');
const mobileReceivedSlot = document.getElementById('mobile-received-slot');
const decoderHomeMarker = document.createComment('nanoglyph-decoder-home');
decoderView.before(decoderHomeMarker);

let decoderStatusState = { key: 'decoder.decodingSignal', params: {} };
let mobileInputStatusState = null;

function setDecoderStatus(key, params = {}) {
    decoderStatusState = { key, params };
    decoderStatus.textContent = t(key, params);
}

function setMobileInputStatus(key = null, params = {}) {
    mobileInputStatusState = key ? { key, params } : null;
    mobileInputStatus.textContent = key ? t(key, params) : '';
}

function refreshPaletteLabel() {
    if (paletteAutoMode) {
        paletteModeLabel.textContent = selectedFileBuffer
            ? t('palette.match', { id: lastAutoPaletteId })
            : t('palette.bestMatch');
    } else {
        paletteModeLabel.textContent = t('palette.manualStatus', { id: currentPaletteId });
    }
}

let selectedFileBuffer = null;
let imageGeneration = 0;
let currentPreviewObjectUrl = null;
let heicLoaderPromise = null;

async function initImageSession(buffer) {
    await engine.loadImage(buffer.buffer);
    await engine.setTransform(rotationQuarterTurns, flipHorizontal, flipVertical);
    selectedFileBuffer = true;
}
let selectedPlatformLimit = 4096; // default: WhatsApp
let currentPaletteId = -1; // -1 = auto-detect
let paletteAutoMode = true;
let lastAutoPaletteId = 0;

// ── Image adjustments + mobile workflow ───────────────────────────────────
const ADJ_DEFAULTS = { exposure: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0 };
const mobileEditorMedia = window.matchMedia('(max-width: 560px)');
const ONBOARDING_KEY = 'nanoglyph_onboarding_v1';
const LEGACY_MOBILE_ONBOARDING_KEY = 'nanoglyph_mobile_onboarding_v1';
const ONBOARDING_ART = {
    'photo-link': `
        <div class="art-photo-frame">
            <span class="art-photo-sun"></span>
            <span class="art-photo-mountain art-photo-mountain-back"></span>
            <span class="art-photo-mountain art-photo-mountain-front"></span>
        </div>
        <span class="art-photo-arrow">→</span>
        <div class="art-link-bar"><strong>HTTPS</strong><span></span></div>`,
    choose: `
        <div class="art-drop-target"><span data-i18n="onboarding.art.drop">DROP HERE</span><b>＋</b></div>
        <div class="art-file-card"><i></i><strong>IMG</strong><small>.JPG</small></div>
        <span class="art-cursor">↖</span>`,
    create: `
        <span class="art-create-track"></span>
        <div class="art-create-source"><i></i><i></i><i></i><i></i></div>
        <div class="art-create-core"><i></i><i></i><i></i></div>
        <div class="art-create-result"><strong data-i18n="onboarding.art.link">LINK</strong><span>↗</span></div>
        <div class="art-create-progress"><span></span></div>`,
    share: `
        <div class="art-chat-window">
            <div class="art-chat-header"><i></i><strong data-i18n="onboarding.art.chat">CHAT</strong></div>
            <div class="art-message art-message-one"><b>1 / 3</b><span></span></div>
            <div class="art-message art-message-two"><b>2 / 3</b><span></span></div>
            <div class="art-message art-message-three"><b>3 / 3</b><span></span></div>
        </div>
        <span class="art-send-arrow">↗</span>`,
    receive: `
        <div class="art-receive-frame">
            <span class="art-piece art-piece-one">1</span>
            <span class="art-piece art-piece-two">2</span>
            <span class="art-piece art-piece-three">3</span>
            <span class="art-piece art-piece-four">✓</span>
        </div>
        <strong class="art-complete" data-i18n="onboarding.art.complete">PHOTO COMPLETE</strong>`,
};
const ONBOARDING_SLIDES = [
    {
        art: 'photo-link',
        prefix: 'onboarding.1',
    },
    {
        art: 'choose',
        prefix: 'onboarding.2',
        contextual: true,
    },
    {
        art: 'create',
        prefix: 'onboarding.3',
        contextual: true,
    },
    {
        art: 'share',
        prefix: 'onboarding.4',
    },
    {
        art: 'receive',
        prefix: 'onboarding.5',
    },
];
let activeOnboardingSlide = 0;
let onboardingCompletedForSession = false;
let onboardingTrigger = null;

const MOBILE_ADJUSTMENTS = [
    {
        key: 'exposure', labelKey: 'adjustments.exposure', slider: adjExposure,
        presets: [['preset.dark', -35], ['preset.soft', -15], ['preset.bright', 35]],
    },
    {
        key: 'contrast', labelKey: 'adjustments.contrast', slider: adjContrast,
        presets: [['preset.soft', -30], ['preset.crisp', 20], ['preset.hard', 45]],
    },
    {
        key: 'saturation', labelKey: 'adjustments.saturation', slider: adjSaturation,
        presets: [['preset.mono', -100], ['preset.muted', -35], ['preset.vivid', 45]],
    },
    {
        key: 'hue', labelKey: 'adjustments.hue', slider: adjHue,
        presets: [['preset.left', -90], ['preset.flip', 180], ['preset.right', 90]],
    },
    {
        key: 'temperature', labelKey: 'adjustments.temperature', slider: adjTemperature,
        presets: [['preset.cool', -40], ['preset.daylight', 10], ['preset.warm', 40]],
    },
];

MOBILE_ADJUSTMENTS.forEach(adjustment => {
    adjustment.row = adjustment.slider.closest('.adj-row');
});

const MOBILE_PAGES = [
    { key: 'input', labelKey: 'mobile.input', value: () => t(selectedFileBuffer ? 'mobile.ready' : 'mobile.select') },
    { key: 'scale', labelKey: 'mobile.scale', nodes: [settingsContainer], value: () => `${qualitySelect.value} PX` },
    { key: 'palette', labelKey: 'mobile.palette', nodes: [paletteContainer], value: () => paletteAutoMode ? t('palette.auto') : `#${currentPaletteId}` },
    { key: 'transform', labelKey: 'mobile.transform', nodes: [transformContainer], value: () => `${rotationQuarterTurns * 90}°` },
    ...MOBILE_ADJUSTMENTS.map(adjustment => ({
        key: adjustment.key,
        labelKey: adjustment.labelKey,
        nodes: [adjustmentsContainer],
        adjustment,
        value: () => formatAdjustmentValue(adjustment),
    })),
    { key: 'route', labelKey: 'mobile.route', nodes: [platformContainer], value: () => getSelectedPlatformName().toUpperCase() },
    { key: 'export', labelKey: 'mobile.export', nodes: [actionBlock, resultContainer], value: () => t(resultContainer.classList.contains('hidden') ? 'mobile.ready' : 'mobile.done') },
];

const MOVABLE_MOBILE_NODES = [
    dropZone,
    previewContainer,
    settingsContainer,
    paletteContainer,
    transformContainer,
    adjustmentsContainer,
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
    [...adjustment.presets, ['preset.reset', 0]].forEach(([labelKey, value]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-preset';
        button.dataset.value = String(value);
        button.textContent = t(labelKey);
        button.dataset.i18nKey = labelKey;
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

function hasCompletedOnboarding() {
    if (onboardingCompletedForSession) return true;
    try {
        if (localStorage.getItem(ONBOARDING_KEY) === 'complete') return true;
        if (localStorage.getItem(LEGACY_MOBILE_ONBOARDING_KEY) === 'complete') {
            try {
                localStorage.setItem(ONBOARDING_KEY, 'complete');
            } catch (error) {
                // The legacy value is still enough to honor the user's choice.
            }
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function completeOnboarding() {
    onboardingCompletedForSession = true;
    try {
        localStorage.setItem(ONBOARDING_KEY, 'complete');
    } catch (error) {
        // The in-memory flag still prevents repeat prompts for this session.
    }
}

function renderOnboarding() {
    const slide = ONBOARDING_SLIDES[activeOnboardingSlide];
    onboardingCounter.textContent = `${String(activeOnboardingSlide + 1).padStart(2, '0')} / ${String(ONBOARDING_SLIDES.length).padStart(2, '0')}`;
    onboardingArt.dataset.slide = slide.art;
    onboardingArt.innerHTML = ONBOARDING_ART[slide.art];
    translateDocument(onboardingArt);
    onboardingEyebrow.textContent = t(`${slide.prefix}.eyebrow`);
    onboardingTitle.textContent = t(`${slide.prefix}.title`);
    const copySuffix = slide.contextual
        ? (mobileEditorMedia.matches ? 'mobileCopy' : 'desktopCopy')
        : 'copy';
    onboardingCopy.textContent = t(`${slide.prefix}.${copySuffix}`);
    onboardingHint.textContent = t(`${slide.prefix}.hint`);
    onboardingPrev.disabled = activeOnboardingSlide === 0;
    onboardingNext.textContent = activeOnboardingSlide === ONBOARDING_SLIDES.length - 1
        ? t('onboarding.start')
        : t('onboarding.next');
}

function hideOnboarding(markComplete = false, restoreFocus = true) {
    if (markComplete) completeOnboarding();
    if (onboardingDialog.open) onboardingDialog.close();
    document.body.classList.remove('onboarding-open');
    if (restoreFocus && onboardingTrigger?.isConnected) {
        onboardingTrigger.focus({ preventScroll: true });
    }
    onboardingTrigger = null;
}

function showOnboarding(force = false) {
    if (onboardingDialog.open || mobileReceivedDialog.open) return;
    if (mobileEditorMedia.matches && !mobileEditor.open) return;
    if (!force && (window.location.hash.length > 1 || hasCompletedOnboarding())) return;
    onboardingTrigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    activeOnboardingSlide = 0;
    renderOnboarding();
    document.body.classList.add('onboarding-open');
    onboardingDialog.showModal();
    requestAnimationFrame(() => onboardingNext.focus({ preventScroll: true }));
}

function showMobilePage(index, focusControl = false) {
    if (!mobileEditor.open) return;
    if (!selectedFileBuffer && index > 0) index = 0;
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

    if (!selectedFileBuffer && page.key === 'input') {
        dropZone.classList.remove('hidden');
        mobilePreviewSlot.appendChild(dropZone);
    } else if (selectedFileBuffer) {
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
    mobileEditor.classList.toggle('mobile-no-image', !selectedFileBuffer);
    mobileEditor.classList.toggle('mobile-export-page', page.key === 'export');
    mobileAdjustmentCounter.textContent = t('mobile.step', {
        current: String(activeMobilePage + 1).padStart(2, '0'),
        total: MOBILE_PAGES.length,
    });
    mobileAdjustmentTitle.textContent = t(page.labelKey);
    mobileAdjustmentPrev.disabled = activeMobilePage === 0;
    mobileAdjustmentNext.disabled = !selectedFileBuffer || activeMobilePage === MOBILE_PAGES.length - 1;
    mobilePageReset.classList.toggle('hidden', page.key === 'input' || page.key === 'export');
    mobileEditorNew.classList.toggle('hidden', !selectedFileBuffer);
    mobileInputStatus.classList.toggle('hidden', page.key !== 'input' || !mobileInputStatus.textContent);
    syncMobilePageValue();
    mobilePageSlot.scrollTop = 0;

    if (focusControl) {
        const target = page.adjustment?.slider || mobilePageSlot.querySelector('select, button:not(.hidden), input');
        requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    }
}

function restoreMobileEditorNodes() {
    MOVABLE_MOBILE_NODES.forEach(restoreMobileNode);
    document.body.classList.remove('mobile-editor-open');
    adjustmentsToggle.setAttribute('aria-expanded', 'true');
    adjustmentsBody.setAttribute('aria-hidden', 'false');
    adjustmentsBody.classList.add('open');
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
    showOnboarding(false);
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
    adjustmentsBadge.textContent = t(active ? 'adjustments.modified' : 'adjustments.default');
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

// The adjustment panel stays expanded; on mobile its header opens the first
// adjustment page instead of collapsing the controls.
adjustmentsToggle.addEventListener('click', () => {
    if (mobileEditorMedia.matches && !previewContainer.classList.contains('hidden')) {
        openMobileEditor(4);
        showMobilePage(4, true);
        return;
    }

    adjustmentsToggle.setAttribute('aria-expanded', 'true');
    adjustmentsBody.setAttribute('aria-hidden', 'false');
    adjustmentsBody.classList.add('open');
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
    }, 100);
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
    if (flipHorizontal) parts.push(t('transform.flipH'));
    if (flipVertical) parts.push(t('transform.flipV'));
    if (parts.length === 1 && rotationQuarterTurns === 0) parts.push(t('transform.original'));
    transformStatus.textContent = parts.join(' / ');
    transformFlipHorizontalBtn.classList.toggle('active', flipHorizontal);
    transformFlipVerticalBtn.classList.toggle('active', flipVertical);
    transformFlipHorizontalBtn.setAttribute('aria-pressed', String(flipHorizontal));
    transformFlipVerticalBtn.setAttribute('aria-pressed', String(flipVertical));
    syncMobilePageValue();
}

async function applyTransform() {
    syncTransformUI();
    if (!selectedFileBuffer || !wasmInitialized) return;
    await engine.setTransform(rotationQuarterTurns, flipHorizontal, flipVertical);
    const effectiveId = currentPaletteId < 0 ? 99 : currentPaletteId;
    await renderPalettePreview(effectiveId);
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
    } else if (page.key === 'route') {
        platformGrid.querySelector('[data-platform="whatsapp"]')?.click();
    }
    syncMobilePageValue();
}

mobilePageReset.addEventListener('click', resetCurrentMobilePage);
mobileAdjustmentPrev.addEventListener('click', () => showMobilePage(activeMobilePage - 1, true));
mobileAdjustmentNext.addEventListener('click', () => showMobilePage(activeMobilePage + 1, true));
desktopInfo.addEventListener('click', () => showOnboarding(true));
mobileEditorInfo.addEventListener('click', () => showOnboarding(true));
onboardingSkip.addEventListener('click', () => hideOnboarding(true));
onboardingPrev.addEventListener('click', () => {
    if (activeOnboardingSlide === 0) return;
    activeOnboardingSlide--;
    renderOnboarding();
});
onboardingNext.addEventListener('click', () => {
    if (activeOnboardingSlide === ONBOARDING_SLIDES.length - 1) {
        hideOnboarding(true);
        return;
    }
    activeOnboardingSlide++;
    renderOnboarding();
});
onboardingDialog.addEventListener('cancel', event => event.preventDefault());
onboardingDialog.addEventListener('close', () => document.body.classList.remove('onboarding-open'));
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
        const onboardingWasOpen = onboardingDialog.open;
        if (onboardingWasOpen) onboardingDialog.close();
        openMobileEditor(activeMobilePage);
        if (onboardingWasOpen && !onboardingDialog.open) showOnboarding(true);
    }
    if (onboardingDialog.open) {
        onboardingTrigger = event.matches ? mobileEditorInfo : desktopInfo;
        renderOnboarding();
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
async function renderPaletteSwatches(id) {
    paletteSwatches.innerHTML = '';
    const result = await engine.getPalette(id);
    const colors = new Uint8Array(result.colors);
    for (let i = 0; i < 8; i++) {
        const div = document.createElement('div');
        div.className = 'palette-swatch';
        div.style.backgroundColor = `rgb(${colors[i * 3]}, ${colors[i * 3 + 1]}, ${colors[i * 3 + 2]})`;
        paletteSwatches.appendChild(div);
    }
}

// Real-time palette preview on the image
// Adjustments are passed as floats directly to Wasm — no JS canvas roundtrip
async function renderPalettePreview(paletteId) {
    if (!selectedFileBuffer || !wasmInitialized) return;
    try {
        const maxDim = parseInt(qualitySelect.value, 10);
        const [exp, con, sat, hue, tmp] = getAdjFloats();

        const preview = await engine.preview({
            maxDimension: maxDim,
            paletteId,
            exposure: exp,
            contrast: con,
            saturation: sat,
            hue,
            temperature: tmp,
        });
        if (!preview) return;
        const rgba = new Uint8ClampedArray(preview.rgba);
        const w = preview.width;
        const h = preview.height;
        const actualPaletteId = preview.paletteId;
        lastAutoPaletteId = actualPaletteId;

        if (paletteAutoMode) {
             await renderPaletteSwatches(actualPaletteId);
             paletteModeLabel.textContent = t('palette.match', { id: actualPaletteId });
        }
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
        const imageData = new ImageData(rgba, w, h);
        ctx.putImageData(imageData, 0, 0);

        // Show canvas, hide original img
        imagePreview.style.display = 'none';
        if (!previewCanvas.parentElement) {
            previewFrame.appendChild(previewCanvas);
        }
        previewCanvas.style.display = 'block';
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
        refreshPaletteLabel();
    } else {
        paletteBtnAuto.classList.remove('active');
        paletteBtnManual.classList.add('active');
        paletteBtnAuto.setAttribute('aria-pressed', 'false');
        paletteBtnManual.setAttribute('aria-pressed', 'true');
        paletteModeLabel.textContent = t('palette.manualStatus', { id: currentPaletteId });
    }
    // Always render dithered preview when image is loaded
    if (selectedFileBuffer && wasmInitialized) {
        renderPalettePreview(effectiveId);
    }
    paletteSwatches.classList.add('active');
    if (!paletteAutoMode) {
        void renderPaletteSwatches(effectiveId);
    }
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

// Save the dithered preview canvas as PNG (without sharing)
savePreviewBtn.addEventListener('click', () => {
    const previewCanvas = document.getElementById('palette-preview-canvas');
    saveCanvasAsUpscaledPng(previewCanvas, 'nanoglyph-preview.png', () => {
        savePreviewBtn.dataset.temporaryState = 'saved';
        savePreviewBtn.textContent = t('action.saved');
        setTimeout(() => {
            delete savePreviewBtn.dataset.temporaryState;
            savePreviewBtn.textContent = t('action.savePng');
        }, 2000);
    });
});

async function bootstrap() {
    try {
        await engine.ready;
        wasmInitialized = true;
        console.log(`NanoGlyph ${__NANOGLYPH_VERSION__} worker initialized.`);

        if (selectedFileBuffer) {
            encodeBtn.disabled = false;
            updatePaletteUI();
        }
        // Request persistent storage as specified
        if (navigator.storage && navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            console.log(`Persistent storage ${granted ? 'granted' : 'denied'}.`);
        }

        const routedLaunchUrl = await initializePlatform();
        if (!routedLaunchUrl) checkHash();
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
            setDecoderStatus('decoder.loading');
            return;
        }

        // Handle chunked links: format is /<index>-<total>/<chunk_data>
        if (hash.startsWith('/')) {
            const withoutLeadingSlash = hash.substring(1);
            const slashIdx = withoutLeadingSlash.indexOf('/');
            if (slashIdx !== -1) {
                const meta = withoutLeadingSlash.substring(0, slashIdx).split('-');
                if (meta.length === 2) {
                    const chunkData = withoutLeadingSlash.substring(slashIdx + 1);
                    const parsed = parseChunkMetadata(meta[0], meta[1], chunkData);
                    if (!parsed) {
                        setDecoderStatus('decoder.invalidLink');
                        return;
                    }
                    const { index, total } = parsed;

                    try {
                        localStorage.setItem(`ng_chunk_${index}_${total}`, chunkData);
                    } catch (error) {
                        console.warn('Could not store NanoGlyph chunk:', error);
                        setDecoderStatus('decoder.storeFailed');
                        return;
                    }

                    // Check if we have all chunks
                    const collected = collectChunkPayload(
                        total,
                        part => localStorage.getItem(`ng_chunk_${part}_${total}`),
                    );

                    if (collected.status === 'missing') {
                        setDecoderStatus('decoder.waiting', { index, total });
                        decodedCanvas.classList.add('hidden');
                        return;
                    }

                    for (let i = 1; i <= total; i++) {
                        localStorage.removeItem(`ng_chunk_${i}_${total}`);
                    }
                    if (collected.status === 'oversized') {
                        setDecoderStatus('decoder.invalidPayload');
                        return;
                    }

                    setDecoderStatus('decoder.allReceived');
                    decodeAndRender(collected.payload);
                    return;
                }
            }
        }

        // Single payload
        if (hash.length > MAX_NANOGLYPH_PAYLOAD_LENGTH || !/^[0-9A-Za-z]+$/.test(hash)) {
            setDecoderStatus('decoder.invalidPayload');
            return;
        }
        setDecoderStatus('decoder.decoding');
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

async function decodeAndRender(base62Str) {
    try {
        const decoded = await engine.decode(base62Str);
        const rgba = new Uint8ClampedArray(decoded.rgba);
        const width = decoded.width;
        const height = decoded.height;
        const frameCount = decoded.frameCount;

        if (!width || !height || width === 0 || height === 0) {
            setDecoderStatus('decoder.zeroDimensions');
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
            const imageData = new ImageData(rgba, width, height);
            ctx.putImageData(imageData, 0, 0);
        }

        decoderStatus.classList.add('hidden');
        savePngBtn.classList.remove('hidden');
    } catch (e) {
        console.error("Failed to decode:", e);
        setDecoderStatus('decoder.failed');
        decoderStatus.classList.remove('hidden');
    }
}

// Save decoded image as PNG
savePngBtn.addEventListener('click', () => {
    saveCanvasAsUpscaledPng(decodedCanvas, 'nanoglyph-image.png', () => {
        savePngBtn.dataset.temporaryState = 'saved';
        savePngBtn.textContent = t('action.saved');
        setTimeout(() => {
            delete savePngBtn.dataset.temporaryState;
            savePngBtn.textContent = t('action.savePng');
        }, 2000);
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
    imageGeneration++;
    void engine.disposeImage().catch(error => console.warn('Image disposal failed:', error));
    selectedFileBuffer = null;
    if (currentPreviewObjectUrl) URL.revokeObjectURL(currentPreviewObjectUrl);
    currentPreviewObjectUrl = null;
    imagePreview.removeAttribute('src');
    imagePreview.style.display = 'none';
    document.getElementById('palette-preview-canvas')?.style.setProperty('display', 'none');
    previewContainer.classList.add('hidden');
    [settingsContainer, paletteContainer, transformContainer, adjustmentsContainer, platformContainer]
        .forEach(node => node.classList.add('hidden'));
    savePreviewBtn.classList.add('hidden');
    encodeBtn.disabled = true;
}

function setEncodingUi(isEncoding) {
    appRoot.classList.toggle('is-encoding', isEncoding);
    mobileEditor.classList.toggle('is-encoding', isEncoding);
    encodeBtn.disabled = isEncoding || !selectedFileBuffer;

    if (isEncoding) {
        encodeBtn.setAttribute('aria-busy', 'true');
        encodeBtn.querySelector('.btn-label').textContent = t('action.encoding');
        encodeBtn.lastElementChild.textContent = '•••';
    } else {
        encodeBtn.removeAttribute('aria-busy');
        encodeBtn.querySelector('.btn-label').textContent = t('action.encode');
        encodeBtn.lastElementChild.textContent = '→';
    }
}

function resetEditorOptions() {
    qualitySelect.value = '128';
    [warningHigh, warningZen, warningCosmic].forEach(node => node?.classList.add('hidden'));
    paletteAutoMode = true;
    currentPaletteId = -1;
    lastAutoPaletteId = 0;
    resetAllAdjustments();
    resetTransform();
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
    setEncodingUi(false);
    updatePaletteUI();
    syncMobilePageValue();
}

function resetProject() {
    clearCurrentImage();
    resetEditorOptions();
    resultContainer.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    setMobileInputStatus();
    activeMobilePage = 0;
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
        setMobileInputStatus('status.unsupported');
        if (!mobileEditorMedia.matches) alert(t('error.selectImage'));
        return;
    }
    if (file.size > 32 * 1024 * 1024) {
        setMobileInputStatus('status.tooLarge');
        if (!mobileEditorMedia.matches) alert(t('error.imageTooLarge'));
        return;
    }

    const needsConversion = isHeifFormat(file);
    clearCurrentImage();
    resetEditorOptions();
    encodeBtn.disabled = true;
    resultContainer.classList.add('hidden');
    setMobileInputStatus(needsConversion ? 'status.converting' : 'status.reading');
    mobileInputStatus.classList.remove('hidden');
    if (mobileEditor.open) showMobilePage(0);

    try {
        const browserReadyBlob = needsConversion ? await convertHeifToJpeg(file) : file;
        const arrayBuffer = await browserReadyBlob.arrayBuffer();
        await wasmReadyPromise;
        if (!wasmInitialized) throw new Error('The local image engine could not be initialized.');
        await initImageSession(new Uint8Array(arrayBuffer));

        if (currentPreviewObjectUrl) URL.revokeObjectURL(currentPreviewObjectUrl);
        currentPreviewObjectUrl = URL.createObjectURL(browserReadyBlob);
        imagePreview.src = currentPreviewObjectUrl;
        imagePreview.style.display = 'block';
        const previousPreview = document.getElementById('palette-preview-canvas');
        if (previousPreview) previousPreview.style.display = 'none';
        previewContainer.classList.remove('hidden');
        settingsContainer.classList.remove('hidden');
        transformContainer.classList.remove('hidden');
        adjustmentsContainer.classList.remove('hidden');
        platformContainer.classList.remove('hidden');
        paletteContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        savePreviewBtn.classList.remove('hidden');
        syncAdjustmentUI();
        syncTransformUI();
        setMobileInputStatus(
            needsConversion ? 'status.converted' : 'status.fileReady',
            needsConversion ? {} : { filename: file.name || t('hero.title') },
        );
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
        const detailKey = needsConversion ? 'status.conversionFailed' : 'status.decodeFailed';
        setMobileInputStatus(detailKey);
        dropZone.classList.remove('hidden');
        if (mobileEditor.open) showMobilePage(0);
        if (!mobileEditorMedia.matches) alert(t(detailKey));
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
    if (!selectedFileBuffer) return;
    const encodingGeneration = imageGeneration;
    const encodingIsCurrent = () =>
        encodingGeneration === imageGeneration && Boolean(selectedFileBuffer);

    try {
        setEncodingUi(true);
        resultContainer.classList.add('hidden');

        // Give the stepped dither overlay one full paint before the synchronous Wasm work begins.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!encodingIsCurrent()) return;

        const maxDimension = parseInt(qualitySelect.value, 10);
        // Get adjustment values (floats)
        const [exp, con, sat, hue, tmp] = getAdjFloats();

        // Encode directly with Wasm, passing the adjustment values
        const encoded = await engine.encode({
            maxDimension,
            paletteId: paletteAutoMode ? null : currentPaletteId,
            exposure: exp,
            contrast: con,
            saturation: sat,
            hue,
            temperature: tmp,
        });
        if (!encodingIsCurrent()) return;
        const base62Str = encoded.base62;

        const baseUrl = CANONICAL_APP_URL;
        const platformLimit = Math.min(getChunkLimit(), BROWSER_URL_MAX);
        // For single links the overhead is just baseUrl + "#" (1 char less)
        const singleUrlOverhead = baseUrl.length + 1;

        if (base62Str.length > MAX_NANOGLYPH_PAYLOAD_LENGTH) {
            throw new RangeError('Encoded payload exceeds the 8 MiB NanoGlyph link limit.');
        }

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
            const chunks = splitPayloadIntoChunks(base62Str, baseUrl, platformLimit);
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
            info.dataset.i18nKey = 'result.parts';
            info.dataset.i18nTotal = String(total);
            info.textContent = t('result.parts', { total });
            chunkButtons.appendChild(info);

            const list = document.createElement('div');
            list.className = 'chunk-buttons-list';

            chunks.forEach((chunk, idx) => {
                const chunkUrl = `${baseUrl}#/${idx + 1}-${total}/${chunk}`;

                const row = document.createElement('div');
                row.className = 'chunk-btn-row';

                const shareChunkBtn = document.createElement('button');
                shareChunkBtn.className = 'btn secondary';
                shareChunkBtn.dataset.i18nKey = 'result.sharePart';
                shareChunkBtn.dataset.i18nIndex = String(idx + 1);
                shareChunkBtn.textContent = t('result.sharePart', { index: idx + 1 });
                shareChunkBtn.addEventListener('click', async () => {
                    try {
                        const shared = await shareUrl(chunkUrl, t('share.dialogTitle'));
                        if (shared) return;
                    } catch (error) {
                        console.log('Share canceled or failed', error);
                    }
                    {
                        copyToClipboard(chunkUrl).then(() => {
                            shareChunkBtn.dataset.temporaryState = 'copied';
                            shareChunkBtn.textContent = t('result.copied');
                            setTimeout(() => {
                                delete shareChunkBtn.dataset.temporaryState;
                                shareChunkBtn.textContent = t('result.sharePart', { index: idx + 1 });
                            }, 1500);
                        });
                    }
                });
                row.appendChild(shareChunkBtn);

                const copyChunkBtn = document.createElement('button');
                copyChunkBtn.className = 'btn outline';
                copyChunkBtn.dataset.i18nKey = 'result.copyPart';
                copyChunkBtn.dataset.i18nIndex = String(idx + 1);
                copyChunkBtn.textContent = t('result.copyPart', { index: idx + 1 });
                copyChunkBtn.addEventListener('click', () => {
                    copyToClipboard(chunkUrl).then(() => {
                        copyChunkBtn.dataset.temporaryState = 'copied';
                        copyChunkBtn.textContent = t('result.copied');
                        setTimeout(() => {
                            delete copyChunkBtn.dataset.temporaryState;
                            copyChunkBtn.textContent = t('result.copyPart', { index: idx + 1 });
                        }, 1500);
                    });
                });
                row.appendChild(copyChunkBtn);

                list.appendChild(row);
            });

            chunkButtons.appendChild(list);
            resultContainer.classList.remove('hidden');
        }

    } catch (e) {
        if (encodingGeneration !== imageGeneration) return;
        console.error("Encoding error:", e);
        alert(t('error.encode'));
    } finally {
        if (encodingGeneration === imageGeneration) {
            setEncodingUi(false);
        }

        if (
            encodingGeneration === imageGeneration
            && !resultContainer.classList.contains('hidden')
        ) {
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

    try {
        const shared = await shareUrl(firstUrl, t('share.dialogTitle'));
        if (shared) return;
    } catch (e) {
        console.log('Share canceled or failed', e);
        return;
    }
    {
        // Fallback: copy URL to clipboard
        copyToClipboard(firstUrl).then(() => {
            shareBtn.dataset.temporaryState = 'copied';
            shareBtn.textContent = t('result.linkCopied');
            setTimeout(() => {
                delete shareBtn.dataset.temporaryState;
                shareBtn.textContent = t('result.share');
            }, 2000);
        }).catch(() => {
            // Last resort: prompt with the URL
            prompt(t('prompt.copy'), firstUrl);
        });
    }
});

copyBtn.addEventListener('click', () => {
    copyToClipboard(urlBox.textContent)
        .then(() => {
            copyBtn.dataset.temporaryState = 'copied';
            copyBtn.textContent = t('result.copied');
            setTimeout(() => {
                delete copyBtn.dataset.temporaryState;
                copyBtn.textContent = t('result.copy');
            }, 2000);
        })
        .catch(err => {
            console.error('Failed to copy text: ', err);
            alert(t('error.copy'));
        });
});

onLocaleChange(() => {
    if (decoderStatusState) {
        decoderStatus.textContent = t(decoderStatusState.key, decoderStatusState.params);
    }
    if (mobileInputStatusState) {
        mobileInputStatus.textContent = t(mobileInputStatusState.key, mobileInputStatusState.params);
    }
    if (onboardingDialog.open) renderOnboarding();
    if (mobileEditor.open) showMobilePage(activeMobilePage);

    const adjustmentState = hasAdjustments(getAdjustments());
    adjustmentsBadge.textContent = t(adjustmentState ? 'adjustments.modified' : 'adjustments.default');
    syncTransformUI();
    refreshPaletteLabel();

    chunkButtons.querySelectorAll('[data-i18n-key]').forEach(element => {
        if (element.dataset.temporaryState === 'copied') {
            element.textContent = t('result.copied');
            return;
        }
        const params = {};
        if (element.dataset.i18nIndex) params.index = element.dataset.i18nIndex;
        if (element.dataset.i18nTotal) params.total = element.dataset.i18nTotal;
        element.textContent = t(element.dataset.i18nKey, params);
    });

    if (appRoot.classList.contains('is-encoding')) {
        encodeBtn.querySelector('.btn-label').textContent = t('action.encoding');
    }
    if (shareBtn.dataset.temporaryState === 'copied') shareBtn.textContent = t('result.linkCopied');
    if (copyBtn.dataset.temporaryState === 'copied') copyBtn.textContent = t('result.copied');
    [savePreviewBtn, savePngBtn].forEach(button => {
        if (button.dataset.temporaryState === 'saved') button.textContent = t('action.saved');
    });
});

resetBtn.addEventListener('click', () => {
    resetProject();
    window.location.hash = '';
});

// Clear cache & data
document.getElementById('clear-cache-btn').addEventListener('click', async () => {
    const confirmed = confirm(t('confirm.clearCache'));
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
        alert(t('error.clearCache'));
    }
});

// Initialize the creator workflow and its first-run introduction.
if (window.location.hash.length <= 1) {
    if (mobileEditorMedia.matches) openMobileEditor(0);
    else showOnboarding(false);
}
wasmReadyPromise = bootstrap();
