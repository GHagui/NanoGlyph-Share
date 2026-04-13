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

    // Palette 2: Real Colors
    if id == 2 {
        return [
            [32, 34, 38],    // Sombras fotográficas (Off-black)
            [163, 73, 84],   // Vermelho natural/Floral
            [85, 110, 83],   // Vegetação/Sálvia
            [90, 130, 170],  // Céu e Água
            [218, 165, 80],  // Luz do sol/Golden Hour
            [194, 135, 117], // Tons de pele base/Argila
            [105, 75, 55],   // Madeira e Terra profunda
            [242, 238, 230]  // Realces/Branco fotográfico
        ];
    }

    // Palette 3: Retratos e Tons de Pele
    if id == 3 {
        return [
            [40, 30, 25],    // Cabelo escuro/Sombras quentes
            [90, 55, 45],    // Pele retinta/Sombra de contorno
            [160, 105, 80],  // Pele média/Terracota
            [225, 190, 165], // Pele clara/Pêssego
            [180, 90, 95],   // Lábios e Blush (Rosa queimado)
            [100, 120, 110], // Olhos (Avelã/Sálvia suave)
            [245, 230, 215], // Realce de pele (Brilho suave)
            [150, 145, 140]  // Fundo neutro fotográfico (Cinza quente)
        ];
    }
    // Palette 4: Cinema "Teal & Orange"
    if id == 4 {
        return [
            [15, 20, 25],    // Sombras esmagadas (Azul-petróleo escuro)
            [30, 75, 85],    // Ciano profundo (Teal base)
            [65, 115, 125],  // Atmosfera e Céu noturno
            [60, 75, 55],    // Vegetação cinematográfica (Dessaturada)
            [170, 85, 45],   // Ferrugem/Laranja profundo
            [210, 140, 85],  // Pele iluminada/Luz principal
            [235, 195, 130], // Golden Hour (Sol rebatido)
            [220, 225, 225]  // Fumaça e Realces frios
        ];
    }
    // Palette 5: Paisagem Melancólica e Inverno
    if id == 5 {
        return [
            [35, 45, 40],    // Pinheiros escuros
            [75, 85, 95],    // Pedras e Tempestade (Ardósia)
            [100, 120, 135], // Água gelada/Lagos
            [175, 195, 205], // Gelo e Geada (Azul pálido)
            [120, 105, 95],  // Terra úmida e Lama
            [155, 125, 90],  // Folhas secas de outono
            [185, 190, 190], // Neblina densa
            [230, 235, 240]  // Céu nublado de inverno
        ];
    }
    // Palette 6: Filme Analógico Vintage
    if id == 6 {
        return [
            [50, 45, 55],    // Sombras lavadas (Levantadas com tom magenta)
            [180, 60, 60],   // Vermelho Kodak (Quente e desbotado)
            [200, 150, 50],  // Amarelo Mostarda retro
            [80, 100, 70],   // Verde Fujifilm (Puxado pro ciano)
            [110, 130, 160], // Jeans desbotado (Azul analógico)
            [170, 145, 120], // Filtro Sépia (Meios-tons de papel)
            [220, 160, 150], // Rosa pastel/Pêssego vintage
            [240, 230, 210]  // Papel fotográfico envelhecido (Creme)
        ];
    }

    // Palette 7: Noite Urbana (Street / Neon)
    if id == 7 {
        return [
            [15, 20, 25],    // Asfalto escuro/Sombras esmagadas
            [65, 70, 80],    // Concreto molhado sob pouca luz
            [170, 45, 55],   // Lanternas de carros (Vermelho LED)
            [210, 160, 85],  // Postes de rua (Amarelo Halogênio/Sódio)
            [55, 140, 155],  // Reflexos de vitrines (Ciano noturno)
            [130, 70, 120],  // Letreiros e reflexos (Magenta/Neon suave)
            [165, 115, 95],  // Pele humana sob luz artificial mista
            [235, 245, 255]  // Foco de luz/Farol (Branco azulado intenso)
        ];
    }

    // Palette 8: Golden Hour & Sunset
    if id == 8 {
        return [
            [25, 15, 10],    // Silhuetas e Sombras profundas (Quase preto quente)
            [95, 65, 95],    // Crepúsculo (Roxo atmosférico)
            [160, 90, 110],  // Nuvens baixas (Magenta/Pêssego escuro)
            [190, 80, 50],   // Céu incandescente (Laranja avermelhado)
            [240, 175, 75],  // O sol em si (Dourado vibrante)
            [130, 105, 60],  // Vegetação e grama retroiluminada
            [205, 135, 95],  // Tons de pele banhados pelo sol
            [255, 235, 190]  // Halo solar (Amarelo pastel brilhante)
        ];
    }
    
    // Palette 9: Gastronomia e Food Photography
    if id == 9 {
        return [
            [40, 30, 25],    // Sombras de pratos e vincos profundos
            [115, 80, 60],   // Tábuas de madeira e fundos rústicos
            [175, 110, 60],  // Crostas de pão, massas e carnes assadas
            [185, 55, 55],   // Tomates cereja, frutas vermelhas e molhos
            [100, 135, 70],  // Ervas frescas (Manjericão, salsinha)
            [235, 170, 50],  // Gemas de ovo, cítricos e azeite
            [240, 225, 185], // Queijos, cremes e manteiga
            [245, 245, 240]  // Pratos de porcelana limpos e reflexos
        ];
    }

    // Palette 10: Estúdio Minimalista (High-Key / Moda)
    if id == 10 {
        return [
            [60, 60, 65],    // O tom mais escuro (Carvão suave, sem preto puro)
            [140, 140, 145], // Tecidos médios e sombras suaves
            [150, 165, 155], // Eucalipto/Sálvia (Toque verde minimalista)
            [170, 190, 205], // Jeans claro e céu suave
            [210, 175, 165], // Blush e tons de pele em luz de estúdio
            [225, 215, 200], // Linho, bege e tecidos naturais
            [240, 240, 245], // Fundo branco de estúdio (Ligeiramente cinza)
            [250, 250, 250]  // Estouro do flash (Branco quase puro)
        ];
    }

    // Palette 11: Macro & Texturas da Natureza
    if id == 11 {
        return [
            [20, 25, 20],    // Sombras profundas (Sob folhas e musgo)
            [130, 185, 65],  // Clorofila vibrante (Verde translúcido)
            [205, 190, 50],  // Pólen e luz do sol filtrada
            [215, 80, 55],   // Vermelho de insetos (Joaninhas/Flores intensas)
            [125, 180, 205], // Reflexo em gotas de orvalho (Azul ciano claro)
            [165, 115, 160], // Púrpuras de flores silvestres e orquídeas
            [110, 85, 45],   // Terra molhada e cascas de árvore (Marrom quente)
            [235, 240, 235]  // Brilho especular (Luz refletida em texturas)
        ];
    }

    // Palette 12: Praia e Verão
    if id == 12 {
        return [
            [25, 40, 60],    // Águas profundas/Sombras sob o sol a pino
            [55, 135, 175],  // Oceano vibrante (Azul turquesa médio)
            [120, 195, 215], // Água rasa e céu de meio-dia
            [215, 180, 125], // Areia seca sob o sol
            [155, 110, 80],  // Areia molhada/Pele bronzeada escura
            [225, 150, 100], // Pele bronzeada com filtro solar/Luz quente
            [245, 235, 210], // Espuma do mar e nuvens brilhantes
            [250, 250, 255]  // Brilho ofuscante do sol na água
        ];
    }

    // Palette 13: Cyberpunk (Neon Synth)
    if id == 13 {
        return [
            [10, 10, 15],    // Preto absoluto (Fundo infinito/Telas desligadas)
            [35, 20, 55],    // Sombras arroxeadas (Atmosfera synth)
            [0, 170, 200],   // Ciano elétrico (Tubos de neon)
            [220, 30, 110],  // Magenta/Rosa choque (Letreiros e luzes)
            [115, 45, 225],  // Roxo profundo/Ultravioleta
            [230, 215, 50],  // Amarelo tóxico/Ácido (Avisos de perigo/Luzes amarelas)
            [60, 215, 115],  // Verde tela de fósforo (Matrix/Terminais antigos)
            [225, 240, 255]  // Branco frio (Halogênio superexposto)
        ];
    }

    // Palette 14: Sépia Dramático (Monocromático Quente)
    if id == 14 {
        return [
            [35, 25, 20],    // Sombras profundas (Marrom quase preto, toque avermelhado)
            [65, 45, 35],    // Meios-tons escuros (Tinta envelhecida)
            [100, 75, 55],   // Sépia base (Marrom médio neutro)
            [135, 105, 80],  // Madeira velha e couro claro
            [170, 135, 105], // Sépia claro/Papel pardo
            [205, 175, 140], // Tons de pele monocromáticos sob luz
            [230, 210, 185], // Fundo iluminado/Papel creme
            [250, 240, 225]  // Reflexos e desgastes (Branco quente)
        ];
    }

    // Palette 15: Astrofotografia & Espaço Deep Sky
    if id == 15 {
        return [
            [10, 12, 20],    // Espaço profundo (Off-black com toque azul)
            [25, 30, 50],    // Fundo do céu noturno
            [45, 55, 85],    // Poeira estelar e atmosfera
            [90, 75, 110],   // Nebulosas e núcleo da galáxia (Roxo/Magenta profundo)
            [140, 100, 130], // Brilho de gás ionizado (Rosa espacial)
            [65, 120, 130],  // Emissão de oxigênio/Estrelas azuis (Ciano escuro)
            [190, 200, 220], // Estrelas distantes e poeira clara
            [240, 245, 255]  // Estrelas brilhantes e Lua (Branco azulado intenso)
        ];
    }

    // Palette 16: Infravermelho Surreal (Estilo Aerochrome)
    if id == 16 {
        return [
            [20, 25, 30],    // Sombras duras e troncos de árvores
            [35, 60, 95],    // Céu escurecido (O infravermelho escurece o azul)
            [75, 120, 150],  // Água e reflexos cianos
            [220, 50, 70],   // Folhagem densa e clorofila (Vermelho vibrante)
            [240, 110, 130], // Grama iluminada e folhas claras (Rosa chiclete)
            [180, 160, 140], // Estruturas humanas, estradas e terra
            [230, 210, 200], // Tons de pele e construções claras
            [250, 245, 250]  // Nuvens e superexposição
        ];
    }

    // Palette 17: Pastel Sonhador e Etéreo
    if id == 17 {
        return [
            [120, 115, 130], // O tom mais escuro (Sombra violeta super suave)
            [180, 190, 210], // Céu limpo e lavagens azuis (Azul bebê)
            [190, 220, 200], // Vegetação clara (Verde menta)
            [240, 200, 215], // Flores e blush (Rosa algodão doce)
            [245, 225, 180], // Luz do sol suave (Amarelo pastel)
            [230, 210, 205], // Tons de pele super suaves e iluminados
            [245, 240, 245], // Fundo arejado e atmosfera leve
            [255, 255, 255]  // Reflexos e destaques oníricos
        ];
    }

    // Palette 18: Grunge, Urbex e Industrial
    if id == 18 {
        return [
            [15, 18, 15],    // Escuridão total e sujeira incrustada
            [45, 50, 45],    // Musgo escuro e mofo
            [75, 80, 75],    // Sombras em concreto e asfalto
            [110, 115, 105], // Concreto envelhecido e paredes cinzas
            [140, 75, 45],   // Metal oxidado (Ferrugem intensa)
            [185, 150, 100], // Tinta amarela descascando e iluminação velha
            [90, 120, 105],  // Tinta industrial e vidro sujo (Verde dessaturado)
            [200, 205, 200]  // Céu nublado e luz difusa através de poeira
        ];
    }

    // Palette 19: Pop Art / Duotone Gráfico
    if id == 19 {
        return [
            [20, 15, 35],    // Sombras sólidas (Azul-marinho quase preto)
            [215, 40, 45],   // Vermelho Pop (Cereja vibrante)
            [240, 205, 0],   // Amarelo Táxi/Girassol (Para meios-tons claros)
            [0, 165, 215],   // Azul Ciano (Para meios-tons frios)
            [235, 120, 180], // Rosa Chiclete (Acentos e fundos)
            [95, 205, 125],  // Verde Hortelã/Esmeralda retro
            [245, 145, 80],  // Laranja Tangerina
            [245, 240, 225]  // Papel Off-White (Fundo claro, sem estourar)
        ];
    }

    // Palette 20: Iridescente e Holográfico
    if id == 20 {
        return [
            [90, 80, 140],   // O tom mais escuro (Violeta/Anil suave)
            [135, 115, 225], // Roxo elétrico lavado (Lilás iridescente)
            [105, 195, 240], // Ciano claro (Reflexo de vidro)
            [145, 245, 195], // Verde água/Menta brilhante
            [235, 245, 175], // Amarelo limão pastel (Luz direta refringida)
            [255, 185, 160], // Pêssego/Salmão suave
            [245, 140, 195], // Rosa perolado
            [255, 250, 255]  // Brilho especular total (Branco com toque magenta)
        ];
    }
    
    // Procedural generation for palettes 21-98
    // Remap to spread evenly across 360° hue regardless of how many custom palettes exist
    let num_custom = 21; // Number of hand-crafted palettes (0-20)
    let procedural_index = (id - num_custom) as f32;
    let procedural_total = (99 - num_custom) as f32; // 78 procedural palettes
    let hue_base = (procedural_index / procedural_total) * 360.0;
    
    for i in 0..8 {
        let lightness = i as f32 / 7.0; // 0.0 to 1.0
        // Vary hue slightly across the palette
        let h = (hue_base + (i as f32 * 12.0)) % 360.0;
        let s = if lightness < 0.1 || lightness > 0.9 { 0.15 } else { 0.75 };
        
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
