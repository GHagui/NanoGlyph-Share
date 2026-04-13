use std::io::Read;
use flate2::read::ZlibDecoder;
use num_bigint::BigUint;

use crate::palette::get_palette;
use crate::NanoGlyphPayload;
use crate::pixel_data::unpack_pixels;

pub fn decode_base62_to_rgba(base62_str: &str) -> Result<(u32, u32, u8, Vec<u8>), String> {
    if base62_str.is_empty() {
        return Err("Empty payload — did you copy the full link?".to_string());
    }

    // 1. Base62 Decode
    let compressed_binary = base62_decode(base62_str)
        .map_err(|e| format!("Invalid URL characters — link may be corrupted or truncated. ({})", e))?;

    if compressed_binary.is_empty() {
        return Err("Payload decoded to empty data — link appears to be corrupted.".to_string());
    }

    // 2. Deflate Decompress
    let mut decoder = ZlibDecoder::new(&compressed_binary[..]);
    let mut binary = Vec::new();
    decoder.read_to_end(&mut binary)
        .map_err(|_| "Decompression failed — link may be truncated or partially copied. Make sure you received all parts.".to_string())?;

    // 3. Deserialize Header and Payload
    let payload = NanoGlyphPayload::from_binary(&binary)
        .map_err(|_| "Header is missing or too short — this does not look like a NanoGlyph link.".to_string())?;

    let header = payload.get_header();

    // Sanity-check dimensions
    if header.width == 0 || header.height == 0 {
        return Err("Image has zero dimensions — link is likely corrupted.".to_string());
    }
    if header.width > 2048 || header.height > 2048 {
        return Err(format!("Unrealistic image dimensions ({}×{}) — link is likely corrupted.", header.width, header.height));
    }

    let rle_pixels = payload.get_packed_pixels();

    // 4. RLE Decode
    let packed_pixels = rle_decode(&rle_pixels);

    // 5. Unpack Pixels (3 bits to 8 bits)
    let frame_count = if header.flags.is_animation { header.flags.frame_count.max(1) } else { 1 };
    let num_pixels_per_frame = (header.width as usize) * (header.height as usize);
    let total_pixels = num_pixels_per_frame * (frame_count as usize);

    let mut indices = unpack_pixels(&packed_pixels, total_pixels);

    // Guard: if we got fewer pixels than expected, pad with 0 (first palette color)
    // This is a best-effort render rather than a hard failure
    if indices.len() < total_pixels {
        indices.resize(total_pixels, 0);
    }

    // 6. Delta Decoding
    if frame_count > 1 {
        for f in 1..(frame_count as usize) {
            let offset_current = f * num_pixels_per_frame;
            let offset_prev = (f - 1) * num_pixels_per_frame;
            for i in 0..num_pixels_per_frame {
                let diff = indices[offset_current + i];
                let prev = indices[offset_prev + i];
                indices[offset_current + i] = (prev + diff) % 8;
            }
        }
    }

    // 7. Map to RGBA
    let palette = get_palette(header.palette_id);
    let mut rgba = Vec::with_capacity(total_pixels * 4);

    for idx in indices {
        let c = palette[(idx & 7) as usize]; // & 7 guarantees 0-7, never OOB
        rgba.push(c[0]);
        rgba.push(c[1]);
        rgba.push(c[2]);
        rgba.push(255); // Alpha
    }

    Ok((header.width as u32, header.height as u32, frame_count, rgba))
}

fn base62_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut num = BigUint::from(0u32);
    let base = BigUint::from(62u32);

    for c in input.chars() {
        let val = match c {
            '0'..='9' => c as u32 - '0' as u32,
            'A'..='Z' => c as u32 - 'A' as u32 + 10,
            'a'..='z' => c as u32 - 'a' as u32 + 36,
            _ => return Err(format!("Invalid base62 char: {}", c)),
        };
        num = num * &base + BigUint::from(val);
    }
    
    // Add leading zeros back if needed
    let mut zeros = 0;
    for c in input.chars() {
        if c == '0' {
            zeros += 1;
        } else {
            break;
        }
    }
    
    let mut bytes = num.to_bytes_be();
    if zeros > 0 {
        let mut padded = vec![0u8; zeros];
        padded.extend_from_slice(&bytes);
        bytes = padded;
    }
    
    Ok(bytes)
}

/// Public wrapper for testing
pub(crate) fn base62_decode_pub(input: &str) -> Result<Vec<u8>, String> {
    base62_decode(input)
}

fn rle_decode(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        if i + 1 >= data.len() {
            break;
        }
        let count = data[i] as usize;
        let val = data[i + 1];
        for _ in 0..count {
            out.push(val);
        }
        i += 2;
    }
    out
}

/// Public wrapper for testing
pub(crate) fn rle_decode_pub(data: &[u8]) -> Vec<u8> {
    rle_decode(data)
}