pub fn pack_pixels(indices: &[u8]) -> Vec<u8> {
    let mut packed = Vec::new();
    let mut current_byte = 0u8;
    let mut bits_in_current = 0;

    for &idx in indices {
        let val = idx & 0b111; // 3 bits
        if bits_in_current + 3 <= 8 {
            current_byte |= val << (8 - bits_in_current - 3);
            bits_in_current += 3;
            if bits_in_current == 8 {
                packed.push(current_byte);
                current_byte = 0;
                bits_in_current = 0;
            }
        } else {
            // Need to split across two bytes
            let bits_in_first = 8 - bits_in_current;
            let bits_in_second = 3 - bits_in_first;
            
            current_byte |= val >> bits_in_second;
            packed.push(current_byte);
            
            current_byte = (val & ((1 << bits_in_second) - 1)) << (8 - bits_in_second);
            bits_in_current = bits_in_second;
        }
    }
    
    if bits_in_current > 0 {
        packed.push(current_byte);
    }
    
    packed
}

pub fn unpack_pixels(packed: &[u8], num_pixels: usize) -> Vec<u8> {
    let mut indices = Vec::with_capacity(num_pixels);
    let mut byte_idx = 0;
    let mut bit_offset = 0; // 0 to 7, where 0 is the most significant bit

    for _ in 0..num_pixels {
        if byte_idx >= packed.len() {
            break; // Stop if we run out of bytes
        }
        
        let mut val = 0u8;
        if bit_offset + 3 <= 8 {
            val = (packed[byte_idx] >> (8 - bit_offset - 3)) & 0b111;
            bit_offset += 3;
            if bit_offset == 8 {
                byte_idx += 1;
                bit_offset = 0;
            }
        } else {
            let bits_in_first = 8 - bit_offset;
            let bits_in_second = 3 - bits_in_first;
            
            val |= (packed[byte_idx] & ((1 << bits_in_first) - 1)) << bits_in_second;
            byte_idx += 1;
            
            if byte_idx < packed.len() {
                val |= (packed[byte_idx] >> (8 - bits_in_second)) & ((1 << bits_in_second) - 1);
            }
            bit_offset = bits_in_second;
        }
        indices.push(val);
    }
    
    indices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pack_unpack_pixels() {
        let indices = vec![1, 2, 3, 4, 5, 6, 7, 0, 1, 2];
        let packed = pack_pixels(&indices);
        
        // 10 pixels * 3 bits = 30 bits -> 4 bytes
        assert_eq!(packed.len(), 4);
        
        let unpacked = unpack_pixels(&packed, indices.len());
        assert_eq!(unpacked, indices);
    }

    #[test]
    fn test_pack_unpack_pixels_large() {
        let indices: Vec<u8> = (0..1000).map(|i| (i % 8) as u8).collect();
        let packed = pack_pixels(&indices);
        let unpacked = unpack_pixels(&packed, indices.len());
        assert_eq!(unpacked, indices);
    }
}
