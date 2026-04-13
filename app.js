import init, { encode_image_to_base62, decode_base62_to_image } from './nanoglyph_core/pkg/nanoglyph_core.js';

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

let selectedFileBuffer = null;

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

    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        previewContainer.classList.remove('hidden');
        settingsContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        encodeBtn.disabled = !wasmInitialized;
    };
    reader.readAsDataURL(file);

    const arrayBufferReader = new FileReader();
    arrayBufferReader.onload = (e) => {
        selectedFileBuffer = new Uint8Array(e.target.result);
    };
    arrayBufferReader.readAsArrayBuffer(file);
}

const CHUNK_CHAR_LIMIT = 3000;

// Encoding Logic
encodeBtn.addEventListener('click', () => {
    if (!selectedFileBuffer) return;
    
    try {
        encodeBtn.disabled = true;
        encodeBtn.textContent = 'Encoding...';
        
        const maxDimension = parseInt(qualitySelect.value, 10);
        
        const base62Str = encode_image_to_base62(selectedFileBuffer, maxDimension);
        
        const baseUrl = window.location.origin + window.location.pathname;
        
        if (base62Str.length <= CHUNK_CHAR_LIMIT) {
            // Single link — fits within the limit
            const url = baseUrl + '#' + base62Str;
            urlBox.innerHTML = '';
            urlBox.textContent = url;
            resultContainer.classList.remove('hidden');
        } else {
            // Payload exceeds limit — split into chunks
            const chunks = [];
            for (let i = 0; i < base62Str.length; i += CHUNK_CHAR_LIMIT) {
                chunks.push(base62Str.substring(i, i + CHUNK_CHAR_LIMIT));
            }
            const total = chunks.length;
            
            urlBox.innerHTML = '';
            
            const info = document.createElement('p');
            info.style.color = 'var(--secondary-color)';
            info.style.marginBottom = '0.5rem';
            info.style.fontFamily = 'inherit';
            info.textContent = `Image split into ${total} links. Share all of them in order:`;
            urlBox.appendChild(info);
            
            chunks.forEach((chunk, idx) => {
                const chunkUrl = `${baseUrl}#/${idx + 1}-${total}/${chunk}`;
                
                const linkDiv = document.createElement('div');
                linkDiv.style.marginBottom = '0.75rem';
                
                const label = document.createElement('strong');
                label.style.color = 'var(--primary-color)';
                label.textContent = `Part ${idx + 1} of ${total}:`;
                linkDiv.appendChild(label);
                
                const urlText = document.createElement('div');
                urlText.style.wordBreak = 'break-all';
                urlText.style.fontSize = '0.8rem';
                urlText.style.marginTop = '0.25rem';
                urlText.textContent = chunkUrl;
                linkDiv.appendChild(urlText);
                
                const copyChunkBtn = document.createElement('button');
                copyChunkBtn.className = 'btn outline';
                copyChunkBtn.style.marginTop = '0.25rem';
                copyChunkBtn.style.padding = '0.4rem 0.8rem';
                copyChunkBtn.style.fontSize = '0.85rem';
                copyChunkBtn.textContent = `Copy Part ${idx + 1}`;
                copyChunkBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(chunkUrl).then(() => {
                        copyChunkBtn.textContent = 'Copied!';
                        setTimeout(() => { copyChunkBtn.textContent = `Copy Part ${idx + 1}`; }, 1500);
                    });
                });
                linkDiv.appendChild(copyChunkBtn);
                
                urlBox.appendChild(linkDiv);
            });
            
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
    
    if (navigator.share && navigator.canShare(shareData)) {
        try {
            await navigator.share(shareData);
        } catch (e) {
            console.log('Share canceled or failed', e);
        }
    } else {
        alert("Web Share API is not supported on your device/browser.");
    }
});

copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(urlBox.textContent)
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
