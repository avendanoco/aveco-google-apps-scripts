// ============================================
// FUNCIONALIDADES AVANZADAS - Nivel Siguiente
// Detección de transferencias, ML mejorado, Análisis de patrones
// ============================================

/**
 * FUNCIÓN 1: Detectar transferencias entre cuentas propias
 * Identifica pares de movimientos que son transferencias internas
 */
function detectarTransferenciasInternas() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  
  if (!sheetMaestros || sheetMaestros.getLastRow() <= 1) {
    return { detectadas: 0, pareadas: 0 };
  }
  
  const data = sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues();
  
  // Agrupar movimientos por fecha y monto
  const movimientosPorFechaMonto = new Map();
  
  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const [idInterno, banco, cuenta, fecha, monto, moneda] = row;
    
    if (!fecha || !monto) return;
    
    const fechaStr = Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const montoAbs = Math.abs(monto);
    const key = `${fechaStr}_${montoAbs}_${moneda}`;
    
    if (!movimientosPorFechaMonto.has(key)) {
      movimientosPorFechaMonto.set(key, []);
    }
    
    movimientosPorFechaMonto.get(key).push({
      rowNum,
      idInterno,
      banco,
      cuenta,
      monto,
      esCargo: monto < 0,
      esAbono: monto > 0
    });
  });
  
  // Buscar pares: cargo en cuenta A + abono en cuenta B
  const transferenciasDetectadas = [];
  let detectadas = 0;
  let pareadas = 0;
  
  movimientosPorFechaMonto.forEach((movimientos, key) => {
    if (movimientos.length < 2) return;
    
    // Buscar cargo y abono
    const cargos = movimientos.filter(m => m.esCargo);
    const abonos = movimientos.filter(m => m.esAbono);
    
    if (cargos.length > 0 && abonos.length > 0) {
      cargos.forEach(cargo => {
        abonos.forEach(abono => {
          // Evitar que sea la misma cuenta
          if (cargo.cuenta !== abono.cuenta) {
            transferenciasDetectadas.push({
              cargoRow: cargo.rowNum,
              abonoRow: abono.rowNum,
              cargoId: cargo.idInterno,
              abonoId: abono.idInterno
            });
            detectadas++;
          }
        });
      });
    }
  });
  
  // Actualizar rows con transfer_id
  transferenciasDetectadas.forEach(transfer => {
    const transferId = `TRF_${transfer.cargoId.substring(4, 16)}`;
    
    // Actualizar cargo (col 22: transfer_id)
    sheetMaestros.getRange(transfer.cargoRow, 22).setValue(transferId);
    // Actualizar abono
    sheetMaestros.getRange(transfer.abonoRow, 22).setValue(transferId);
    
    pareadas += 2;
  });
  
  Logger.log(`Transferencias detectadas: ${detectadas}, Movimientos pareados: ${pareadas}`);
  return { detectadas, pareadas };
}

/**
 * FUNCIÓN 2: Machine Learning Avanzado con historial de aprendizaje
 * Guarda patrones aprendidos para mejorar continuamente
 */
function entrenarModeloCategorizacion() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  const sheetCategorias = ss.getSheetByName('Catalogo_Categorias');
  
  // Crear sheet de aprendizaje si no existe
  let sheetML = ss.getSheetByName('ML_Training_Data');
  if (!sheetML) {
    sheetML = ss.insertSheet('ML_Training_Data');
    sheetML.getRange('A1:D1').setValues([[
      'keyword', 'category_board_nombre', 'frequency', 'confidence'
    ]]);
  }
  
  // Leer movimientos ya categorizados
  const maestrosData = sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues();
  
  const keywordFrequency = new Map();
  
  maestrosData.forEach(row => {
    const descripcionLimpia = row[8];
    const categoriaBoardNombre = row[15];
    
    if (!descripcionLimpia || !categoriaBoardNombre) return;
    
    // Tokenizar
    const tokens = String(descripcionLimpia).toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter(t => t.length > 3);
    
    tokens.forEach(token => {
      const key = `${token}|${categoriaBoardNombre}`;
      keywordFrequency.set(key, (keywordFrequency.get(key) || 0) + 1);
    });
  });
  
  // Calcular confidence scores y guardar
  const mlData = [];
  const categoryTotals = new Map();
  
  // Calcular totales por categoría
  keywordFrequency.forEach((freq, key) => {
    const category = key.split('|')[1];
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + freq);
  });
  
  // Crear datos ML con confidence
  keywordFrequency.forEach((freq, key) => {
    const [keyword, category] = key.split('|');
    const total = categoryTotals.get(category);
    const confidence = Math.min((freq / total) * 100, 100);
    
    mlData.push([keyword, category, freq, confidence]);
  });
  
  // Ordenar por frequency desc
  mlData.sort((a, b) => b[2] - a[2]);
  
  // Limpiar y escribir datos
  if (sheetML.getLastRow() > 1) {
    sheetML.deleteRows(2, sheetML.getLastRow() - 1);
  }
  
  if (mlData.length > 0) {
    sheetML.getRange(2, 1, mlData.length, 4).setValues(mlData);
  }
  
  Logger.log(`Modelo entrenado con ${mlData.length} patrones`);
  return { patrones: mlData.length, categorias: categoryTotals.size };
}

