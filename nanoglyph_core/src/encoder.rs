use image::{RgbaImage, imageops::FilterType, AnimationDecoder};
use std::io::Write;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use brotli::CompressorWriter as BrotliCompressor;
use num_bigint::BigUint;
use num_integer::Integer;

use crate::pixel_data::pack_pixels;
use crate::palette::get_palette;
use crate::{NanoGlyphHeader, NanoGlyphPayload};

// Magic bytes identifying the codec (prepended before compressed data)
const CODEC_ZLIB: u8 = 0x5A;   // 'Z'
const CODEC_BROTLI: u8 = 0x42; // 'B'

// Bayer 4x4 dither matrix, normalized to 0..64
const BAYER_4X4: [[u8; 4]; 4] = [
    [ 0, 32,  8, 40],
    [48, 16, 56, 24],
    [12, 44,  4, 36],
    [60, 28, 52, 20],
];

// ── Image Adjustment pipeline (all in native Rust, zero JS roundtrip) ──────

#[derive(Clone, Copy, Debug, Default)]
pub struct ImageAdj {
    /// Exposure in EV stops  (-1.0 = -100 from UI, +1.0 = +100 from UI)
    pub exposure:    f32,
    /// Contrast factor        (-1.0 … +1.0)
    pub contrast:    f32,
    /// Saturation factor      (-1.0 … +1.0)
    pub saturation:  f32,
    /// Hue rotation in degrees (-180 … +180)
    pub hue:         f32,
    /// Colour temperature     (-1.0 = cool, +1.0 = warm)
    pub temperature: f32,
}

impl ImageAdj {
    pub fn is_identity(&self) -> bool {
        self.exposure == 0.0
            && self.contrast == 0.0
            && self.saturation == 0.0
            && self.hue == 0.0
            && self.temperature == 0.0
    }
}

// ── HSL helpers ──────────────────────────────────────────────────────────
fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l   = (max + min) * 0.5;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h_raw = if (max - r).abs() < 1e-6 {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < 1e-6 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h_raw / 6.0, s, l)
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
    if t < 0.5        { return q; }
    if t < 2.0 / 3.0  { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    p
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s < 1e-6 { return (l, l, l); }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    (
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    )
}

/// Apply per-pixel colour adjustments in-place on an RgbaImage.
/// All math is done in f32 0..1 space to avoid repeated clamp noise.
pub fn apply_pixel_adjustments(img: &mut RgbaImage, adj: &ImageAdj) {
    if adj.is_identity() { return; }

    let exp_factor  = 2.0_f32.powf(adj.exposure);           // EV stops
    let con_factor  = 1.0 + adj.contrast;                   // 0.0 = all-grey, 2.0 = harsh
    let sat_factor  = (1.0 + adj.saturation).max(0.0);      // 0.0 = greyscale
    let hue_shift   = adj.hue / 360.0;                      // normalised 0..1
    let temp_r      =  adj.temperature * 0.314;              // ± 80/255
    let temp_b      = -adj.temperature * 0.314;

    let needs_hsl = adj.saturation != 0.0 || adj.hue != 0.0;

    for pixel in img.pixels_mut() {
        let mut r = pixel[0] as f32 / 255.0;
        let mut g = pixel[1] as f32 / 255.0;
        let mut b = pixel[2] as f32 / 255.0;

        // 1. Exposure
        if adj.exposure != 0.0 {
            r = (r * exp_factor).clamp(0.0, 1.0);
            g = (g * exp_factor).clamp(0.0, 1.0);
            b = (b * exp_factor).clamp(0.0, 1.0);
        }

        // 2. Contrast  (pivot at 0.5)
        if adj.contrast != 0.0 {
            r = ((r - 0.5) * con_factor + 0.5).clamp(0.0, 1.0);
            g = ((g - 0.5) * con_factor + 0.5).clamp(0.0, 1.0);
            b = ((b - 0.5) * con_factor + 0.5).clamp(0.0, 1.0);
        }

        // 3. Saturation + Hue  (both go through HSL)
        if needs_hsl {
            let (mut h, mut s, l) = rgb_to_hsl(r, g, b);
            s = (s * sat_factor).clamp(0.0, 1.0);
            h = (h + hue_shift).fract();
            if h < 0.0 { h += 1.0; }
            let (nr, ng, nb) = hsl_to_rgb(h, s, l);
            r = nr; g = ng; b = nb;
        }

        // 4. Temperature  (warm = +R −B, cool = −R +B)
        if adj.temperature != 0.0 {
            r = (r + temp_r).clamp(0.0, 1.0);
            b = (b + temp_b).clamp(0.0, 1.0);
        }

        pixel[0] = (r * 255.0).round() as u8;
        pixel[1] = (g * 255.0).round() as u8;
        pixel[2] = (b * 255.0).round() as u8;
        // alpha unchanged
    }
}

