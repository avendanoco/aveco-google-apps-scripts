// ============================================
// Script 5: EXPORTAR A BOARD
// Genera datos listos para Board desde Movimientos_Maestros categorizados
// Formato: Estandares_Board (account, category, currency, amount, etc.)
// ============================================


/**
 * Exporta movimientos categorizados a formato Board
 */
function exportarABoard() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
  const sheetCuentas = ss.getSheetByName('Catalogo_Cuentas');
  const sheetBoardExport = ss.getSheetByName('Estandares_Board');
  
  if (!sheetMaestros || !sheetBoardExport) {
    throw new Error('Sheets necesarios no encontrados');
  }
  
  // Cargar catálogo de cuentas para mapear banco → account
  const cuentasMap = construirMapaCuentas(sheetCuentas);
  
  // Leer movimientos categorizados (que tengan categoria_board_nombre)
  const lastRow = sheetMaestros.getLastRow();
  if (lastRow <= 1) return { procesados: 0, exportados: 0 };
  
  const maestrosData = sheetMaestros.getRange(2, 1, lastRow - 1, 24).getValues();
  
  let procesados = 0;
  let exportados = 0;
  const exportRows = [];
  
  maestrosData.forEach(row => {
    const [idInterno, banco, cuentaBancaria, fechaMovimiento, monto, moneda, 
           tipoMovimiento, descripcionOriginal, descripcionLimpia, referencia, 
           folioBanco, saldoResultante, categoriaNivel1, categoriaNivel2, 
           categoriaBoardId, categoriaBoardNombre, confidenceScore, estadoConciliacion,
           cuentaContable, obraId, etapaId, transferId, uuidSat, notas] = row;
    
    // Solo exportar si está categorizado
    if (!categoriaBoardNombre) return;
    
    procesados++;
    
    // Map banco+cuenta to account name
    const accountKey = `${banco}|${cuentaBancaria}`;
    const accountName = cuentasMap.get(accountKey) || `${banco} - ${cuentaBancaria}`;
    
    // Determinar tipo: Expense o Income
    const tipo = monto < 0 ? 'Expense' : 'Income';
    
    // Determinar payment_type
    const paymentType = determinarPaymentType(descripcionLimpia);
    
    // Build Board row
    // Schema: account, category, currency, amount, ref_currency_amount, type, 
    //         payment_type, note, date, transfer, payee
    const boardRow = [
      accountName,
      categoriaBoardNombre,
      moneda,
      Math.abs(monto),
      Math.abs(monto), // ref_currency_amount (same as amount for MXN)
      tipo,
      paymentType,
      descripcionLimpia || descripcionOriginal,
      fechaMovimiento,
      transferId ? 'TRUE' : 'FALSE',
      referencia || '' // payee
    ];
    
    exportRows.push(boardRow);
    exportados++;
  });
  
  // Clear existing data (keep header)
  if (sheetBoardExport.getLastRow() > 1) {
    sheetBoardExport.deleteRows(2, sheetBoardExport.getLastRow() - 1);
  }
  
  // Insert new rows
  if (exportRows.length > 0) {
    sheetBoardExport.getRange(2, 1, exportRows.length, exportRows[0].length).setValues(exportRows);
  }
  
  Logger.log(`Procesados: ${procesados}, Exportados: ${exportados}`);
  return { procesados, exportados };
}

/**
 * Construye mapa de cuentas bancarias
 */
function construirMapaCuentas(sheetCuentas) {
  const map = new Map();
  
  if (!sheetCuentas || sheetCuentas.getLastRow() <= 1) {
    return map;
  }
  
  const cuentasData = sheetCuentas.getRange(2, 1, sheetCuentas.getLastRow() - 1, 2).getValues();
  
  cuentasData.forEach(row => {
    const [accountName, category] = row;
    // Assuming format: "Santander Operativa" or similar
    // You may need to parse banco/cuenta from account name
    map.set(accountName, accountName);
  });
  
  return map;
}

/**
 * Determina payment_type basado en descripción
 */
function determinarPaymentType(descripcion) {
  if (!descripcion) return 'Other';
  
  const desc = descripcion.toLowerCase();
  
  if (desc.includes('tarjeta') || desc.includes('card') || desc.includes('tdc')) {
    return 'Card';
  }
  if (desc.includes('transfer') || desc.includes('spei') || desc.includes('transf')) {
    return 'Transfer';
  }
  if (desc.includes('efectivo') || desc.includes('cash')) {
    return 'Cash';
  }
  if (desc.includes('cheque') || desc.includes('check')) {
    return 'Check';
  }
  
  return 'Other';
}
