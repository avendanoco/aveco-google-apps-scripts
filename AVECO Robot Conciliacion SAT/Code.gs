/**
 * ============================================================
 * AVECO DataLake — Apps Script COMPLETO
 * Proyecto: 15jHH5sET-bgE29uwED_YVjumXt3s-4YESfiLfANBuhyq1HFyEIBc820c
 * ============================================================
 * 
 * INSTRUCCIONES DE INSTALACIÓN:
 * 1. Abre script.google.com → tu proyecto AVECO
 * 2. En el menú izquierdo: Archivos → "+" → Script
 * 3. Nómbralo "Charly" (o reemplaza el Code.gs existente)
 * 4. Pega TODO este código
 * 5. Guarda (Ctrl+S)
 * 6. Haz clic en "Implementar" → "Nueva implementación"
 *    - Tipo: Aplicación web
 *    - Ejecutar como: Yo (aveco.bancos@gmail.com o tu cuenta)
 *    - Quién tiene acceso: Cualquier usuario
 * 7. Copia la nueva URL del Web App
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN CENTRAL
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  SPREADSHEET_ID: '1ZRtRjgKAbeYXywV0cbVf73UzjYNgC-n6gmcOg9j3R8c',
  HOJAS: {
    CFDI_SAT:             'CFDI_SAT',
    BOARD_NORMALIZADO:    'BOARD_NORMALIZADO',
    BANCARIOS:            'MOVIMIENTOS_BANCARIOS',
    SESIONES_CHARLY:      'Sesiones_Charly',
    REVISION_HUMANA:      'Revision_Humana',
    CATALOGO_CUENTAS:     'Catalogo_Cuentas',
    CATALOGO_OBRAS:       'Catalogo_Obras',
    MOVIMIENTOS_MAESTROS: 'Movimientos_Maestros',
    ESTANDARES_BOARD:     'Estandares_Board',
  }
};

// ─────────────────────────────────────────────────────────────
// ROUTER PRINCIPAL — doPost
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    switch (action) {
      case 'getStatus':         return jsonResponse(getStatus());
      case 'getPendingReview':  return jsonResponse(getPendingReview(body));
      case 'saveDecision':      return jsonResponse(saveDecision(body));
      case 'getConciliacion':   return jsonResponse(getConciliacion(body));
      case 'getBancarios':      return jsonResponse(getBancarios(body));
      case 'getSATCFDIs':       return jsonResponse(getSATCFDIs(body));
      case 'logSesionCharly':   return jsonResponse(logSesionCharly(body));
      case 'getResumenDiario':  return jsonResponse(getResumenDiario());
      default:
        return jsonResponse({ success: false, error: `Acción desconocida: ${action}` });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString(), stack: err.stack });
  }
}

// También responder a GET para verificar que el script está activo
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    return jsonResponse({ success: true, status: 'AVECO DataLake activo', timestamp: new Date().toISOString() });
  }
  if (action === 'getStatus') {
    return jsonResponse(getStatus());
  }
  return jsonResponse({ success: false, error: 'Usa POST para acciones de datos' });
}

// ─────────────────────────────────────────────────────────────
// 1. getStatus — Estado general del DataLake
// ─────────────────────────────────────────────────────────────
function getStatus() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const resultado = { success: true, hojas: {}, timestamp: new Date().toISOString() };

  for (const [key, nombre] of Object.entries(CONFIG.HOJAS)) {
    const sheet = ss.getSheetByName(nombre);
    resultado.hojas[key] = sheet
      ? { nombre, filas: Math.max(0, sheet.getLastRow() - 1), existe: true }
      : { nombre, existe: false };
  }

  // Contar pendientes de revisión
  const sheetRev = ss.getSheetByName(CONFIG.HOJAS.REVISION_HUMANA);
  if (sheetRev && sheetRev.getLastRow() > 1) {
    const datos = sheetRev.getRange(2, 1, sheetRev.getLastRow() - 1, sheetRev.getLastColumn()).getValues();
    const headers = sheetRev.getRange(1, 1, 1, sheetRev.getLastColumn()).getValues()[0];
    const idxEstado = headers.findIndex(h => h.toString().toLowerCase().includes('estado'));
    const pendientes = datos.filter(r => {
      const estado = idxEstado >= 0 ? r[idxEstado].toString().toLowerCase() : '';
      return estado === 'pendiente' || estado === '';
    }).length;
    resultado.revisionPendiente = pendientes;
  }

  return resultado;
}

// ─────────────────────────────────────────────────────────────
// 2. getPendingReview — Movimientos para que Charly analice
// ─────────────────────────────────────────────────────────────
function getPendingReview(body) {
  const limite = body.limite || 10;
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.HOJAS.REVISION_HUMANA);

  if (!sheet || sheet.getLastRow() < 2) {
    return { success: true, pendientes: [], total: 0, mensaje: 'Sin movimientos pendientes de revisión' };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  const colIdx = {};
  headers.forEach((h, i) => { if (h) colIdx[h.toString().trim()] = i; });

  const idxEstado = colIdx['estado_revision'] ?? colIdx['estado'] ?? 14;

  const pendientes = datos
    .map((row, i) => {
      const obj = { _fila: i + 2 };
      headers.forEach((h, j) => { if (h) obj[h.toString().trim()] = row[j]; });
      return obj;
    })
    .filter(row => {
      const estado = (row['estado_revision'] || row['estado'] || '').toString().toLowerCase();
      return (estado === 'pendiente' || estado === '') && row['id_interno'];
    })
    .slice(0, limite)
    .map(mov => {
      const monto = parseFloat(mov.monto || 0);
      const confianza = parseFloat(mov.confianza_categoria || 0);
      const problemas = [];
      if (!mov.categoria_board || confianza < 0.5) problemas.push('sin_categoria');
      if (!mov.centro_costo_id_obra) problemas.push('sin_obra');
      if (!mov.uuid_cfdi && Math.abs(monto) > 1000) problemas.push('sin_cfdi_alto_monto');
      if ((mov.notas_revision || '').toString().includes('ANOMALIA')) problemas.push('anomalia');
      return {
        ...mov,
        tipo_problema: problemas,
        monto_fmt: formatMXN(monto)
      };
    });

  return {
    success: true,
    pendientes,
    total: pendientes.length,
    sinCategoria: pendientes.filter(p => p.tipo_problema.includes('sin_categoria')).length,
    sinObra: pendientes.filter(p => p.tipo_problema.includes('sin_obra')).length,
    anomalias: pendientes.filter(p => p.tipo_problema.includes('anomalia')).length,
    fecha_consulta: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
// 3. saveDecision — Charly guarda decisión del usuario
// ─────────────────────────────────────────────────────────────
function saveDecision(body) {
  const { id_interno, categoria, obra, notas, estado } = body;
  if (!id_interno) return { success: false, error: 'Falta id_interno' };

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.HOJAS.REVISION_HUMANA);
  if (!sheet) return { success: false, error: 'Hoja Revision_Humana no encontrada' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx = {};
  headers.forEach((h, i) => { if (h) colIdx[h.toString().trim()] = i; });

  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const idxId = colIdx['id_interno'] ?? 0;

  for (let i = 0; i < datos.length; i++) {
    if (datos[i][idxId] && datos[i][idxId].toString() === id_interno.toString()) {
      const fila = i + 2;
      if (categoria && colIdx['categoria_board'] !== undefined)
        sheet.getRange(fila, colIdx['categoria_board'] + 1).setValue(categoria);
      if (obra && colIdx['centro_costo_id_obra'] !== undefined)
        sheet.getRange(fila, colIdx['centro_costo_id_obra'] + 1).setValue(obra);
      if (notas && colIdx['notas_revision'] !== undefined)
        sheet.getRange(fila, colIdx['notas_revision'] + 1).setValue(notas);
      
      const idxEstado = colIdx['estado_revision'] ?? colIdx['estado'];
      if (idxEstado !== undefined)
        sheet.getRange(fila, idxEstado + 1).setValue(estado || 'revisado');
      
      const idxFechaRev = colIdx['fecha_revision'];
      if (idxFechaRev !== undefined)
        sheet.getRange(fila, idxFechaRev + 1).setValue(new Date().toISOString());

      return { success: true, mensaje: `Movimiento ${id_interno} actualizado`, fila };
    }
  }
  return { success: false, error: `No se encontró id_interno: ${id_interno}` };
}

// ─────────────────────────────────────────────────────────────
// 4. getConciliacion — Resumen de conciliación SAT vs Board
// ─────────────────────────────────────────────────────────────
function getConciliacion(body) {
  const desde = body.desde || getHaceNDias(90);
  const hasta = body.hasta || hoy();
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Leer CFDIs SAT
  const sheetSAT = ss.getSheetByName(CONFIG.HOJAS.CFDI_SAT);
  const satData = leerHoja(sheetSAT);
  const satFiltrado = satData.filter(r => {
    const f = (r.fecha || r.Fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta && parseFloat(r.total || r.Total || 0) !== 0;
  });

  // Leer Board normalizado
  const sheetBoard = ss.getSheetByName(CONFIG.HOJAS.BOARD_NORMALIZADO);
  const boardData = leerHoja(sheetBoard);
  const boardEgresos = boardData.filter(r => {
    const f = (r.fecha || '').toString().substring(0, 10);
    const monto = parseFloat(r.monto || 0);
    return f >= desde && f <= hasta && monto < 0;
  });

  // Leer bancarios
  const sheetBanc = ss.getSheetByName(CONFIG.HOJAS.BANCARIOS);
  const bancData = leerHoja(sheetBanc);
  const bancFiltrado = bancData.filter(r => {
    const f = (r.fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta;
  });

  const totalSAT = satFiltrado.reduce((s, r) => s + parseFloat(r.total || r.Total || 0), 0);
  const totalBoard = boardEgresos.reduce((s, r) => s + Math.abs(parseFloat(r.monto || 0)), 0);
  const totalBanc = bancFiltrado
    .filter(r => r.tipo === 'EGRESO')
    .reduce((s, r) => s + parseFloat(r.monto || 0), 0);

  return {
    success: true,
    periodo: { desde, hasta },
    sat: { total: satFiltrado.length, importe: totalSAT },
    board: { total: boardEgresos.length, importe: totalBoard },
    bancarios: { total: bancFiltrado.length, egresos: totalBanc },
    cobertura_pct: totalSAT > 0 ? Math.round((Math.min(totalBoard, totalSAT) / totalSAT) * 100) : 0,
    generado: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
// 5. getBancarios — Movimientos bancarios (con filtros)
// ─────────────────────────────────────────────────────────────
function getBancarios(body) {
  const desde = body.desde || getHaceNDias(30);
  const hasta = body.hasta || hoy();
  const banco = body.banco || null;
  const tipo = body.tipo || null;   // EGRESO | INGRESO
  const limite = body.limite || 50;

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.HOJAS.BANCARIOS);
  if (!sheet) return { success: false, error: 'Hoja MOVIMIENTOS_BANCARIOS no encontrada' };

  let datos = leerHoja(sheet);

  datos = datos.filter(r => {
    const f = (r.fecha || '').toString().substring(0, 10);
    if (f < desde || f > hasta) return false;
    if (banco && r.banco !== banco) return false;
    if (tipo && r.tipo !== tipo) return false;
    return true;
  });

  datos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  const totalEgresos = datos.filter(r => r.tipo === 'EGRESO').reduce((s, r) => s + parseFloat(r.monto || 0), 0);
  const totalIngresos = datos.filter(r => r.tipo === 'INGRESO').reduce((s, r) => s + parseFloat(r.monto || 0), 0);

  return {
    success: true,
    periodo: { desde, hasta },
    movimientos: datos.slice(0, limite),
    total_registros: datos.length,
    resumen: {
      egresos: { count: datos.filter(r => r.tipo === 'EGRESO').length, importe: totalEgresos },
      ingresos: { count: datos.filter(r => r.tipo === 'INGRESO').length, importe: totalIngresos },
      neto: totalIngresos - totalEgresos
    }
  };
}

// ─────────────────────────────────────────────────────────────
// 6. getSATCFDIs — Facturas SAT con filtros
// ─────────────────────────────────────────────────────────────
function getSATCFDIs(body) {
  const desde = body.desde || getHaceNDias(90);
  const hasta = body.hasta || hoy();
  const soloSinMatch = body.soloSinMatch || false;

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.HOJAS.CFDI_SAT);
  if (!sheet) return { success: false, error: 'Hoja CFDI_SAT no encontrada' };

  let datos = leerHoja(sheet);
  datos = datos.filter(r => {
    const f = (r.fecha || r.Fecha || '').toString().substring(0, 10);
    const total = parseFloat(r.total || r.Total || 0);
    return f >= desde && f <= hasta && total !== 0;
  });

  if (soloSinMatch) {
    datos = datos.filter(r => !r.board_match_id && !r.conciliado);
  }

  const totalImporte = datos.reduce((s, r) => s + parseFloat(r.total || r.Total || 0), 0);

  return {
    success: true,
    periodo: { desde, hasta },
    cfdis: datos.slice(0, body.limite || 100),
    total: datos.length,
    importe_total: totalImporte
  };
}

// ─────────────────────────────────────────────────────────────
// 7. logSesionCharly — Guardar log de sesión de Charly
// ─────────────────────────────────────────────────────────────
function logSesionCharly(body) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.HOJAS.SESIONES_CHARLY);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.HOJAS.SESIONES_CHARLY);
    sheet.getRange(1, 1, 1, 5).setValues([['fecha', 'tipo', 'resumen', 'sesion_json', 'estado']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date().toISOString(),
    body.tipo || 'sesion',
    body.resumen || '',
    JSON.stringify(body.datos || {}),
    body.estado || 'ok'
  ]);

  return { success: true, mensaje: 'Sesión registrada' };
}

// ─────────────────────────────────────────────────────────────
// 8. getResumenDiario — Para el briefing matutino de Charly
// ─────────────────────────────────────────────────────────────
function getResumenDiario() {
  const hoyStr = hoy();
  const hace7 = getHaceNDias(7);
  const hace30 = getHaceNDias(30);

  const concil30 = getConciliacion({ desde: hace30, hasta: hoyStr });
  const bancarios7 = getBancarios({ desde: hace7, hasta: hoyStr, limite: 20 });
  const pendientes = getPendingReview({ limite: 5 });

  return {
    success: true,
    fecha: hoyStr,
    conciliacion_30d: concil30,
    bancarios_7d: bancarios7.resumen || {},
    pendientes_revision: pendientes.total || 0,
    top_pendientes: (pendientes.pendientes || []).slice(0, 3),
    generado: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function leerHoja(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return datos.map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h.toString().trim()] = row[i]; });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== '' && v !== null && v !== undefined));
}

function hoy() {
  return Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');
}

function getHaceNDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, 'America/Mexico_City', 'yyyy-MM-dd');
}

function formatMXN(monto) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

// ─────────────────────────────────────────────────────────────
// FUNCIÓN DE PRUEBA — Ejecuta desde el editor para verificar
// ─────────────────────────────────────────────────────────────
function testScript() {
  Logger.log('=== TEST getStatus ===');
  Logger.log(JSON.stringify(getStatus(), null, 2));

  Logger.log('=== TEST getResumenDiario ===');
  Logger.log(JSON.stringify(getResumenDiario(), null, 2));

  Logger.log('=== TEST getPendingReview ===');
  Logger.log(JSON.stringify(getPendingReview({ limite: 3 }), null, 2));
}
// ========================================
// Script 1: RENOMBRAR ARCHIVOS SAT
// Formato: "mov sat YYMM - nombre_original"
// ========================================


// Webhook endpoint para n8n

// Función principal para renombrar archivos
function renameAllSATFiles() {
  const folder = DriveApp.getFolderById(SAT_FOLDER_ID);
  const files = folder.getFiles();
  
  let filesRenamed = 0;
  let filesSkipped = 0;
  const renamedList = [];
  
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    
    // Solo renombrar si NO empieza con "mov sat" (case insensitive)
    if (!fileName.toLowerCase().startsWith('mov sat')) {
      try {
        // Obtener año y mes de la fecha de creación
        const fileDate = file.getDateCreated();
        const year = fileDate.getFullYear().toString().substr(-2);
        const month = ('0' + (fileDate.getMonth() + 1)).slice(-2);
        const newName = 'mov sat ' + year + month + ' - ' + fileName;
        
        file.setName(newName);
        filesRenamed++;
        renamedList.push({ old: fileName, new: newName });
        
      } catch (error) {
        Logger.log('Error renombrando ' + fileName + ': ' + error);
      }
    } else {
      filesSkipped++;
    }
  }
  
  // Enviar notificación por email
  if (filesRenamed > 0) {
    sendEmailNotification(
      'Archivos SAT Renombrados',
      `Se renombraron ${filesRenamed} archivos.\n` +
      `Archivos omitidos (ya renombrados): ${filesSkipped}\n\n` +
      `Lista de archivos renombrados:\n` +
      renamedList.map(f => `- ${f.old} -> ${f.new}`).join('\n')
    );
  }
  
  return {
    success: true,
    filesRenamed: filesRenamed,
    filesSkipped: filesSkipped,
    message: `Renombrado completado: ${filesRenamed} archivos renombrados, ${filesSkipped} omitidos`
  };
}

// Enviar notificación por email
function sendEmailNotification(subject, body) {
  MailApp.sendEmail({
    to: EMAIL_NOTIFICATION,
    subject: `[AVECO Robot SAT] ${subject}`,
    body: body
  });
}
// ========================================
// Script 2: IMPORTAR DATOS SAT A SHEETS
// Importa archivos SAT desde carpeta Drive
// ========================================


// Webhook endpoint para n8n


// Importar datos SAT
function importSATFromFolder() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetRaw = ss.getSheetByName('CFDI_SAT_RAW');
  const sheetClean = ss.getSheetByName('CFDI_SAT');
  
  // Limpiar datos - mantener solo encabezados fila 1
  const lastRowRaw = sheetRaw.getLastRow();
  const lastRowClean = sheetClean.getLastRow();
  
  if (lastRowRaw > 1) {
    sheetRaw.deleteRows(2, lastRowRaw - 1);
  }
  if (lastRowClean > 1) {
    sheetClean.deleteRows(2, lastRowClean - 1);
  }
  
  // Leer archivos SAT
  const folder = DriveApp.getFolderById(SAT_FOLDER_ID);
  const files = folder.getFiles();
  
  let totalRecords = 0;
  let filesProcessed = 0;
  
  while (files.hasNext()) {
    const file = files.next();
    const content = file.getBlob().getDataAsString();
    const lines = content.split('\n');
    
    // Saltar primera línea (encabezados)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      
      const fields = line.split('~');
      
      if (fields.length >= 11) {
        const uuid = fields[0];
        const rfcEmisor = fields[1];
        const nombreEmisor = fields[2];
        const fechaEmision = normalizeDate(fields[6]);
        const monto = parseFloat(fields[8].replace(/,/g, ''));
        const estatus = fields[10];
        
        const subtotal = monto / 1.16;
        const iva = monto - subtotal;
        
        sheetRaw.appendRow([
          uuid,
          rfcEmisor,
          nombreEmisor,
          fechaEmision,
          subtotal.toFixed(2),
          iva.toFixed(2),
          monto.toFixed(2),
          'MXN',
          '',
          fields[9] || 'I',
          estatus
        ]);
        
        totalRecords++;
      }
    }
    
    filesProcessed++;
  }
  
  // Copiar a hoja CFDI_SAT
  if (totalRecords > 0) {
    const dataRange = sheetRaw.getRange(2, 1, totalRecords, 11);
    const data = dataRange.getValues();
    
    data.forEach(row => {
      sheetClean.appendRow([...row, '']);
    });
  }
  
  // Eliminar duplicados
  const dupResult = detectAndRemoveDuplicates();
  
  // Notificación
  sendEmailNotificationImport(
    'Importación SAT Completada',
    `Se importaron ${totalRecords} registros de ${filesProcessed} archivos.\n` +
    `Duplicados eliminados: ${dupResult.duplicatesRemoved}`
  );
  
  return {
    success: true,
    totalRecords: totalRecords,
    filesProcessed: filesProcessed,
    duplicatesRemoved: dupResult.duplicatesRemoved,
    message: `Importación completada: ${totalRecords} registros de ${filesProcessed} archivos`
  };
}

// Detectar y eliminar duplicados
function detectAndRemoveDuplicates() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('CFDI_SAT');
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, duplicatesRemoved: 0 };
  
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const seen = {};
  const rowsToDelete = [];
  
  for (let i = 0; i < data.length; i++) {
    const uuid = data[i][0];
    if (seen[uuid]) {
      rowsToDelete.push(i + 2);
    } else {
      seen[uuid] = true;
    }
  }
  
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  return {
    success: true,
    duplicatesRemoved: rowsToDelete.length,
    message: `Se eliminaron ${rowsToDelete.length} duplicados`
  };
}

// Normalizar fecha
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

// Enviar email
function sendEmailNotificationImport(subject, body) {
  MailApp.sendEmail({
    to: EMAIL_NOTIFICATION,
    subject: `[AVECO Robot SAT] ${subject}`,
    body: body
  });
}
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
// ============================================
// Script 6: MENÚ PERSONALIZADO + FLUJO COMPLETO
// Custom menu en Google Sheets para ejecutar automatizaciones
// ============================================


/**
 * onOpen - Crea menú personalizado al abrir spreadsheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Robot Finanzas AVECO')
    .addSubMenu(ui.createMenu('🏦 Movimientos Bancarios')
      .addItem('1. Normalizar Movimientos Bancarios', 'menuNormalizarBancos')
      .addItem('2. Auto-categorizar Movimientos', 'menuCategorizarMovimientos'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📄 SAT / CFDI')
      .addItem('Importar CFDI desde Drive', 'importSATFromFolder')
      .addItem('Detectar Duplicados SAT', 'detectAndRemoveDuplicates'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📊 Board Export')
      .addItem('Exportar a Board (Estandares_Board)', 'menuExportarBoard'))
    .addSeparator()
        .addSubMenu(ui.createMenu('⚡ Análisis Avanzado')
      .addItem('1. Detectar Transferencias Internas', 'menuDetectarTransferencias')
      .addItem('2. Entrenar Modelo ML', 'menuEntrenarModelo')
      .addItem('3. Detectar Anomalías', 'menuDetectarAnomalias')
      .addItem('4. Predecir Flujo de Caja (30d)', 'menuPredecirFlujoCaja'))
    .addItem('▶️ EJECUTAR FLUJO COMPLETO', 'menuFlujoCompleto')
    .addSeparator()
    .addItem('⚙️ Configuración y Estado', 'menuEstado')
    .addToUi();
}

/**
 * FLUJO COMPLETO: Normaliza → Categoriza → Exporta a Board
 */