pub fn encode_image(
    img_data: &[u8],
    max_dimension: u32,
    forced_palette_id: Option<u8>,
    use_brotli: bool,
    adj: &ImageAdj,
) -> Result<String, String> {
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
        let mut resized = image::imageops::resize(&frame, new_w, new_h, FilterType::Triangle);
        // Apply image adjustments after resize (fewer pixels → faster)  
        apply_pixel_adjustments(&mut resized, adj);
        resized_frames.push(resized);
    }
    
    // 2. Select palette (forced or auto-detect)
    let best_palette_id = match forced_palette_id {
        Some(id) if id < 99 => id,
        _ => find_best_palette(&resized_frames[0]),
    };
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
    let header = NanoGlyphHeader::new(new_w as u16, new_h as u16, best_palette_id, is_animation, frame_count);
    let rle_pixels = rle_encode(&packed_pixels);
    let payload = NanoGlyphPayload::new(header, rle_pixels);
    let binary = payload.to_binary();
    
    let compressed_binary = if use_brotli {
        compress_brotli(&binary)?
    } else {
        compress_zlib(&binary)?
    };
    
    // 6. Base62 Encode
    Ok(base62_encode(&compressed_binary))
}

pub(crate) fn compress_zlib(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = vec![CODEC_ZLIB];
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(data).map_err(|e| e.to_string())?;
    out.extend(encoder.finish().map_err(|e| e.to_string())?);
    Ok(out)
}

pub(crate) fn compress_brotli(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut compressed = Vec::new();
    {
        // quality=11 (max), lgwin=22 (max window)
        let mut enc = BrotliCompressor::new(&mut compressed, 4096, 11, 22);
        enc.write_all(data).map_err(|e| e.to_string())?;
    }
    let mut out = vec![CODEC_BROTLI];
    out.extend(compressed);
    Ok(out)
}

pub(crate) fn base62_encode(input: &[u8]) -> String {
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

pub(crate) fn find_best_palette(img: &RgbaImage) -> u8 {
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

pub(crate) fn quantize_with_dither(img: &RgbaImage, palette: &[[u8; 3]; 8]) -> Vec<u8> {
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

/// Fast preview: resize + adjust + dither with a given palette → returns (width, height, rgba)
pub fn preview_with_palette(
    img_data: &[u8],
    max_dimension: u32,
    palette_id: u8,
    adj: &ImageAdj,
) -> Result<(u32, u32, Vec<u8>), String> {
    let img = image::load_from_memory(img_data).map_err(|e| e.to_string())?;
    let rgba_img = img.to_rgba8();
    
    let (width, height) = rgba_img.dimensions();
    let mut new_w = width;
    let mut new_h = height;
    
    if width > max_dimension || height > max_dimension {
        let ratio = max_dimension as f32 / width.max(height) as f32;
        new_w = (width as f32 * ratio).round().max(1.0) as u32;
        new_h = (height as f32 * ratio).round().max(1.0) as u32;
    }
    
    let mut resized = image::imageops::resize(&rgba_img, new_w, new_h, image::imageops::FilterType::Triangle);
    apply_pixel_adjustments(&mut resized, adj);
    
    let palette = get_palette(palette_id);
    let indices = quantize_with_dither(&resized, &palette);
    
    let mut out = Vec::with_capacity((new_w * new_h * 4) as usize);
    for idx in &indices {
        let c = palette[(*idx & 7) as usize];
        out.push(c[0]);
        out.push(c[1]);
        out.push(c[2]);
        out.push(255);
    }
    
    Ok((new_w, new_h, out))
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
