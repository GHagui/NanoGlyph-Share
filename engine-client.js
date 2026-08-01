export class NanoGlyphEngine {
  constructor() {
    this.worker = new Worker('./wasm-worker.js', { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.previewGeneration = 0;
    this.previewRunning = false;
    this.queuedPreview = null;
    this.worker.addEventListener('message', event => this.handleMessage(event.data));
    this.worker.addEventListener('error', error => this.handleWorkerError(error));
    this.ready = this.call('init');
  }

  handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'NanoGlyph worker operation failed.'));
  }

  handleWorkerError(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  call(operation, payload = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, operation, payload }, transfer);
    });
  }

  async loadImage(buffer) {
    await this.ready;
    return this.call('loadImage', { buffer }, [buffer]);
  }

  async setTransform(rotationQuarterTurns, flipHorizontal, flipVertical) {
    await this.ready;
    return this.call('setTransform', {
      rotationQuarterTurns,
      flipHorizontal,
      flipVertical,
    });
  }

  preview(options) {
    const generation = ++this.previewGeneration;
    if (this.queuedPreview) this.queuedPreview.resolve(null);

    const result = new Promise((resolve, reject) => {
      this.queuedPreview = { generation, options, resolve, reject };
    });
    void this.runPreviewLoop();
    return result;
  }

  async runPreviewLoop() {
    if (this.previewRunning) return;
    this.previewRunning = true;
    try {
      await this.ready;
      while (this.queuedPreview) {
        const current = this.queuedPreview;
        this.queuedPreview = null;
        try {
          const result = await this.call('preview', current.options);
          current.resolve(
            current.generation === this.previewGeneration ? result : null,
          );
        } catch (error) {
          current.reject(error);
        }
      }
    } finally {
      this.previewRunning = false;
      if (this.queuedPreview) void this.runPreviewLoop();
    }
  }

  async encode(options) {
    await this.ready;
    return this.call('encode', options);
  }

  async decode(base62) {
    await this.ready;
    return this.call('decode', { base62 });
  }

  async getPalette(paletteId) {
    await this.ready;
    return this.call('getPalette', { paletteId });
  }

  async disposeImage() {
    this.previewGeneration++;
    if (this.queuedPreview) this.queuedPreview.resolve(null);
    this.queuedPreview = null;
    await this.ready;
    return this.call('disposeImage');
  }
}