/**
 * FUNCIÓN 3: Análisis de patrones y anomalías
 * Detecta gastos inusuales o patrones fuera de lo normal
 */
function detectarAnomalias() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  const sheetRevisiones = ss.getSheetByName('Revision_Humana');
  
  if (!sheetMaestros || sheetMaestros.getLastRow() <= 1) {
    return { anomalias: 0 };
  }
  
  const data = sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues();
  
  // Calcular estadísticas por categoría
  const statsPorCategoria = new Map();
  
  data.forEach(row => {
    const monto = Math.abs(row[4]);
    const categoria = row[15];
    
    if (!categoria) return;
    
    if (!statsPorCategoria.has(categoria)) {
      statsPorCategoria.set(categoria, { montos: [], count: 0, sum: 0 });
    }
    
    const stats = statsPorCategoria.get(categoria);
    stats.montos.push(monto);
    stats.count++;
    stats.sum += monto;
  });
  
  // Calcular promedio y desviación estándar
  statsPorCategoria.forEach((stats, categoria) => {
    const promedio = stats.sum / stats.count;
    const varianza = stats.montos.reduce((acc, m) => acc + Math.pow(m - promedio, 2), 0) / stats.count;
    const desviacion = Math.sqrt(varianza);
    
    stats.promedio = promedio;
    stats.desviacion = desviacion;
  });
  
  // Detectar anomalías (movimientos > 2 desviaciones estándar)
  const anomalias = [];
  
  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const monto = Math.abs(row[4]);
    const categoria = row[15];
    const descripcion = row[8];
    
    if (!categoria || !statsPorCategoria.has(categoria)) return;
    
    const stats = statsPorCategoria.get(categoria);
    const umbral = stats.promedio + (2 * stats.desviacion);
    
    if (monto > umbral && stats.count > 5) {
      anomalias.push([
        new Date(),
        'Monto Inusual',
        `${categoria}: $${monto.toFixed(2)} (promedio: $${stats.promedio.toFixed(2)})`,
        descripcion,
        rowNum,
        'Pendiente'
      ]);
    }
  });
  
  // Agregar a Revision_Humana
  if (anomalias.length > 0 && sheetRevisiones) {
    const targetRow = sheetRevisiones.getLastRow() + 1;
    sheetRevisiones.getRange(targetRow, 1, anomalias.length, 6).setValues(anomalias);
  }
  
  Logger.log(`Anomalías detectadas: ${anomalias.length}`);
  return { anomalias: anomalias.length };
}

/**
 * FUNCIÓN 4: Predicción de flujo de caja
 * Predice gastos futuros basado en patrones históricos
 */
function predecirFlujoCaja() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  
  if (!sheetMaestros || sheetMaestros.getLastRow() <= 1) {
    return { ingresos: 0, egresos: 0, neto: 0 };
  }
  
  const data = sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues();
  
  // Filtrar últimos 90 días
  const hoy = new Date();
  const hace90Dias = new Date();
  hace90Dias.setDate(hoy.getDate() - 90);
  
  let totalIngresos = 0;
  let totalEgresos = 0;
  let countDias = 90;
  
  data.forEach(row => {
    const fecha = new Date(row[3]);
    const monto = row[4];
    
    if (fecha >= hace90Dias) {
      if (monto > 0) {
        totalIngresos += monto;
      } else {
        totalEgresos += Math.abs(monto);
      }
    }
  });
  
  // Promedio diario * 30 días
  const ingresosDiarios = totalIngresos / countDias;
  const egresosDiarios = totalEgresos / countDias;
  
  const prediccionIngresos30d = ingresosDiarios * 30;
  const prediccionEgresos30d = egresosDiarios * 30;
  const prediccionNeto30d = prediccionIngresos30d - prediccionEgresos30d;
  
  Logger.log(`Predicción 30d: Ingresos $${prediccionIngresos30d.toFixed(2)}, Egresos $${prediccionEgresos30d.toFixed(2)}, Neto $${prediccionNeto30d.toFixed(2)}`);
  
  return {
    ingresos: prediccionIngresos30d,
    egresos: prediccionEgresos30d,
    neto: prediccionNeto30d
  };
}
