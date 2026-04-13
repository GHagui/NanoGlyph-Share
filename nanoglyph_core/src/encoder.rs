use image::{RgbaImage, imageops::FilterType, AnimationDecoder};
use std::io::Write;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use num_bigint::BigUint;
use num_integer::Integer;

use crate::pixel_data::pack_pixels;
use crate::palette::get_palette;
use crate::{NanoGlyphHeader, NanoGlyphPayload};

// Bayer 4x4 dither matrix, normalized to 0..64
const BAYER_4X4: [[u8; 4]; 4] = [
    [ 0, 32,  8, 40],
    [48, 16, 56, 24],
    [12, 44,  4, 36],
    [60, 28, 52, 20],
];

pub fn encode_image(img_data: &[u8], max_dimension: u32) -> Result<String, String> {
    let mut frames = Vec::new();
    
    // Try to load as GIF animation first
    if let Ok(decoder) = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(img_data)) {
        if let Ok(f) = decoder.into_frames().collect_frames() {
            for frame in f.into_iter().take(5) {
                frames.push(frame.into_buffer());
            }
        }
    }
    
    // Fallback to single image
    if frames.is_empty() {
        let img = image::load_from_memory(img_data).map_err(|e| e.to_string())?;
        frames.push(img.to_rgba8());
    }
    
    let is_animation = frames.len() > 1;
    let frame_count = frames.len() as u8;
    
    // 1. Resize all frames to match the first frame's resized dimensions
    let (width, height) = frames[0].dimensions();
    let mut resized_frames = Vec::new();
    
    let mut new_w = width;
    let mut new_h = height;
    
    if width > max_dimension || height > max_dimension {
        let ratio = max_dimension as f32 / width.max(height) as f32;
        new_w = (width as f32 * ratio).round() as u32;
        new_h = (height as f32 * ratio).round() as u32;
        new_w = new_w.max(1);
        new_h = new_h.max(1);
    }
    
    for frame in frames {
        let resized = image::imageops::resize(&frame, new_w, new_h, FilterType::Triangle);
        resized_frames.push(resized);
    }
    
    // 2. Select best palette (based on first frame)
    let best_palette_id = find_best_palette(&resized_frames[0]);
    let palette = get_palette(best_palette_id);
    
    // 3. Quantize all frames
    let mut all_indices = Vec::new();
    let mut prev_indices = Vec::new();
    
    for (i, frame) in resized_frames.iter().enumerate() {
        let indices = quantize_with_dither(frame, &palette);
        
        if i == 0 {
            all_indices.extend_from_slice(&indices);
            prev_indices = indices;
        } else {
            // Delta encoding: (current - prev + 8) % 8
            let mut delta_indices = Vec::with_capacity(indices.len());
            for j in 0..indices.len() {
                let diff = (indices[j] + 8 - prev_indices[j]) % 8;
                delta_indices.push(diff);
            }
            all_indices.extend_from_slice(&delta_indices);
            prev_indices = indices;
        }
    }
    
    // 4. Pack pixels
    let packed_pixels = pack_pixels(&all_indices);
    
    // 5. Create payload and compress
    let header = NanoGlyphHeader::new(new_w as u8, new_h as u8, best_palette_id, is_animation, frame_count);
    
    // Apply RLE to pixel data before deflation
    let rle_pixels = rle_encode(&packed_pixels);
    
    let payload = NanoGlyphPayload::new(header, rle_pixels);
    let binary = payload.to_binary();
    
    // Deflate compression
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&binary).map_err(|e| e.to_string())?;
    let compressed_binary = encoder.finish().map_err(|e| e.to_string())?;
    
    // 6. Base62 Encode
    let base62_str = base62_encode(&compressed_binary);
    
    Ok(base62_str)
}

fn base62_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut num = BigUint::from_bytes_be(input);
    let zero = BigUint::from(0u32);
    let base = BigUint::from(62u32);
    let mut result = String::new();

    if num == zero {
        return String::from("0");
    }

    while num > zero {
        let (quotient, remainder) = num.div_rem(&base);
        let rem_u32 = remainder.iter_u32_digits().next().unwrap_or(0);
        result.push(ALPHABET[rem_u32 as usize] as char);
        num = quotient;
    }

    // Handle leading zeros in the byte array
    for &b in input {
        if b == 0 {
            result.push('0');
        } else {
            break;
        }
    }

    result.chars().rev().collect()
}

