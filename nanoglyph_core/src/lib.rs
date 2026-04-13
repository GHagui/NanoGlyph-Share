use wasm_bindgen::prelude::*;

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