function menuFlujoCompleto() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    'Ejecutar Flujo Completo',
    '¿Deseas ejecutar todo el proceso automatizado?\n\n' +
    '1. Normalizar movimientos bancarios\n' +
    '2. Auto-categorizar movimientos\n' +
    '3. Exportar a Board\n\n' +
    'Esto puede tomar varios minutos.',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    return;
  }
  
  try {
    ui.alert('Iniciando proceso...');
    
    // Paso 1: Normalizar
    const result1 = normalizarMovimientosBancarios();
    Logger.log('Normalización: ' + JSON.stringify(result1));
    
    // Paso 2: Categorizar
    const result2 = categorizarMovimientos();
    Logger.log('Categorización: ' + JSON.stringify(result2));
    
    // Paso 3: Exportar a Board
    const result3 = exportarABoard();
    Logger.log('Exportación: ' + JSON.stringify(result3));
    
    ui.alert(
      'Proceso Completado ✅',
      `Resultados:\n\n` +
      `🏦 Normalización: ${result1.insertados} movimientos insertados (${result1.duplicados} duplicados)\n` +
      `🏷️ Categorización: ${result2.categorizados} movimientos categorizados\n` +
      `📊 Board Export: ${result3.exportados} registros exportados`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    ui.alert('❌ Error', 'Ocurrió un error: ' + error.message, ui.ButtonSet.OK);
    Logger.log('Error en flujo completo: ' + error.message);
  }
}

