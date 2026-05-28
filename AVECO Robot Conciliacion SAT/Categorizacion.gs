// ============================================
// Script 4: AUTO-CATEGORIZACIÓN INTELIGENTE
// Lee Movimientos_Maestros sin categoría → Detecta categoría usando:
// 1. Keyword matching (Catalogo_Categorias)
// 2. Machine learning from BOARD_NORMALIZADO history
// ============================================


/**
 * Auto-categoriza movimientos pendientes en Movimientos_Maestros
 */
function categorizarMovimientos() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  const sheetCategorias = ss.getSheetByName('Catalogo_Categorias');
  const sheetBoardHistory = ss.getSheetByName('BOARD_NORMALIZADO');
  
  if (!sheetMaestros || !sheetCategorias) {
    throw new Error('Sheets necesarios no encontrados');
  }
  
  // Cargar catálogo de categorías
  const categoriasData = sheetCategorias.getRange(2, 1, sheetCategorias.getLastRow() - 1, 4).getValues();
  const categorias = categoriasData.map(row => ({
    nivel1: row[0],
    nivel2: row[1],
    boardId: row[2],
    boardNombre: row[3]
  }));
  
  // Construir mapa de keywords desde historial Board
  const historyKeywords = construirHistorialKeywords(sheetBoardHistory, categorias);
  
  // Leer movimientos pendientes (categoria_nivel1 vacía)
  const lastRow = sheetMaestros.getLastRow();
  if (lastRow <= 1) return { procesados: 0, categorizados: 0 };
  
  const maestrosData = sheetMaestros.getRange(2, 1, lastRow - 1, 24).getValues();
  
  let procesados = 0;
  let categorizados = 0;
  const updates = [];
  
  maestrosData.forEach((row, idx) => {
    const rowNum = idx + 2;
    const descripcionLimpia = row[8]; // descripcion_limpia (col I)
    const categoriaNivel1 = row[12]; // categoria_nivel1 (col M)
    
    // Solo procesar si no tiene categoría
    if (categoriaNivel1) return;
    if (!descripcionLimpia) return;
    
    procesados++;
    
    // Intentar categorizar
    const resultado = detectarCategoria(descripcionLimpia, categorias, historyKeywords);
    
    if (resultado) {
      // Update row: categoria_nivel1, categoria_nivel2, categoria_board_id, categoria_board_nombre, confidence_score
      updates.push({
        row: rowNum,
        values: [
          resultado.nivel1,
          resultado.nivel2,
          resultado.boardId,
          resultado.boardNombre,
          resultado.confidence
        ]
      });
      categorizados++;
    }
  });
  
  // Batch update
  updates.forEach(update => {
    sheetMaestros.getRange(update.row, 13, 1, 5).setValues([update.values]);
  });
  
  Logger.log(`Procesados: ${procesados}, Categorizados: ${categorizados}`);
  return { procesados, categorizados };
}

/**
 * Construye mapa de keywords desde historial BOARD
 */
function construirHistorialKeywords(sheetHistory, categorias) {
  if (!sheetHistory || sheetHistory.getLastRow() <= 1) {
    return new Map();
  }
  
  const historyData = sheetHistory.getRange(2, 1, sheetHistory.getLastRow() - 1, 11).getValues();
  const keywordMap = new Map();
  
  historyData.forEach(row => {
    const category = row[1]; // category from Board
    const note = row[7]; // note/description
    
    if (!category || !note) return;
    
    // Limpiar y tokenizar
    const tokens = limpiarDescripcion(note).split(' ').filter(t => t.length > 3);
    
    tokens.forEach(token => {
      if (!keywordMap.has(token)) {
        keywordMap.set(token, new Map());
      }
      const catMap = keywordMap.get(token);
      catMap.set(category, (catMap.get(category) || 0) + 1);
    });
  });
  
  return keywordMap;
}

/**
 * Detecta categoría usando keyword matching + ML
 */
function detectarCategoria(descripcion, categorias, historyKeywords) {
  const desc = limpiarDescripcion(descripcion);
  const tokens = desc.split(' ').filter(t => t.length > 3);
  
  // Score por categoría
  const scores = new Map();
  
  // 1. Keyword matching desde catálogo
  categorias.forEach(cat => {
    const nivel2Lower = cat.nivel2.toLowerCase();
    const boardNombreLower = cat.boardNombre.toLowerCase();
    
    // Exact match
    if (desc.includes(nivel2Lower)) {
      const key = `${cat.nivel1}|${cat.nivel2}`;
      scores.set(key, { ...cat, score: (scores.get(key)?.score || 0) + 50 });
    }
    if (desc.includes(boardNombreLower)) {
      const key = `${cat.nivel1}|${cat.nivel2}`;
      scores.set(key, { ...cat, score: (scores.get(key)?.score || 0) + 40 });
    }
  });
  
  // 2. Machine learning desde historial Board
  tokens.forEach(token => {
    if (historyKeywords.has(token)) {
      const catMap = historyKeywords.get(token);
      catMap.forEach((count, category) => {
        // Buscar en categorías
        const matchingCat = categorias.find(c => c.boardNombre === category);
        if (matchingCat) {
          const key = `${matchingCat.nivel1}|${matchingCat.nivel2}`;
          const current = scores.get(key) || { ...matchingCat, score: 0 };
          current.score += Math.min(count * 5, 30); // Max 30 points per keyword
          scores.set(key, current);
        }
      });
    }
  });
  
  // Seleccionar mejor score
  let bestCat = null;
  let bestScore = 0;
  
  scores.forEach((cat, key) => {
    if (cat.score > bestScore) {
      bestScore = cat.score;
      bestCat = cat;
    }
  });
  
  // Threshold: min 30 points para considerar válida
  if (bestCat && bestScore >= 30) {
    return {
      nivel1: bestCat.nivel1,
      nivel2: bestCat.nivel2,
      boardId: bestCat.boardId,
      boardNombre: bestCat.boardNombre,
      confidence: Math.min(bestScore, 100) / 100
    };
  }
  
  return null;
}

function limpiarDescripcion(desc) {
  if (!desc) return '';
  return String(desc)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}
