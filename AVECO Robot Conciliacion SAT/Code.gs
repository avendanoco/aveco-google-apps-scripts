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
