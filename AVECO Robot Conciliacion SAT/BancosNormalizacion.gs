// ============================================
// Script 3: NORMALIZAR MOVIMIENTOS BANCARIOS
// Lee MOVIMIENTOS_BANCARIOS → Normaliza → Movimientos_Maestros
// ============================================


/**
 * Normaliza movimientos bancarios desde MOVIMIENTOS_BANCARIOS a Movimientos_Maestros
 */
function normalizarMovimientosBancarios() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetBancos = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  
  if (!sheetBancos || !sheetMaestros) {
    throw new Error('Sheets MOVIMIENTOS_BANCARIOS o Movimientos_Maestros no encontradas');
  }
  
  // Leer movimientos bancarios (skip header)
  const lastRowBancos = sheetBancos.getLastRow();
  if (lastRowBancos <= 1) {
    Logger.log('No hay movimientos bancarios para procesar');
    return { procesados: 0, duplicados: 0, insertados: 0 };
  }
  
  const dataBancos = sheetBancos.getRange(2, 1, lastRowBancos - 1, 13).getValues();
  
  // Leer maestros existentes para dedup
  const lastRowMaestros = sheetMaestros.getLastRow();
  let existingIds = new Set();
  
  if (lastRowMaestros > 1) {
    const existingData = sheetMaestros.getRange(2, 1, lastRowMaestros - 1, 1).getValues();
    existingIds = new Set(existingData.map(row => row[0]));
  }
  
  let procesados = 0;
  let duplicados = 0;
  let insertados = 0;
  const newRows = [];
  
  dataBancos.forEach(row => {
    const [banco, cuentaBancaria, fechaMovimiento, monto, moneda, tipoMovimiento, 
           descripcionOriginal, conceptoLimpio, referencia, folioBanco, categoriaDetectada, 
           confidenciaCategoria, estado] = row;
    
    // Skip empty rows
    if (!banco && !cuentaBancaria) return;
    
    procesados++;
    
    // Generar ID único
    const idInterno = generarIdInterno(banco, cuentaBancaria, fechaMovimiento, monto, folioBanco);
    
    // Check duplicates
    if (existingIds.has(idInterno)) {
      duplicados++;
      return;
    }
    
    // Build row for Movimientos_Maestros
    // Schema: id_interno, banco, cuenta_bancaria, fecha_movimiento, monto, moneda, 
    //         tipo_movimiento, descripcion_original, descripcion_limpia, referencia, 
    //         folio_banco, saldo_resultante, categoria_nivel1, categoria_nivel2, 
    //         categoria_board_id, categoria_board_nombre, confidence_score, estado_conciliacion, 
    //         cuenta_contable, obra_id, etapa_id, transfer_id, uuid_sat, notas
    
    const maestroRow = [
      idInterno,
      banco,
      cuentaBancaria,
      fechaMovimiento,
      monto,
      moneda,
      tipoMovimiento,
      descripcionOriginal,
      conceptoLimpio || limpiarDescripcion(descripcionOriginal),
      referencia,
      folioBanco,
      '', // saldo_resultante (empty for now)
      '', // categoria_nivel1 (will be filled by categorization)
      '', // categoria_nivel2
      '', // categoria_board_id
      '', // categoria_board_nombre
      '', // confidence_score
      'Pendiente', // estado_conciliacion
      '', // cuenta_contable
      '', // obra_id
      '', // etapa_id
      '', // transfer_id
      '', // uuid_sat
      ''  // notas
    ];
    
    newRows.push(maestroRow);
    insertados++;
  });
  
  // Insert new rows to Movimientos_Maestros
  if (newRows.length > 0) {
    const targetRow = sheetMaestros.getLastRow() + 1;
    sheetMaestros.getRange(targetRow, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
  
  Logger.log(`Procesados: ${procesados}, Duplicados: ${duplicados}, Insertados: ${insertados}`);
  return { procesados, duplicados, insertados };
}

/**
 * Genera ID único para movimiento
 */
function generarIdInterno(banco, cuenta, fecha, monto, folio) {
  const fechaStr = Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), 'yyyyMMdd');
  const montoStr = String(monto).replace('.', '').replace('-', '');
  const raw = `${banco}_${cuenta}_${fechaStr}_${montoStr}_${folio || ''}`;
  return 'MOV_' + fechaStr + '_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 12)
    .toUpperCase();
}

/**
 * Limpia descripción bancaria removiendo caracteres especiales y espacios extra
 */
function limpiarDescripcion(desc) {
  if (!desc) return '';
  return String(desc)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}
