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

fn main() {
    let r = 1.0;
    let g = 0.0;
    let b = 0.0;
    let (h, s, l) = rgb_to_hsl(r, g, b);
    println!("Red HSL: h={} s={} l={}", h, s, l);
    
    // Test Hue Rotate (+180 deg)
    let h2 = (h + 180.0 / 360.0).fract();
    let (nr, ng, nb) = hsl_to_rgb(h2, s, l);
    println!("Rotated 180: r={} g={} b={}", nr, ng, nb);
    
    // Test Saturation 0
    let (gr, gg, gb) = hsl_to_rgb(h, 0.0, l);
    println!("Desaturated: r={} g={} b={}", gr, gg, gb);
}
