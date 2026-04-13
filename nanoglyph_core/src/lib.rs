pub mod pixel_data;
pub mod palette;
pub mod encoder;
pub mod decoder;
pub mod session;

use encoder::ImageAdj;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ImageSession {
    inner: session::CoreSession,
}

#[wasm_bindgen]
impl ImageSession {
    #[wasm_bindgen(constructor)]
    pub fn new(img_data: &[u8]) -> Result<ImageSession, JsValue> {
        let inner = session::CoreSession::new(img_data).map_err(|e| JsValue::from_str(&e))?;
        Ok(ImageSession { inner })
    }

    pub fn preview(
        &mut self,
        max_dimension: u32,
        palette_id: u8,
        exposure: f32, contrast: f32, saturation: f32, hue: f32, temperature: f32,
    ) -> Result<PreviewImage, JsValue> {
        let adj = ImageAdj { exposure, contrast, saturation, hue, temperature };
        self.inner.preview(max_dimension, palette_id, &adj)
            .map(|(width, height, rgba, actual_palette_id)| PreviewImage { width, height, rgba, palette_id: actual_palette_id })
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn encode_auto(
        &mut self,
        max_dimension: u32,
        use_brotli: bool,
        exposure: f32, contrast: f32, saturation: f32, hue: f32, temperature: f32,
    ) -> Result<String, JsValue> {
        let adj = ImageAdj { exposure, contrast, saturation, hue, temperature };
        self.inner.encode(max_dimension, None, use_brotli, &adj)
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn encode_with_palette(
        &mut self,
        max_dimension: u32,
        palette_id: u8,
        use_brotli: bool,
        exposure: f32, contrast: f32, saturation: f32, hue: f32, temperature: f32,
    ) -> Result<String, JsValue> {
        let adj = ImageAdj { exposure, contrast, saturation, hue, temperature };
        self.inner.encode(max_dimension, Some(palette_id), use_brotli, &adj)
            .map_err(|e| JsValue::from_str(&e))
    }
}

/// Returns a flat array of 24 bytes (8 colors × 3 RGB bytes) for the given palette ID (0-98)
#[wasm_bindgen]
pub fn get_palette_colors(palette_id: u8) -> Vec<u8> {
    let pal = palette::get_palette(palette_id);
    let mut flat = Vec::with_capacity(24);
    for c in &pal {
        flat.push(c[0]);
        flat.push(c[1]);
        flat.push(c[2]);
    }
    flat
}

#[wasm_bindgen]
pub struct PreviewImage {
    pub width: u32,
    pub height: u32,
    pub palette_id: u8,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl PreviewImage {
    pub fn get_rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

#[wasm_bindgen]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub frame_count: u8,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl DecodedImage {
    pub fn get_rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

#[wasm_bindgen]
pub fn decode_base62_to_image(base62_str: &str) -> Result<DecodedImage, JsValue> {
    decoder::decode_base62_to_rgba(base62_str)
        .map(|(width, height, frame_count, rgba)| DecodedImage { width, height, frame_count, rgba })
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Flags {
    pub is_animation: bool,
    pub frame_count: u8,
}

impl Flags {
    pub fn to_u8(&self) -> u8 {
        let mut bits = 0u8;
        if self.is_animation {
            bits |= 1;
        }
        // frame_count uses bits 1-3 (max value is 5, fits in 3 bits)
        // ensure it doesn't overflow 3 bits (0b111)
        bits |= (self.frame_count & 0b111) << 1;
        bits
    }

    pub fn from_u8(val: u8) -> Self {
        let is_animation = (val & 1) != 0;
        let frame_count = (val >> 1) & 0b111;
        Self {
            is_animation,
            frame_count,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NanoGlyphHeader {
    pub version: u8,
    pub width: u16,
    pub height: u16,
    pub palette_id: u8,
    pub flags: Flags,
}

impl NanoGlyphHeader {
    pub fn new(width: u16, height: u16, palette_id: u8, is_animation: bool, frame_count: u8) -> Self {
        Self {
            version: 1,
            width,
            height,
            palette_id,
            flags: Flags {
                is_animation,
                frame_count,
            },
        }
    }

    pub fn to_bytes(&self) -> [u8; 7] {
        let w = self.width.to_le_bytes();
        let h = self.height.to_le_bytes();
        [
            self.version,
            w[0], w[1],
            h[0], h[1],
            self.palette_id,
            self.flags.to_u8(),
        ]
    }

    pub fn from_bytes(bytes: &[u8; 7]) -> Self {
        let width = u16::from_le_bytes([bytes[1], bytes[2]]);
        let height = u16::from_le_bytes([bytes[3], bytes[4]]);
        Self {
            version: bytes[0],
            width,
            height,
            palette_id: bytes[5],
            flags: Flags::from_u8(bytes[6]),
        }
    }
}

#[wasm_bindgen]
pub struct NanoGlyphPayload {
    header: NanoGlyphHeader,
    packed_pixels: Vec<u8>,
}

#[wasm_bindgen]
impl NanoGlyphPayload {
    #[wasm_bindgen(constructor)]
    pub fn new(header: NanoGlyphHeader, packed_pixels: Vec<u8>) -> Self {
        Self { header, packed_pixels }
    }

    pub fn to_binary(&self) -> Vec<u8> {
        let mut binary = Vec::with_capacity(7 + self.packed_pixels.len());
        binary.extend_from_slice(&self.header.to_bytes());
        binary.extend_from_slice(&self.packed_pixels);
        binary
    }

    pub fn from_binary(binary: &[u8]) -> Result<NanoGlyphPayload, JsValue> {
        if binary.len() < 7 {
            return Err(JsValue::from_str("Payload too short for header"));
        }
        let mut header_bytes = [0u8; 7];
        header_bytes.copy_from_slice(&binary[0..7]);
        let header = NanoGlyphHeader::from_bytes(&header_bytes);
        let packed_pixels = binary[7..].to_vec();
        
        Ok(Self {
            header,
            packed_pixels,
        })
    }
    
    pub fn get_header(&self) -> NanoGlyphHeader {
        self.header
    }
    
    pub fn get_packed_pixels(&self) -> Vec<u8> {
        self.packed_pixels.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flags_serialization() {
        let flags = Flags {
            is_animation: true,
            frame_count: 5,
        };
        let val = flags.to_u8();
        // is_animation = 1
        // frame_count = 5 (0b101) << 1 = 10 (0b1010)
        // total = 11 (0b1011)
        assert_eq!(val, 11);

        let parsed = Flags::from_u8(val);
        assert_eq!(parsed, flags);
    }

    #[test]
    fn test_header_serialization() {
        let header = NanoGlyphHeader::new(128, 128, 42, false, 0);
        let bytes = header.to_bytes();
        assert_eq!(bytes, [1, 128, 0, 128, 0, 42, 0]);

        let parsed = NanoGlyphHeader::from_bytes(&bytes);
        assert_eq!(parsed, header);
    }

    #[test]
    fn test_header_serialization_animated() {
        let header = NanoGlyphHeader::new(64, 64, 98, true, 3);
        let bytes = header.to_bytes();
        // flags: is_animation (1) | (3 << 1) (6) = 7
        assert_eq!(bytes, [1, 64, 0, 64, 0, 98, 7]);

        let parsed = NanoGlyphHeader::from_bytes(&bytes);
        assert_eq!(parsed, header);
    }

    #[test]
    fn test_header_serialization_large() {
        let header = NanoGlyphHeader::new(512, 384, 5, false, 0);
        let bytes = header.to_bytes();
        let parsed = NanoGlyphHeader::from_bytes(&bytes);
        assert_eq!(parsed.width, 512);
        assert_eq!(parsed.height, 384);
        assert_eq!(parsed, header);
    }
}

