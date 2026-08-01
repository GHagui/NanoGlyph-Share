import init, {
  ImageSession,
  decode_base62_to_image,
  get_palette_colors,
} from './nanoglyph_core/pkg/nanoglyph_core.js';

let session = null;
let initialized = null;

function ensureInitialized() {
  if (!initialized) initialized = init();
  return initialized;
}

function requireSession() {
  if (!session) throw new Error('No image is loaded.');
  return session;
}

function postSuccess(id, result, transfer = []) {
  self.postMessage({ id, ok: true, result }, transfer);
}

function postFailure(id, error) {
  self.postMessage({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

self.addEventListener('message', async event => {
  const { id, operation, payload = {} } = event.data;
  try {
    await ensureInitialized();

    switch (operation) {
      case 'init':
        postSuccess(id, { ready: true });
        break;

      case 'loadImage': {
        session?.free();
        session = new ImageSession(new Uint8Array(payload.buffer));
        postSuccess(id, { loaded: true });
        break;
      }

      case 'setTransform':
        requireSession().set_transform(
          payload.rotationQuarterTurns,
          payload.flipHorizontal,
          payload.flipVertical,
        );
        postSuccess(id, { transformed: true });
        break;

      case 'preview': {
        const preview = requireSession().preview(
          payload.maxDimension,
          payload.paletteId,
          payload.exposure,
          payload.contrast,
          payload.saturation,
          payload.hue,
          payload.temperature,
        );
        const rgba = preview.take_rgba();
        const result = {
          width: preview.width,
          height: preview.height,
          paletteId: preview.palette_id,
          rgba: rgba.buffer,
        };
        preview.free();
        postSuccess(id, result, [result.rgba]);
        break;
      }

      case 'encode': {
        const args = [
          payload.maxDimension,
          payload.compressionMode,
          payload.exposure,
          payload.contrast,
          payload.saturation,
          payload.hue,
          payload.temperature,
        ];
        const base62 = payload.paletteId === null
          ? requireSession().encode_auto(...args)
          : requireSession().encode_with_palette(
            payload.maxDimension,
            payload.paletteId,
            payload.compressionMode,
            payload.exposure,
            payload.contrast,
            payload.saturation,
            payload.hue,
            payload.temperature,
          );
        postSuccess(id, { base62 });
        break;
      }

      case 'decode': {
        const decoded = decode_base62_to_image(payload.base62);
        const rgba = decoded.take_rgba();
        const result = {
          width: decoded.width,
          height: decoded.height,
          frameCount: decoded.frame_count,
          rgba: rgba.buffer,
        };
        decoded.free();
        postSuccess(id, result, [result.rgba]);
        break;
      }

      case 'getPalette': {
        const colors = get_palette_colors(payload.paletteId);
        const result = { colors: colors.buffer };
        postSuccess(id, result, [result.colors]);
        break;
      }

      case 'disposeImage':
        session?.free();
        session = null;
        postSuccess(id, { disposed: true });
        break;

      default:
        throw new Error(`Unknown worker operation: ${operation}`);
    }
  } catch (error) {
    postFailure(id, error);
  }
});
