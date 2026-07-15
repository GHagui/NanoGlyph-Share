use image::{RgbaImage, imageops::FilterType, AnimationDecoder};
use crate::encoder::{ImageAdj, apply_pixel_adjustments};

pub struct CoreSession {
    pub original_frames: Vec<RgbaImage>,
    pub is_animation: bool,
    pub frame_count: u8,
    pub rotation_quarter_turns: u8,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    
    // Cached, resized base images
    pub cached_max_dim: u32,
    pub resized_frames: Vec<RgbaImage>,
}

impl CoreSession {
    pub fn new(img_data: &[u8]) -> Result<Self, String> {
        let mut frames = Vec::new();
        
        // Try GIF
        if let Ok(decoder) = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(img_data)) {
            if let Ok(f) = decoder.into_frames().collect_frames() {
                for frame in f.into_iter().take(5) {
                    frames.push(frame.into_buffer());
                }
            }
        }
        
        // Fallback
        if frames.is_empty() {
            let img = image::load_from_memory(img_data).map_err(|e| e.to_string())?;
            frames.push(img.to_rgba8());
        }
        
        let is_animation = frames.len() > 1;
        let frame_count = frames.len() as u8;
        
        Ok(CoreSession {
            original_frames: frames,
            is_animation,
            frame_count,
            rotation_quarter_turns: 0,
            flip_horizontal: false,
            flip_vertical: false,
            cached_max_dim: 0,
            resized_frames: Vec::new(),
        })
    }

    pub fn set_transform(&mut self, rotation_quarter_turns: u8, flip_horizontal: bool, flip_vertical: bool) {
        let rotation_quarter_turns = rotation_quarter_turns % 4;
        if self.rotation_quarter_turns == rotation_quarter_turns
            && self.flip_horizontal == flip_horizontal
            && self.flip_vertical == flip_vertical
        {
            return;
        }

        self.rotation_quarter_turns = rotation_quarter_turns;
        self.flip_horizontal = flip_horizontal;
        self.flip_vertical = flip_vertical;
        self.cached_max_dim = 0;
        self.resized_frames.clear();
    }

    fn transform_frame(&self, frame: &RgbaImage) -> RgbaImage {
        let mut transformed = match self.rotation_quarter_turns {
            1 => image::imageops::rotate90(frame),
            2 => image::imageops::rotate180(frame),
            3 => image::imageops::rotate270(frame),
            _ => frame.clone(),
        };

        if self.flip_horizontal {
            transformed = image::imageops::flip_horizontal(&transformed);
        }
        if self.flip_vertical {
            transformed = image::imageops::flip_vertical(&transformed);
        }
        transformed
    }

    fn ensure_resized(&mut self, max_dimension: u32) {
        if self.cached_max_dim == max_dimension && !self.resized_frames.is_empty() {
            return;
        }

        let (original_width, original_height) = self.original_frames[0].dimensions();
        let (width, height) = if self.rotation_quarter_turns % 2 == 0 {
            (original_width, original_height)
        } else {
            (original_height, original_width)
        };
        let mut new_w = width;
        let mut new_h = height;
        
        if width > max_dimension || height > max_dimension {
            let ratio = max_dimension as f32 / width.max(height) as f32;
            new_w = (width as f32 * ratio).round().max(1.0) as u32;
            new_h = (height as f32 * ratio).round().max(1.0) as u32;
        }

        self.resized_frames.clear();
        for frame in &self.original_frames {
            let transformed = self.transform_frame(frame);
            // Triangle filter is good enough, maybe Lanczos3 for better quality? Triangle is faster.
            let resized = image::imageops::resize(&transformed, new_w, new_h, FilterType::Triangle);
            self.resized_frames.push(resized);
        }
        
        self.cached_max_dim = max_dimension;
    }

    pub fn preview(&mut self, max_dimension: u32, palette_id: u8, adj: &ImageAdj) -> Result<(u32, u32, Vec<u8>, u8), String> {
        self.ensure_resized(max_dimension);
        
        // Since preview is just for the first frame mostly, we do frame 0
        let mut working_frame = self.resized_frames[0].clone();
        apply_pixel_adjustments(&mut working_frame, adj);
        
        let actual_palette_id = if palette_id < 99 {
            palette_id
        } else {
            crate::encoder::find_best_palette(&working_frame)
        };
        
        let palette = crate::palette::get_palette(actual_palette_id);
        let indices = crate::encoder::quantize_with_dither(&working_frame, &palette);
        
        let (w, h) = working_frame.dimensions();
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        for idx in &indices {
            let c = palette[(*idx & 7) as usize];
            out.push(c[0]);
            out.push(c[1]);
            out.push(c[2]);
            out.push(255);
        }
        
        Ok((w, h, out, actual_palette_id))
    }

    pub fn encode(&mut self, max_dimension: u32, forced_palette_id: Option<u8>, use_brotli: bool, adj: &ImageAdj) -> Result<String, String> {
        self.ensure_resized(max_dimension);
        
        // Apply adjustments to clones
        let mut adj_frames = Vec::with_capacity(self.resized_frames.len());
        for frame in &self.resized_frames {
            let mut f = frame.clone();
            apply_pixel_adjustments(&mut f, adj);
            adj_frames.push(f);
        }
        
        let best_palette_id = match forced_palette_id {
            Some(id) if id < 99 => id,
            _ => crate::encoder::find_best_palette(&adj_frames[0]),
        };
        let palette = crate::palette::get_palette(best_palette_id);
        
        let mut all_indices = Vec::new();
        let mut prev_indices = Vec::new();
        
        for (i, frame) in adj_frames.iter().enumerate() {
            let indices = crate::encoder::quantize_with_dither(frame, &palette);
            
            if i == 0 {
                all_indices.extend_from_slice(&indices);
                prev_indices = indices;
            } else {
                let mut delta_indices = Vec::with_capacity(indices.len());
                for j in 0..indices.len() {
                    let diff = (indices[j] + 8 - prev_indices[j]) % 8;
                    delta_indices.push(diff);
                }
                all_indices.extend_from_slice(&delta_indices);
                prev_indices = indices;
            }
        }
        
        let packed_pixels = crate::pixel_data::pack_pixels(&all_indices);
        let (w, h) = adj_frames[0].dimensions();
        let header = crate::NanoGlyphHeader::new(w as u16, h as u16, best_palette_id, self.is_animation, self.frame_count);
        let rle_pixels = crate::encoder::rle_encode(&packed_pixels);
        let payload = crate::NanoGlyphPayload::new(header, rle_pixels);
        let binary = payload.to_binary();
        
        let compressed_binary = if use_brotli {
            crate::encoder::compress_brotli(&binary)?
        } else {
            crate::encoder::compress_zlib(&binary)?
        };
        
        Ok(crate::encoder::base62_encode(&compressed_binary))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn two_pixel_session() -> CoreSession {
        let mut frame = RgbaImage::new(2, 1);
        frame.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        frame.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
        CoreSession {
            original_frames: vec![frame],
            is_animation: false,
            frame_count: 1,
            rotation_quarter_turns: 0,
            flip_horizontal: false,
            flip_vertical: false,
            cached_max_dim: 0,
            resized_frames: Vec::new(),
        }
    }

    #[test]
    fn applies_rotation_before_mirroring() {
        let mut session = two_pixel_session();
        session.set_transform(1, true, false);
        session.ensure_resized(128);

        let frame = &session.resized_frames[0];
        assert_eq!(frame.dimensions(), (1, 2));
        assert_eq!(*frame.get_pixel(0, 0), Rgba([255, 0, 0, 255]));
        assert_eq!(*frame.get_pixel(0, 1), Rgba([0, 0, 255, 255]));
    }

    #[test]
    fn changing_transform_invalidates_resize_cache() {
        let mut session = two_pixel_session();
        session.ensure_resized(128);
        assert_eq!(session.cached_max_dim, 128);

        session.set_transform(2, false, true);
        assert_eq!(session.cached_max_dim, 0);
        assert!(session.resized_frames.is_empty());
    }
}
