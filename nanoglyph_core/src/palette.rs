// Generate a set of 99 distinct 8-color palettes procedurally
pub fn get_palette(id: u8) -> [[u8; 3]; 8] {
    let mut palette = [[0u8; 3]; 8];
    // Palette 0: Grayscale
    if id == 0 {
        for i in 0..8 {
            let v = (i as f32 / 7.0 * 255.0) as u8;
            palette[i] = [v, v, v];
        }
        return palette;
    }
    
    // Palette 1: Standard web colors
    if id == 1 {
        return [
            [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
            [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 255, 255]
        ];
    }
    
    // Procedural generation for the rest
    // We use the ID to seed some parameters (hue base, saturation, etc.)
    let hue_base = (id as f32 / 99.0) * 360.0;
    
    for i in 0..8 {
        let lightness = i as f32 / 7.0; // 0.0 to 1.0
        // Vary hue slightly across the palette
        let h = (hue_base + (i as f32 * 10.0)) % 360.0;
        let s = if lightness < 0.1 || lightness > 0.9 { 0.1 } else { 0.8 };
        
        let (r, g, b) = hsl_to_rgb(h, s, lightness);
        palette[i] = [r, g, b];
    }
    
    palette
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (u8, u8, u8) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r_prime, g_prime, b_prime) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    (
        ((r_prime + m) * 255.0).round() as u8,
        ((g_prime + m) * 255.0).round() as u8,
        ((b_prime + m) * 255.0).round() as u8,
    )
}