fn find_best_palette(img: &RgbaImage) -> u8 {
    let mut best_id = 0;
    let mut min_error = f64::MAX;
    
    for id in 0..99 {
        let pal = get_palette(id);
        let mut error = 0.0;
        
        for pixel in img.pixels() {
            let [r, g, b, _] = pixel.0;
            let mut closest_dist = f64::MAX;
            for c in &pal {
                let dr = (r as f64) - (c[0] as f64);
                let dg = (g as f64) - (c[1] as f64);
                let db = (b as f64) - (c[2] as f64);
                let dist = dr*dr + dg*dg + db*db;
                if dist < closest_dist {
                    closest_dist = dist;
                }
            }
            error += closest_dist;
        }
        
        if error < min_error {
            min_error = error;
            best_id = id;
        }
    }
    
    best_id
}

fn quantize_with_dither(img: &RgbaImage, palette: &[[u8; 3]; 8]) -> Vec<u8> {
    let mut indices = Vec::with_capacity((img.width() * img.height()) as usize);
    
    for (x, y, pixel) in img.enumerate_pixels() {
        let [r, g, b, _a] = pixel.0;
        
        // Dither value (-32 to +32 approx)
        let dither = (BAYER_4X4[(y % 4) as usize][(x % 4) as usize] as f32 / 64.0) - 0.5;
        // spread factor
        let spread = 32.0; 
        
        let dr = (r as f32 + dither * spread).clamp(0.0, 255.0) as u8;
        let dg = (g as f32 + dither * spread).clamp(0.0, 255.0) as u8;
        let db = (b as f32 + dither * spread).clamp(0.0, 255.0) as u8;
        
        // Find closest
        let mut best_idx = 0;
        let mut min_dist = i32::MAX;
        
        for (i, c) in palette.iter().enumerate() {
            let diff_r = (dr as i32) - (c[0] as i32);
            let diff_g = (dg as i32) - (c[1] as i32);
            let diff_b = (db as i32) - (c[2] as i32);
            let dist = diff_r*diff_r + diff_g*diff_g + diff_b*diff_b;
            if dist < min_dist {
                min_dist = dist;
                best_idx = i as u8;
            }
        }
        
        indices.push(best_idx);
    }
    
    indices
}

pub(crate) fn rle_encode(data: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut current = data[0];
    let mut count = 1usize;
    
    for &b in &data[1..] {
        if b == current && count < 255 {
            count += 1;
        } else {
            out.push(count as u8);
            out.push(current);
            current = b;
            count = 1;
        }
    }
    out.push(count as u8);
    out.push(current);
    
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decoder;

    #[test]
    fn test_rle_roundtrip_simple() {
        let data = vec![1, 1, 1, 2, 2, 3];
        let encoded = rle_encode(&data);
        let decoded = decoder::rle_decode_pub(&encoded);
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_rle_roundtrip_single_byte() {
        let data = vec![42];
        let encoded = rle_encode(&data);
        let decoded = decoder::rle_decode_pub(&encoded);
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_rle_roundtrip_long_run() {
        // 300 identical bytes — must be split into runs of 255 + 45
        let data = vec![7u8; 300];
        let encoded = rle_encode(&data);
        let decoded = decoder::rle_decode_pub(&encoded);
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_rle_roundtrip_empty() {
        let data: Vec<u8> = vec![];
        let encoded = rle_encode(&data);
        let decoded = decoder::rle_decode_pub(&encoded);
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base62_roundtrip() {
        let original = vec![0x48, 0x65, 0x6c, 0x6c, 0x6f]; // "Hello"
        let encoded = base62_encode(&original);
        // Verify it only contains valid Base62 chars
        for c in encoded.chars() {
            assert!(c.is_ascii_alphanumeric(), "Non-alphanumeric char: {}", c);
        }
        let decoded = decoder::base62_decode_pub(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base62_roundtrip_with_leading_zeros() {
        let original = vec![0, 0, 0, 1, 2, 3];
        let encoded = base62_encode(&original);
        let decoded = decoder::base62_decode_pub(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_base62_roundtrip_large() {
        let original: Vec<u8> = (0..256).map(|i| i as u8).collect();
        let encoded = base62_encode(&original);
        let decoded = decoder::base62_decode_pub(&encoded).unwrap();
        assert_eq!(decoded, original);
    }
}
