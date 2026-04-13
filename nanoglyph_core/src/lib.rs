pub mod pixel_data;
pub mod palette;
pub mod encoder;
pub mod decoder;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn encode_image_to_base62(img_data: &[u8], max_dimension: u32) -> Result<String, JsValue> {
    encoder::encode_image(img_data, max_dimension).map_err(|e| JsValue::from_str(&e))
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
    pub width: u8,
    pub height: u8,
    pub palette_id: u8,
    pub flags: Flags,
}

impl NanoGlyphHeader {
    pub fn new(width: u8, height: u8, palette_id: u8, is_animation: bool, frame_count: u8) -> Self {
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

    pub fn to_bytes(&self) -> [u8; 5] {
        [
            self.version,
            self.width,
            self.height,
            self.palette_id,
            self.flags.to_u8(),
        ]
    }

    pub fn from_bytes(bytes: &[u8; 5]) -> Self {
        Self {
            version: bytes[0],
            width: bytes[1],
            height: bytes[2],
            palette_id: bytes[3],
            flags: Flags::from_u8(bytes[4]),
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
        let mut binary = Vec::with_capacity(5 + self.packed_pixels.len());
        binary.extend_from_slice(&self.header.to_bytes());
        binary.extend_from_slice(&self.packed_pixels);
        binary
    }

    pub fn from_binary(binary: &[u8]) -> Result<NanoGlyphPayload, JsValue> {
        if binary.len() < 5 {
            return Err(JsValue::from_str("Payload too short for header"));
        }
        let mut header_bytes = [0u8; 5];
        header_bytes.copy_from_slice(&binary[0..5]);
        let header = NanoGlyphHeader::from_bytes(&header_bytes);
        let packed_pixels = binary[5..].to_vec();
        
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
        assert_eq!(bytes, [1, 128, 128, 42, 0]);

        let parsed = NanoGlyphHeader::from_bytes(&bytes);
        assert_eq!(parsed, header);
    }

    #[test]
    fn test_header_serialization_animated() {
        let header = NanoGlyphHeader::new(64, 64, 98, true, 3);
        let bytes = header.to_bytes();
        // flags: is_animation (1) | (3 << 1) (6) = 7
        assert_eq!(bytes, [1, 64, 64, 98, 7]);

        let parsed = NanoGlyphHeader::from_bytes(&bytes);
        assert_eq!(parsed, header);
    }
}
