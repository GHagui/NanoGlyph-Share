use flate2::read::ZlibDecoder;
use num_bigint::BigUint;
use std::io::Read;

use crate::palette::get_palette;
use crate::pixel_data::unpack_pixels;
use crate::NanoGlyphPayload;

const MAX_BASE62_BYTES: usize = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES: usize = 16 * 1024 * 1024;
const MAX_RGBA_BYTES: usize = 32 * 1024 * 1024;

pub fn decode_base62_to_rgba(base62_str: &str) -> Result<(u32, u32, u8, Vec<u8>), String> {
    if base62_str.is_empty() {
        return Err("Empty payload — did you copy the full link?".to_string());
    }
    if base62_str.len() > MAX_BASE62_BYTES {
        return Err("Payload exceeds the safe NanoGlyph link limit.".to_string());
    }

    // 1. Base62 Decode
    let compressed_binary = base62_decode(base62_str).map_err(|e| {
        format!(
            "Invalid URL characters — link may be corrupted or truncated. ({})",
            e
        )
    })?;

    if compressed_binary.is_empty() {
        return Err("Payload decoded to empty data — link appears to be corrupted.".to_string());
    }

    // 2. Decompress based on magic byte
    let binary = match compressed_binary[0] {
        0x5A => {
            // CODEC_ZLIB ('Z')
            read_limited(
                ZlibDecoder::new(&compressed_binary[1..]),
                "Zlib decompression failed — link may be truncated or partially copied.",
            )?
        }
        0x42 => {
            // CODEC_BROTLI ('B')
            read_limited(
                brotli::Decompressor::new(&compressed_binary[1..], 4096),
                "Brotli decompression failed — link may be truncated or partially copied.",
            )?
        }
        _ => {
            // Backward compatibility for old links that didn't have a magic byte (defaults to Zlib)
            read_limited(
                ZlibDecoder::new(&compressed_binary[..]),
                "Backward-compatible decompression failed — link may be corrupted.",
            )?
        }
    };

    // 3. Deserialize Header and Payload
    let payload = NanoGlyphPayload::from_binary(&binary).map_err(|_| {
        "Header is missing or too short — this does not look like a NanoGlyph link.".to_string()
    })?;

    let header = payload.get_header();

    // Sanity-check dimensions
    if header.width == 0 || header.height == 0 {
        return Err("Image has zero dimensions — link is likely corrupted.".to_string());
    }
    if header.width > 2048 || header.height > 2048 {
        return Err(format!(
            "Unrealistic image dimensions ({}×{}) — link is likely corrupted.",
            header.width, header.height
        ));
    }
    if header.palette_id >= 99 {
        return Err("Palette identifier is outside the supported range.".to_string());
    }

    let frame_count = if header.flags.is_animation {
        header.flags.frame_count.max(1)
    } else {
        1
    };
    if frame_count > 5 {
        return Err("Animation contains more than five frames.".to_string());
    }
    let num_pixels_per_frame = (header.width as usize)
        .checked_mul(header.height as usize)
        .ok_or_else(|| "Image dimensions overflow the decoder.".to_string())?;
    let total_pixels = num_pixels_per_frame
        .checked_mul(frame_count as usize)
        .ok_or_else(|| "Animation dimensions overflow the decoder.".to_string())?;
    let rgba_bytes = total_pixels
        .checked_mul(4)
        .ok_or_else(|| "Decoded image size overflow.".to_string())?;
    if rgba_bytes > MAX_RGBA_BYTES {
        return Err("Decoded image exceeds the 32 MiB safety budget.".to_string());
    }

    let rle_pixels = payload.get_packed_pixels();

    // 4. RLE Decode
    let expected_packed_bytes = total_pixels
        .checked_mul(3)
        .and_then(|bits| bits.checked_add(7))
        .map(|bits| bits / 8)
        .ok_or_else(|| "Packed image size overflow.".to_string())?;
    let packed_pixels = rle_decode_limited(&rle_pixels, expected_packed_bytes)?;

    // 5. Unpack Pixels (3 bits to 8 bits)
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

fn read_limited<R: Read>(reader: R, error_message: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .take((MAX_DECOMPRESSED_BYTES + 1) as u64)
        .read_to_end(&mut output)
        .map_err(|_| error_message.to_string())?;
    if output.len() > MAX_DECOMPRESSED_BYTES {
        return Err("Decompressed payload exceeds the 16 MiB safety limit.".to_string());
    }
    Ok(output)
}

fn base62_decode(input: &str) -> Result<Vec<u8>, String> {
    const CHUNK_DIGITS: usize = 10;

    let leading_zeroes = input.bytes().take_while(|&byte| byte == b'0').count();
    let mut num = BigUint::from(0u32);
    for chunk in input.as_bytes()[leading_zeroes..].chunks(CHUNK_DIGITS) {
        let mut chunk_value = 0u64;
        let mut chunk_radix = 1u64;
        for &byte in chunk {
            let value = match byte {
                b'0'..=b'9' => (byte - b'0') as u64,
                b'A'..=b'Z' => (byte - b'A' + 10) as u64,
                b'a'..=b'z' => (byte - b'a' + 36) as u64,
                _ => return Err(format!("Invalid base62 char: {}", byte as char)),
            };
            chunk_value = chunk_value * 62 + value;
            chunk_radix *= 62;
        }
        num = num * BigUint::from(chunk_radix) + BigUint::from(chunk_value);
    }

    let mut bytes = num.to_bytes_be();
    if leading_zeroes > 0 {
        let mut padded = vec![0u8; leading_zeroes];
        padded.extend_from_slice(&bytes);
        bytes = padded;
    }

    Ok(bytes)
}

/// Public wrapper for testing
#[cfg(test)]
pub(crate) fn base62_decode_pub(input: &str) -> Result<Vec<u8>, String> {
    base62_decode(input)
}

#[cfg(test)]
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

fn rle_decode_limited(data: &[u8], maximum: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(maximum.min(data.len()));
    for pair in data.chunks_exact(2) {
        let count = pair[0] as usize;
        let new_len = output
            .len()
            .checked_add(count)
            .ok_or_else(|| "RLE output size overflow.".to_string())?;
        if new_len > maximum {
            return Err("RLE payload exceeds the expected image size.".to_string());
        }
        output.resize(new_len, pair[1]);
    }
    Ok(output)
}

/// Public wrapper for testing
#[cfg(test)]
pub(crate) fn rle_decode_pub(data: &[u8]) -> Vec<u8> {
    rle_decode(data)
}