/**
 * Menú: Normalizar movimientos bancarios
 */
function menuNormalizarBancos() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = normalizarMovimientosBancarios();
    ui.alert(
      'Normalización Completada',
      `Procesados: ${result.procesados}\n` +
      `Insertados: ${result.insertados}\n` +
      `Duplicados: ${result.duplicados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Auto-categorizar movimientos
 */
function menuCategorizarMovimientos() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = categorizarMovimientos();
    ui.alert(
      'Categorización Completada',
      `Procesados: ${result.procesados}\n` +
      `Categorizados: ${result.categorizados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Exportar a Board
 */
function menuExportarBoard() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = exportarABoard();
    ui.alert(
      'Exportación Completada',
      `Procesados: ${result.procesados}\n` +
      `Exportados: ${result.exportados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Mostrar estado del sistema
 */
function menuEstado() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  try {
    const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
    const sheetBancos = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');
    const sheetBoard = ss.getSheetByName('Estandares_Board');
    const sheetCategorias = ss.getSheetByName('Catalogo_Categorias');
    
    const countMaestros = sheetMaestros ? sheetMaestros.getLastRow() - 1 : 0;
    const countBancos = sheetBancos ? sheetBancos.getLastRow() - 1 : 0;
    const countBoard = sheetBoard ? sheetBoard.getLastRow() - 1 : 0;
    const countCategorias = sheetCategorias ? sheetCategorias.getLastRow() - 1 : 0;
    
    // Contar categorizados
    let categorizados = 0;
    if (sheetMaestros && sheetMaestros.getLastRow() > 1) {
      const data = sheetMaestros.getRange(2, 13, countMaestros, 1).getValues();
      categorizados = data.filter(row => row[0]).length;
    }
    
    ui.alert(
      'Estado del Sistema',
      `📈 Estadísticas:\n\n` +
      `🏦 Movimientos Bancarios: ${countBancos} registros\n` +
      `📋 Movimientos Maestros: ${countMaestros} registros\n` +
      `🏷️ Categorizados: ${categorizados} / ${countMaestros}\n` +
      `📊 Board Export: ${countBoard} registros\n` +
      `📚 Catálogo Categorías: ${countCategorias} categorías`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

// ============================================
// FUNCIONES DE MENÚ AVANZADAS
// ============================================

/**
 * Menú: Detectar transferencias internas
 */
function menuDetectarTransferencias() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = detectarTransferenciasInternas();
    ui.alert(
      '✅ Transferencias Detectadas',
      `Transferencias detectadas: ${result.detectadas}\n` +
      `Movimientos pareados: ${result.pareadas}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Entrenar modelo ML
 */
function menuEntrenarModelo() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = entrenarModeloCategorizacion();
    ui.alert(
      '🧠 Modelo Entrenado',
      `Patrones aprendidos: ${result.patrones}\n` +
      `Categorías analizadas: ${result.categorias}\n\n` +
      'Los datos se guardaron en "ML_Training_Data"',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Detectar anomalías
 */
function menuDetectarAnomalias() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = detectarAnomalias();
    ui.alert(
      '🔍 Anomalías Detectadas',
      `Movimientos inusuales encontrados: ${result.anomalias}\n\n` +
      (result.anomalias > 0 ? 'Revisa la hoja "Revision_Humana" para más detalles.' : 'No se encontraron anomalías.'),
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Predecir flujo de caja
 */
function menuPredecirFlujoCaja() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = predecirFlujoCaja();
    ui.alert(
      '📊 Predicción de Flujo de Caja (30 días)',
      `🟢 Ingresos estimados: $${result.ingresos.toFixed(2)}\n` +
      `🔴 Egresos estimados: $${result.egresos.toFixed(2)}\n` +
      `🟡 Balance neto: $${result.neto.toFixed(2)}\n\n` +
      'Basado en promedio de últimos 90 días',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}
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
/**
 * AGREGAR ESTO A TU APPS SCRIPT EXISTENTE (Code.gs o un nuevo archivo CharlyEndpoint.gs)
 * 
 * Este endpoint es llamado por Charly (n8n) cada mañana para obtener 
 * los movimientos que necesitan decisión humana.
 */

// ============================================================
// AGREGA ESTE CASE A TU doPost EXISTENTE:
// ============================================================
// case 'getPendingReview':
//   return getPendingReviewMovements();

/**
 * Obtiene movimientos pendientes de revisión para que Charly los analice
 */
function getPendingReviewMovements() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetRevision = ss.getSheetByName('Revision_Humana');
  
  if (!sheetRevision || sheetRevision.getLastRow() < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        pendientes: [],
        total: 0,
        mensaje: 'Sin movimientos pendientes'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const headers = sheetRevision.getRange(1, 1, 1, sheetRevision.getLastColumn()).getValues()[0];
  const data = sheetRevision.getRange(2, 1, sheetRevision.getLastRow() - 1, sheetRevision.getLastColumn()).getValues();
  
  // Mapear columnas por nombre
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h.toString().trim()] = i; });
  
  // Filtrar solo pendientes
  const pendientes = data
    .filter(row => {
      const estado = row[colIdx['estado_revision'] ?? 14]?.toString().toLowerCase() || '';
      return estado === 'pendiente' || estado === '';
    })
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h.toString().trim()] = row[i];
      });
      return obj;
    })
    .filter(row => row.id_interno) // Solo filas con ID
    .slice(0, 15); // Máximo 15 por sesión
  
  // Enriquecer con contexto de anomalías
  const pendientesEnriquecidos = pendientes.map(mov => {
    const monto = parseFloat(mov.monto || 0);
    const confianza = parseFloat(mov.confianza_categoria || 0);
    
    let tipoProblema = [];
    if (!mov.categoria_board || confianza < 0.5) tipoProblema.push('sin_categoria');
    if (!mov.centro_costo_id_obra) tipoProblema.push('sin_obra');
    if (!mov.uuid_cfdi && monto < -1000) tipoProblema.push('sin_cfdi_alto_monto');
    if (mov.notas_revision && mov.notas_revision.toString().includes('ANOMALIA')) tipoProblema.push('anomalia');
    
    return {
      ...mov,
      tipo_problema: tipoProblema,
      monto_formateado: new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto)
    };
  });
  
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      pendientes: pendientesEnriquecidos,
      total: pendientesEnriquecidos.length,
      sinCategoria: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('sin_categoria')).length,
      sinObra: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('sin_obra')).length,
      anomalias: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('anomalia')).length,
      fecha_consulta: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * TAMBIÉN AGREGA ESTA NUEVA HOJA A TU SHEET - Sesiones_Charly
 * Con estos encabezados (fila 1):
 * fecha | sesion_json | estado | mensaje | fecha_respuesta
 * 
 * Corre esta función UNA VEZ para crear la hoja automáticamente:
 */
function crearHojaSesionesCharly() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  let sheet = ss.getSheetByName('Sesiones_Charly');
  if (!sheet) {
    sheet = ss.insertSheet('Sesiones_Charly');
    Logger.log('Hoja Sesiones_Charly creada');
  }
  
  // Solo agregar headers si la hoja está vacía
  if (sheet.getLastRow() === 0) {
    const headers = ['fecha', 'sesion_json', 'estado', 'mensaje', 'fecha_respuesta'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    Logger.log('Headers de Sesiones_Charly creados');
  }
  
  // Confirmar
  Logger.log('✅ Hoja Sesiones_Charly lista. Charly puede operar.');
}


/**
 * FUNCIÓN DE PRUEBA: Simula lo que Charly verá mañana en la mañana
 * Ejecútala manualmente desde el editor de Apps Script para probar
 */
function testGetPendingReview() {
  const result = getPendingReviewMovements();
  Logger.log('Respuesta de getPendingReview:');
  Logger.log(result.getContent());
}
