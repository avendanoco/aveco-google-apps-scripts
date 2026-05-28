/**
 * =============================================================================
 * Project   : AVECO DataLake — Robot Conciliación SAT
 * Version   : 2.0.0
 * GWS Email : aveco.bancos@gmail.com
 * Author    : Antonio Avendaño / AVECO
 * Repo      : https://github.com/avendanoco/aveco-google-apps-scripts
 * Created   : 2026-04-10
 * Updated   : 2026-05-28
 * Description:
 *   Script unificado de conciliación financiera AVECO.
 *   Expone una Web App con endpoints GET/POST consumidos por el agente
 *   Python (Charly). Cubre el ciclo completo:
 *     1. Importar CFDIs SAT desde Google Drive
 *     2. Normalizar movimientos bancarios (RAW → MOVIMIENTOS_BANCARIOS)
 *     3. Auto-categorizar con keyword matching + ML desde historial Board
 *     4. Exportar a formato Board (BudgetBakers)
 *     5. Detectar transferencias internas y anomalías
 *     6. Exponer endpoints de consulta para Charly (agente IA)
 * Config requerida (Script Properties):
 *   SPREADSHEET_ID       → ID del Google Sheet DataLake
 *   DISCORD_WEBHOOK_URL  → Webhook del canal #finanzas en Discord
 *   SAT_FOLDER_ID        → ID de la carpeta Drive con archivos SAT
 *   EMAIL_NOTIFICATION   → Email para notificaciones secundarias (opcional)
 * Seguridad:
 *   No almacenar tokens ni secrets en este código.
 *   Usar Script Properties → Configuración del proyecto → Propiedades de script.
 * Despliegue:
 *   Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo | Acceso: Cualquier usuario
 * =============================================================================
 */

// =============================================================================
// CONFIGURACIÓN CENTRAL
// =============================================================================

/**
 * Retorna la configuración centralizada del proyecto.
 * Secrets se leen de Script Properties, con fallback al ID del DataLake.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    SPREADSHEET_ID: props.getProperty('SPREADSHEET_ID')
      || '1ZRtRjgKAbeYXywV0cbVf73UzjYNgC-n6gmcOg9j3R8c',
    DISCORD_WEBHOOK: props.getProperty('DISCORD_WEBHOOK_URL') || '',
    SAT_FOLDER_ID:   props.getProperty('SAT_FOLDER_ID') || '',
    EMAIL:           props.getProperty('EMAIL_NOTIFICATION') || '',
    TIMEZONE:        'America/Mexico_City',
    HOJAS: {
      CFDI_SAT_RAW:         'CFDI_SAT_RAW',
      CFDI_SAT:             'CFDI_SAT',
      BOARD_CSV_RAW:        'BOARD_CSV_RAW',
      BOARD_RAW:            'BOARD_RAW',
      BOARD_NORMALIZADO:    'BOARD_NORMALIZADO',
      BANCARIOS_RAW:        'MOVIMIENTOS_BANCARIOS_RAW',   // fuente de datos reales
      BANCARIOS:            'MOVIMIENTOS_BANCARIOS',        // normalizado (puede estar vacío)
      SESIONES_CHARLY:      'Sesiones_Charly',
      REVISION_HUMANA:      'Revision_Humana',
      MOVIMIENTOS_MAESTROS: 'Movimientos_Maestros',
      CATALOGO_CUENTAS:     'Catalogo_Cuentas',
      CATALOGO_OBRAS:       'Catalogo_Obras',
      ESTANDARES_BOARD:     'Estandares_Board',
      HISTORIAL_CONCILIACION: 'Historial_Conciliacion',
    },
  };
}

// =============================================================================
// ROUTER PRINCIPAL
// =============================================================================

/**
 * doGet — maneja TODAS las acciones via GET.
 * Necesario porque cuentas Gmail personales bloquean POST desde servidores externos.
 * El agente Python (charly_agent.py) usa exclusivamente GET.
 */
function doGet(e) {
  const p = e.parameter || {};
  const action = p.action || 'ping';
  try {
    return jsonResponse_(routeAction_(action, p));
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString(), action });
  }
}

/**
 * doPost — mantenido para uso interno y compatibilidad.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    return jsonResponse_(routeAction_(action, body));
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
  }
}

/**
 * Despacha la acción al handler correspondiente.
 */
function routeAction_(action, params) {
  switch (action) {
    case 'ping':             return { success: true, status: 'AVECO DataLake activo', timestamp: new Date().toISOString() };
    case 'getStatus':        return getStatus();
    case 'getResumenDiario': return getResumenDiario();
    case 'getSATCFDIs':      return getSATCFDIs(params);
    case 'getBancarios':     return getBancarios(params);
    case 'getConciliacion':  return getConciliacion(params);
    case 'getPendingReview': return getPendingReview(params);
    case 'saveDecision':     return saveDecision(params);
    case 'logSesionCharly':  return logSesionCharly(params);
    default:
      return { success: false, error: `Accion desconocida: ${action}` };
  }
}

// =============================================================================
// ENDPOINTS DE CONSULTA (usados por Charly / agente Python)
// =============================================================================

/** Estado general del DataLake: filas por hoja y pendientes de revisión. */
function getStatus() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const resultado = { success: true, hojas: {}, timestamp: new Date().toISOString() };

  for (const [key, nombre] of Object.entries(cfg.HOJAS)) {
    const sheet = ss.getSheetByName(nombre);
    resultado.hojas[key] = sheet
      ? { nombre, filas: Math.max(0, sheet.getLastRow() - 1), existe: true }
      : { nombre, filas: 0, existe: false };
  }

  // Contar pendientes
  const sheetRev = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (sheetRev && sheetRev.getLastRow() > 1) {
    const headers = sheetRev.getRange(1, 1, 1, sheetRev.getLastColumn()).getValues()[0];
    const datos = sheetRev.getRange(2, 1, sheetRev.getLastRow() - 1, sheetRev.getLastColumn()).getValues();
    const idxEstado = headers.findIndex(h => h.toString().toLowerCase().includes('estado'));
    resultado.revisionPendiente = datos.filter(r => {
      const e = idxEstado >= 0 ? r[idxEstado].toString().toLowerCase() : '';
      return e === 'pendiente' || e === '';
    }).length;
  }

  return resultado;
}

/** CFDIs SAT filtrados por fecha. */
function getSATCFDIs(params) {
  const cfg = getConfig();
  const desde = params.desde || getHaceNDias_(90);
  const hasta = params.hasta || hoy_();
  const limite = parseInt(params.limite || 100);
  const soloSinMatch = params.soloSinMatch === 'true' || params.soloSinMatch === true;

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheet) return { success: false, error: 'Hoja CFDI_SAT no encontrada' };

  let datos = leerHoja_(sheet).filter(r => {
    const f = (r.fecha || r.Fecha || '').toString().substring(0, 10);
    const total = parseFloat(r.total || r.Total || 0);
    return f >= desde && f <= hasta && total !== 0;
  });

  if (soloSinMatch) datos = datos.filter(r => !r.board_match_id && !r.conciliado);

  return {
    success: true,
    periodo: { desde, hasta },
    cfdis: datos.slice(0, limite),
    total: datos.length,
    importe_total: datos.reduce((s, r) => s + parseFloat(r.total || r.Total || 0), 0),
  };
}

/**
 * Movimientos bancarios con filtros.
 * Prioriza MOVIMIENTOS_BANCARIOS (normalizado); si está vacío usa MOVIMIENTOS_BANCARIOS_RAW.
 */
function getBancarios(params) {
  const cfg = getConfig();
  const desde = params.desde || getHaceNDias_(30);
  const hasta = params.hasta || hoy_();
  const banco = params.banco || null;
  const tipo = params.tipo || null;
  const limite = parseInt(params.limite || 50);

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);

  // Intentar normalizado primero, si está vacío usar RAW
  let sheet = ss.getSheetByName(cfg.HOJAS.BANCARIOS);
  let fuenteUsada = cfg.HOJAS.BANCARIOS;
  if (!sheet || sheet.getLastRow() <= 1) {
    sheet = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
    fuenteUsada = cfg.HOJAS.BANCARIOS_RAW;
  }
  if (!sheet || sheet.getLastRow() <= 1) {
    return { success: false, error: 'No hay movimientos bancarios en ninguna hoja (MOVIMIENTOS_BANCARIOS ni MOVIMIENTOS_BANCARIOS_RAW)' };
  }

  let datos = leerHoja_(sheet).filter(r => {
    const f = (r.fecha || r.fecha_movimiento || r.Fecha || '').toString().substring(0, 10);
    if (f < desde || f > hasta) return false;
    // Compatibilidad con nombre de columna variable entre RAW y normalizado
    const bancoVal = r.banco || r.Banco || '';
    const tipoVal  = r.tipo  || r.tipo_movimiento || (parseFloat(r.monto || 0) < 0 ? 'EGRESO' : 'INGRESO');
    if (banco && bancoVal.toString().toUpperCase() !== banco.toUpperCase()) return false;
    if (tipo  && tipoVal.toString().toUpperCase()  !== tipo.toUpperCase())  return false;
    return true;
  });

  datos.sort((a, b) => {
    const fa = (a.fecha || a.fecha_movimiento || '').toString();
    const fb = (b.fecha || b.fecha_movimiento || '').toString();
    return fb.localeCompare(fa);
  });

  const montoVal = r => parseFloat(r.monto || r.Monto || 0);
  const tipoVal  = r => (r.tipo || r.tipo_movimiento || (montoVal(r) < 0 ? 'EGRESO' : 'INGRESO')).toString().toUpperCase();

  const egresos  = datos.filter(r => tipoVal(r) === 'EGRESO');
  const ingresos = datos.filter(r => tipoVal(r) === 'INGRESO');

  return {
    success: true,
    fuente: fuenteUsada,
    periodo: { desde, hasta },
    movimientos: datos.slice(0, limite),
    total_registros: datos.length,
    resumen: {
      egresos:  { count: egresos.length,  importe: egresos.reduce((s, r)  => s + Math.abs(montoVal(r)), 0) },
      ingresos: { count: ingresos.length, importe: ingresos.reduce((s, r) => s + Math.abs(montoVal(r)), 0) },
    },
  };
}

/** Reporte de conciliación SAT vs Board vs Bancarios para un período. */
function getConciliacion(params) {
  const cfg = getConfig();
  const desde = params.desde || getHaceNDias_(90);
  const hasta = params.hasta || hoy_();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);

  const satData = leerHoja_(ss.getSheetByName(cfg.HOJAS.CFDI_SAT)).filter(r => {
    const f = (r.fecha || r.Fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta && parseFloat(r.total || r.Total || 0) !== 0;
  });

  const boardData = leerHoja_(ss.getSheetByName(cfg.HOJAS.BOARD_NORMALIZADO)).filter(r => {
    const f = (r.fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta && parseFloat(r.monto || 0) < 0;
  });

  // Bancarios: preferir normalizado, fallback a RAW
  let sheetBanc = ss.getSheetByName(cfg.HOJAS.BANCARIOS);
  if (!sheetBanc || sheetBanc.getLastRow() <= 1) sheetBanc = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
  const bancData = sheetBanc ? leerHoja_(sheetBanc).filter(r => {
    const f = (r.fecha || r.fecha_movimiento || '').toString().substring(0, 10);
    return f >= desde && f <= hasta;
  }) : [];

  const totalSAT   = satData.reduce((s, r)   => s + parseFloat(r.total || r.Total || 0), 0);
  const totalBoard = boardData.reduce((s, r) => s + Math.abs(parseFloat(r.monto || 0)), 0);
  const totalBanc  = bancData
    .filter(r => (r.tipo || r.tipo_movimiento || '').toString().toUpperCase() === 'EGRESO')
    .reduce((s, r) => s + Math.abs(parseFloat(r.monto || 0)), 0);

  return {
    success: true,
    periodo: { desde, hasta },
    sat:      { total: satData.length,   importe: totalSAT },
    board:    { total: boardData.length, importe: totalBoard },
    bancarios:{ total: bancData.length,  egresos: totalBanc },
    cobertura_pct: totalSAT > 0 ? Math.round((Math.min(totalBoard, totalSAT) / totalSAT) * 100) : 0,
    generado: new Date().toISOString(),
  };
}

/** Movimientos pendientes de revisión humana. */
function getPendingReview(params) {
  const cfg = getConfig();
  const limite = parseInt(params.limite || 10);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);

  if (!sheet || sheet.getLastRow() < 2) {
    return { success: true, pendientes: [], total: 0, mensaje: 'Sin movimientos pendientes' };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos   = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  const colIdx = {};
  headers.forEach((h, i) => { if (h) colIdx[h.toString().trim()] = i; });

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
      if (!mov.categoria_board || confianza < 0.5)       problemas.push('sin_categoria');
      if (!mov.centro_costo_id_obra)                     problemas.push('sin_obra');
      if (!mov.uuid_cfdi && Math.abs(monto) > 1000)      problemas.push('sin_cfdi_alto_monto');
      if ((mov.notas_revision || '').toString().includes('ANOMALIA')) problemas.push('anomalia');
      return { ...mov, tipo_problema: problemas, monto_fmt: formatMXN_(monto) };
    });

  return {
    success: true,
    pendientes,
    total: pendientes.length,
    sinCategoria: pendientes.filter(p => p.tipo_problema.includes('sin_categoria')).length,
    sinObra:      pendientes.filter(p => p.tipo_problema.includes('sin_obra')).length,
    anomalias:    pendientes.filter(p => p.tipo_problema.includes('anomalia')).length,
    fecha_consulta: new Date().toISOString(),
  };
}

/** Guarda la decisión de Antonio sobre un movimiento pendiente. */
function saveDecision(params) {
  const cfg = getConfig();
  const { id_interno, categoria, obra, notas, estado } = params;
  if (!id_interno) return { success: false, error: 'Falta id_interno' };

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (!sheet) return { success: false, error: 'Hoja Revision_Humana no encontrada' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx  = {};
  headers.forEach((h, i) => { if (h) colIdx[h.toString().trim()] = i; });

  const datos  = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const idxId  = colIdx['id_interno'] ?? 0;

  for (let i = 0; i < datos.length; i++) {
    if (datos[i][idxId] && datos[i][idxId].toString() === id_interno.toString()) {
      const fila = i + 2;
      if (categoria && colIdx['categoria_board'] !== undefined) sheet.getRange(fila, colIdx['categoria_board'] + 1).setValue(categoria);
      if (obra      && colIdx['centro_costo_id_obra'] !== undefined) sheet.getRange(fila, colIdx['centro_costo_id_obra'] + 1).setValue(obra);
      if (notas     && colIdx['notas_revision'] !== undefined) sheet.getRange(fila, colIdx['notas_revision'] + 1).setValue(notas);
      const idxEstado = colIdx['estado_revision'] ?? colIdx['estado'];
      if (idxEstado !== undefined) sheet.getRange(fila, idxEstado + 1).setValue(estado || 'revisado');
      const idxFechaRev = colIdx['fecha_revision'];
      if (idxFechaRev !== undefined) sheet.getRange(fila, idxFechaRev + 1).setValue(new Date().toISOString());
      return { success: true, mensaje: `Movimiento ${id_interno} actualizado`, fila };
    }
  }
  return { success: false, error: `No se encontro id_interno: ${id_interno}` };
}

/** Registra una sesión de Charly en el historial. */
function logSesionCharly(params) {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(cfg.HOJAS.SESIONES_CHARLY);

  if (!sheet) {
    sheet = ss.insertSheet(cfg.HOJAS.SESIONES_CHARLY);
    sheet.getRange(1, 1, 1, 5).setValues([['fecha', 'tipo', 'resumen', 'sesion_json', 'estado']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date().toISOString(),
    params.tipo || 'sesion',
    params.resumen || '',
    JSON.stringify(params.datos || {}),
    params.estado || 'ok',
  ]);

  return { success: true, mensaje: 'Sesion registrada' };
}

/** Resumen diario para el briefing matutino de Charly. */
function getResumenDiario() {
  const hoyStr  = hoy_();
  const hace7   = getHaceNDias_(7);
  const hace30  = getHaceNDias_(30);

  const concil30   = getConciliacion({ desde: hace30, hasta: hoyStr });
  const bancarios7 = getBancarios({ desde: hace7, hasta: hoyStr, limite: 20 });
  const pendientes = getPendingReview({ limite: 5 });
  const estado     = getStatus();

  return {
    success: true,
    fecha: hoyStr,
    estado_datalake: estado.hojas || {},
    conciliacion_30d: concil30,
    bancarios_7d: bancarios7.resumen || {},
    fuente_bancarios: bancarios7.fuente || 'desconocida',
    pendientes_revision: pendientes.total || 0,
    top_pendientes: (pendientes.pendientes || []).slice(0, 3),
    generado: new Date().toISOString(),
  };
}

// =============================================================================
// PROCESAMIENTO — Normalización, Categorización, Exportación
// =============================================================================

/**
 * Normaliza movimientos desde MOVIMIENTOS_BANCARIOS_RAW → MOVIMIENTOS_BANCARIOS.
 * Deduplica por id_interno. Llamar desde menú antes de consultar bancarios.
 */
function normalizarMovimientosBancarios() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw      = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
  const sheetNorm     = ss.getSheetByName(cfg.HOJAS.BANCARIOS);

  if (!sheetRaw || sheetRaw.getLastRow() <= 1) {
    return { procesados: 0, insertados: 0, duplicados: 0, error: 'MOVIMIENTOS_BANCARIOS_RAW vacia o no existe' };
  }
  if (!sheetNorm) {
    return { procesados: 0, insertados: 0, duplicados: 0, error: 'Hoja MOVIMIENTOS_BANCARIOS no existe' };
  }

  const datosRaw = leerHoja_(sheetRaw);

  // IDs ya existentes en normalizado
  const existentes = new Set(
    sheetNorm.getLastRow() > 1
      ? sheetNorm.getRange(2, 1, sheetNorm.getLastRow() - 1, 1).getValues().map(r => r[0])
      : []
  );

  let procesados = 0, insertados = 0, duplicados = 0;
  const newRows = [];

  datosRaw.forEach(row => {
    const banco    = row.banco || row.Banco || '';
    const cuenta   = row.cuenta_bancaria || row.cuenta || row.Cuenta || '';
    const fecha    = row.fecha || row.fecha_movimiento || row.Fecha || '';
    const monto    = parseFloat(row.monto || row.Monto || 0);
    const moneda   = row.moneda || row.Moneda || 'MXN';
    const desc     = row.descripcion || row.descripcion_original || row.Descripcion || '';
    const folio    = row.folio_banco || row.folio || row.Folio || '';
    const ref      = row.referencia || row.Referencia || '';
    const tipo     = row.tipo || row.tipo_movimiento || (monto < 0 ? 'EGRESO' : 'INGRESO');

    if (!banco && !cuenta) return;
    procesados++;

    const idInterno = generarIdInterno_(banco, cuenta, fecha, monto, folio);
    if (existentes.has(idInterno)) { duplicados++; return; }

    newRows.push([
      idInterno, banco, cuenta, fecha, monto, moneda, tipo.toString().toUpperCase(),
      desc, limpiarDescripcion_(desc), ref, folio, '', '', '', '', '', '',
      'Pendiente', '', '', '', '', '', '',
    ]);
    insertados++;
  });

  if (newRows.length > 0) {
    const targetRow = sheetNorm.getLastRow() + 1;
    sheetNorm.getRange(targetRow, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  const msg = `Normalizacion completada: ${insertados} insertados, ${duplicados} duplicados de ${procesados} procesados`;
  Logger.log(msg);
  sendDiscordNotification_('Bancarios normalizados', msg, 0x2ECC71);
  return { procesados, insertados, duplicados };
}

/** Auto-categoriza movimientos en Movimientos_Maestros usando keywords + ML. */
function categorizarMovimientos() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros   = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetBoardHist  = ss.getSheetByName(cfg.HOJAS.BOARD_NORMALIZADO);

  if (!sheetMaestros) return { procesados: 0, categorizados: 0, error: 'Movimientos_Maestros no encontrada' };

  const historyKeywords = construirHistorialKeywords_(sheetBoardHist);
  const lastRow = sheetMaestros.getLastRow();
  if (lastRow <= 1) return { procesados: 0, categorizados: 0 };

  const maestrosData = sheetMaestros.getRange(2, 1, lastRow - 1, 24).getValues();
  let procesados = 0, categorizados = 0;
  const updates = [];

  maestrosData.forEach((row, idx) => {
    const descripcionLimpia = row[8];
    const categoriaNivel1   = row[12];
    if (categoriaNivel1 || !descripcionLimpia) return;
    procesados++;

    const resultado = detectarCategoria_(descripcionLimpia, historyKeywords);
    if (resultado) {
      updates.push({ row: idx + 2, values: [resultado.nivel1, resultado.nivel2, resultado.boardId, resultado.boardNombre, resultado.confidence] });
      categorizados++;
    }
  });

  updates.forEach(u => sheetMaestros.getRange(u.row, 13, 1, 5).setValues([u.values]));

  Logger.log(`Categorizacion: ${procesados} procesados, ${categorizados} categorizados`);
  return { procesados, categorizados };
}

/** Exporta movimientos categorizados al formato Board (Estandares_Board). */
function exportarABoard() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros  = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetExport    = ss.getSheetByName(cfg.HOJAS.ESTANDARES_BOARD);

  if (!sheetMaestros || !sheetExport) {
    return { procesados: 0, exportados: 0, error: 'Hoja(s) requeridas no encontradas' };
  }

  const lastRow = sheetMaestros.getLastRow();
  if (lastRow <= 1) return { procesados: 0, exportados: 0 };

  const datos = sheetMaestros.getRange(2, 1, lastRow - 1, 24).getValues();
  let procesados = 0, exportados = 0;
  const exportRows = [];

  datos.forEach(row => {
    const [idInterno, banco, cuenta, fecha, monto, moneda,
           tipo, descOrig, descLimpia, ref, folio, ,
           , , , categoriaBoardNombre, , ,
           , , , transferId] = row;
    if (!categoriaBoardNombre) return;
    procesados++;
    exportRows.push([
      `${banco} - ${cuenta}`,
      categoriaBoardNombre,
      moneda || 'MXN',
      Math.abs(monto),
      Math.abs(monto),
      monto < 0 ? 'Expense' : 'Income',
      determinarPaymentType_(descLimpia),
      descLimpia || descOrig,
      fecha,
      transferId ? 'TRUE' : 'FALSE',
      ref || '',
    ]);
    exportados++;
  });

  if (sheetExport.getLastRow() > 1) sheetExport.deleteRows(2, sheetExport.getLastRow() - 1);
  if (exportRows.length > 0) sheetExport.getRange(2, 1, exportRows.length, exportRows[0].length).setValues(exportRows);

  return { procesados, exportados };
}

/** Detecta y marca transferencias entre cuentas propias en Movimientos_Maestros. */
function detectarTransferenciasInternas() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheet || sheet.getLastRow() <= 1) return { detectadas: 0, pareadas: 0 };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 24).getValues();
  const porFechaMonto = new Map();

  data.forEach((row, idx) => {
    const [idInterno, banco, cuenta, fecha, monto, moneda] = row;
    if (!fecha || !monto) return;
    const key = `${Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), 'yyyy-MM-dd')}_${Math.abs(monto)}_${moneda}`;
    if (!porFechaMonto.has(key)) porFechaMonto.set(key, []);
    porFechaMonto.get(key).push({ rowNum: idx + 2, idInterno, banco, cuenta, monto, esCargo: monto < 0, esAbono: monto > 0 });
  });

  let detectadas = 0, pareadas = 0;
  porFechaMonto.forEach(movs => {
    if (movs.length < 2) return;
    movs.filter(m => m.esCargo).forEach(cargo => {
      movs.filter(m => m.esAbono && m.cuenta !== cargo.cuenta).forEach(abono => {
        const tId = `TRF_${cargo.idInterno.substring(4, 16)}`;
        sheet.getRange(cargo.rowNum, 22).setValue(tId);
        sheet.getRange(abono.rowNum,  22).setValue(tId);
        detectadas++;
        pareadas += 2;
      });
    });
  });

  return { detectadas, pareadas };
}

/** Detecta gastos inusuales (>2 desviaciones estándar por categoría) y los envía a Revision_Humana. */
function detectarAnomalias() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet  = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetR = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (!sheet || sheet.getLastRow() <= 1) return { anomalias: 0 };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 24).getValues();
  const stats = new Map();

  data.forEach(row => {
    const monto = Math.abs(row[4]);
    const cat   = row[15];
    if (!cat) return;
    if (!stats.has(cat)) stats.set(cat, { montos: [], sum: 0 });
    stats.get(cat).montos.push(monto);
    stats.get(cat).sum += monto;
  });

  stats.forEach((s, cat) => {
    const avg = s.sum / s.montos.length;
    const std = Math.sqrt(s.montos.reduce((a, m) => a + (m - avg) ** 2, 0) / s.montos.length);
    s.avg = avg;
    s.std = std;
  });

  const anomalias = [];
  data.forEach((row, idx) => {
    const monto = Math.abs(row[4]);
    const cat   = row[15];
    const desc  = row[8];
    if (!cat || !stats.has(cat)) return;
    const s = stats.get(cat);
    if (monto > s.avg + 2 * s.std && s.montos.length > 5) {
      anomalias.push([new Date(), 'Monto Inusual', `${cat}: $${monto.toFixed(2)} (avg: $${s.avg.toFixed(2)})`, desc, idx + 2, 'Pendiente']);
    }
  });

  if (anomalias.length > 0 && sheetR) {
    sheetR.getRange(sheetR.getLastRow() + 1, 1, anomalias.length, 6).setValues(anomalias);
  }

  return { anomalias: anomalias.length };
}

/** Entrena el modelo ML guardando keywords → categoría en ML_Training_Data. */
function entrenarModeloCategorizacion() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheetMaestros || sheetMaestros.getLastRow() <= 1) return { patrones: 0, categorias: 0 };

  let sheetML = ss.getSheetByName('ML_Training_Data');
  if (!sheetML) {
    sheetML = ss.insertSheet('ML_Training_Data');
    sheetML.getRange('A1:D1').setValues([['keyword', 'categoria', 'frecuencia', 'confidence']]);
  }

  const kf = new Map();
  sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues().forEach(row => {
    const desc = row[8], cat = row[15];
    if (!desc || !cat) return;
    limpiarDescripcion_(desc).split(' ').filter(t => t.length > 3).forEach(t => {
      const key = `${t}|${cat}`;
      kf.set(key, (kf.get(key) || 0) + 1);
    });
  });

  const catTotals = new Map();
  kf.forEach((freq, key) => {
    const cat = key.split('|')[1];
    catTotals.set(cat, (catTotals.get(cat) || 0) + freq);
  });

  const mlData = [];
  kf.forEach((freq, key) => {
    const [kw, cat] = key.split('|');
    mlData.push([kw, cat, freq, Math.min((freq / catTotals.get(cat)) * 100, 100)]);
  });
  mlData.sort((a, b) => b[2] - a[2]);

  if (sheetML.getLastRow() > 1) sheetML.deleteRows(2, sheetML.getLastRow() - 1);
  if (mlData.length > 0) sheetML.getRange(2, 1, mlData.length, 4).setValues(mlData);

  return { patrones: mlData.length, categorias: catTotals.size };
}

/** Predicción de flujo de caja a 30 días basada en promedio de los últimos 90. */
function predecirFlujoCaja() {
  const cfg = getConfig();
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheet || sheet.getLastRow() <= 1) return { ingresos: 0, egresos: 0, neto: 0 };

  const hace90 = new Date();
  hace90.setDate(hace90.getDate() - 90);
  let totalI = 0, totalE = 0;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 24).getValues().forEach(row => {
    if (new Date(row[3]) >= hace90) {
      const m = row[4];
      if (m > 0) totalI += m;
      else       totalE += Math.abs(m);
    }
  });

  return {
    ingresos: (totalI / 90) * 30,
    egresos:  (totalE / 90) * 30,
    neto:     ((totalI - totalE) / 90) * 30,
  };
}

/** Importa CFDIs SAT desde la carpeta Drive configurada en SAT_FOLDER_ID. */
function importSATFromFolder() {
  const cfg = getConfig();
  if (!cfg.SAT_FOLDER_ID) {
    Logger.log('ERROR: SAT_FOLDER_ID no configurado en Script Properties');
    return { success: false, error: 'SAT_FOLDER_ID no configurado' };
  }

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw   = ss.getSheetByName(cfg.HOJAS.CFDI_SAT_RAW);
  const sheetClean = ss.getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheetRaw || !sheetClean) return { success: false, error: 'Hojas CFDI_SAT_RAW o CFDI_SAT no encontradas' };

  if (sheetRaw.getLastRow()   > 1) sheetRaw.deleteRows(2,   sheetRaw.getLastRow() - 1);
  if (sheetClean.getLastRow() > 1) sheetClean.deleteRows(2, sheetClean.getLastRow() - 1);

  const folder = DriveApp.getFolderById(cfg.SAT_FOLDER_ID);
  const files  = folder.getFiles();
  let totalRecords = 0, filesProcessed = 0;

  while (files.hasNext()) {
    const file    = files.next();
    const content = file.getBlob().getDataAsString();
    const lines   = content.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line   = lines[i].trim();
      if (!line) continue;
      const fields = line.split('~');
      if (fields.length < 11) continue;

      const monto    = parseFloat((fields[8] || '').replace(/,/g, ''));
      const subtotal = monto / 1.16;
      sheetRaw.appendRow([
        fields[0], fields[1], fields[2],
        normalizeDate_(fields[6]),
        subtotal.toFixed(2), (monto - subtotal).toFixed(2), monto.toFixed(2),
        'MXN', '', fields[9] || 'I', fields[10],
      ]);
      totalRecords++;
    }
    filesProcessed++;
  }

  if (totalRecords > 0) {
    const data = sheetRaw.getRange(2, 1, totalRecords, 11).getValues();
    data.forEach(row => sheetClean.appendRow([...row, '']));
  }

  const dupResult = detectAndRemoveDuplicates();
  const msg = `SAT importado: ${totalRecords} registros de ${filesProcessed} archivos. Duplicados eliminados: ${dupResult.duplicatesRemoved}`;
  Logger.log(msg);
  sendDiscordNotification_('Importacion SAT completada', msg, 0x2ECC71);
  return { success: true, totalRecords, filesProcessed, duplicatesRemoved: dupResult.duplicatesRemoved };
}

/** Elimina filas duplicadas en CFDI_SAT por UUID. */
function detectAndRemoveDuplicates() {
  const cfg   = getConfig();
  const ss    = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheet || sheet.getLastRow() <= 1) return { duplicatesRemoved: 0 };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const seen = {}, toDelete = [];

  data.forEach((row, i) => {
    const uuid = row[0];
    if (seen[uuid]) toDelete.push(i + 2);
    else seen[uuid] = true;
  });

  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  return { duplicatesRemoved: toDelete.length };
}

// =============================================================================
// MENÚ INTERACTIVO
// =============================================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Robot Finanzas AVECO')
    .addSubMenu(ui.createMenu('Bancarios')
      .addItem('1. Normalizar RAW a MOVIMIENTOS_BANCARIOS', 'menuNormalizarBancos')
      .addItem('2. Auto-categorizar movimientos', 'menuCategorizarMovimientos')
      .addItem('3. Detectar transferencias internas', 'menuDetectarTransferencias'))
    .addSeparator()
    .addSubMenu(ui.createMenu('SAT / CFDI')
      .addItem('Importar CFDI desde Drive', 'importSATFromFolder')
      .addItem('Detectar duplicados SAT', 'detectAndRemoveDuplicates'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Board Export')
      .addItem('Exportar a Board (Estandares_Board)', 'menuExportarBoard'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Analisis Avanzado')
      .addItem('Entrenar modelo ML', 'menuEntrenarModelo')
      .addItem('Detectar anomalias', 'menuDetectarAnomalias')
      .addItem('Predecir flujo de caja 30d', 'menuPredecirFlujoCaja'))
    .addSeparator()
    .addItem('EJECUTAR FLUJO COMPLETO', 'menuFlujoCompleto')
    .addItem('Estado del sistema', 'menuEstado')
    .addToUi();
}

function menuFlujoCompleto() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Ejecutar flujo completo?', '1. Normalizar bancarios RAW\n2. Auto-categorizar\n3. Exportar a Board', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const r1 = normalizarMovimientosBancarios();
    const r2 = categorizarMovimientos();
    const r3 = exportarABoard();
    ui.alert('Proceso completado',
      `Normalizacion: ${r1.insertados} insertados\nCategorizacion: ${r2.categorizados} categorizados\nBoard Export: ${r3.exportados} exportados`,
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Error', err.message, ui.ButtonSet.OK);
  }
}

function menuNormalizarBancos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = normalizarMovimientosBancarios();
    if (r.error) { ui.alert('Error', r.error, ui.ButtonSet.OK); return; }
    ui.alert('Normalizacion completada', `Procesados: ${r.procesados}\nInsertados: ${r.insertados}\nDuplicados: ${r.duplicados}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuCategorizarMovimientos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = categorizarMovimientos();
    ui.alert('Categorizacion completada', `Procesados: ${r.procesados}\nCategorizados: ${r.categorizados}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuExportarBoard() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = exportarABoard();
    ui.alert('Exportacion completada', `Procesados: ${r.procesados}\nExportados: ${r.exportados}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuEstado() {
  const ui = SpreadsheetApp.getUi();
  try {
    const s = getStatus();
    const lineas = Object.entries(s.hojas).map(([k, v]) => `${v.nombre}: ${v.filas} filas${v.existe ? '' : ' (NO EXISTE)'}`).join('\n');
    ui.alert('Estado del DataLake', lineas + `\n\nPendientes revision: ${s.revisionPendiente || 0}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuDetectarTransferencias() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = detectarTransferenciasInternas();
    ui.alert('Transferencias detectadas', `Detectadas: ${r.detectadas}\nMovimientos pareados: ${r.pareadas}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuEntrenarModelo() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = entrenarModeloCategorizacion();
    ui.alert('Modelo entrenado', `Patrones: ${r.patrones}\nCategorias: ${r.categorias}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuDetectarAnomalias() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = detectarAnomalias();
    ui.alert('Anomalias detectadas', `Movimientos inusuales: ${r.anomalias}${r.anomalias > 0 ? '\nRevisa Revision_Humana.' : ''}`, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuPredecirFlujoCaja() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = predecirFlujoCaja();
    ui.alert('Prediccion flujo 30 dias',
      `Ingresos estimados: ${formatMXN_(r.ingresos)}\nEgresos estimados: ${formatMXN_(r.egresos)}\nBalance neto: ${formatMXN_(r.neto)}\n\nBasado en promedios 90 dias.`,
      ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

// =============================================================================
// UTILIDADES INTERNAS (trailing underscore = privadas)
// =============================================================================

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function leerHoja_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h.toString().trim()] = row[i]; });
      return obj;
    })
    .filter(r => Object.values(r).some(v => v !== '' && v !== null && v !== undefined));
}

function hoy_() {
  return Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');
}

function getHaceNDias_(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, 'America/Mexico_City', 'yyyy-MM-dd');
}

function formatMXN_(monto) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

function normalizeDate_(dateStr) {
  if (!dateStr) return '';
  return dateStr.toString().split('T')[0];
}

function limpiarDescripcion_(desc) {
  if (!desc) return '';
  return String(desc).toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function generarIdInterno_(banco, cuenta, fecha, monto, folio) {
  const fechaStr  = Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), 'yyyyMMdd');
  const montoStr  = String(monto).replace('.', '').replace('-', '');
  const raw       = `${banco}_${cuenta}_${fechaStr}_${montoStr}_${folio || ''}`;
  return 'MOV_' + fechaStr + '_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase();
}

function determinarPaymentType_(desc) {
  if (!desc) return 'Other';
  const d = desc.toLowerCase();
  if (d.includes('tarjeta') || d.includes('card') || d.includes('tdc')) return 'Card';
  if (d.includes('transfer') || d.includes('spei') || d.includes('transf')) return 'Transfer';
  if (d.includes('efectivo') || d.includes('cash')) return 'Cash';
  if (d.includes('cheque') || d.includes('check')) return 'Check';
  return 'Other';
}

function construirHistorialKeywords_(sheetHistory) {
  const map = new Map();
  if (!sheetHistory || sheetHistory.getLastRow() <= 1) return map;
  sheetHistory.getRange(2, 1, sheetHistory.getLastRow() - 1, 11).getValues().forEach(row => {
    const cat  = row[1];
    const note = row[7];
    if (!cat || !note) return;
    limpiarDescripcion_(note).split(' ').filter(t => t.length > 3).forEach(t => {
      if (!map.has(t)) map.set(t, new Map());
      map.get(t).set(cat, (map.get(t).get(cat) || 0) + 1);
    });
  });
  return map;
}

function detectarCategoria_(descripcion, historyKeywords) {
  const desc   = limpiarDescripcion_(descripcion);
  const scores = new Map();

  limpiarDescripcion_(desc).split(' ').filter(t => t.length > 3).forEach(token => {
    if (!historyKeywords.has(token)) return;
    historyKeywords.get(token).forEach((count, cat) => {
      const s = scores.get(cat) || { cat, score: 0 };
      s.score += Math.min(count * 5, 30);
      scores.set(cat, s);
    });
  });

  let best = null, bestScore = 0;
  scores.forEach(s => { if (s.score > bestScore) { bestScore = s.score; best = s.cat; } });

  if (best && bestScore >= 30) {
    return { nivel1: '', nivel2: '', boardId: '', boardNombre: best, confidence: Math.min(bestScore, 100) / 100 };
  }
  return null;
}

/**
 * Envía notificación a Discord via webhook configurado en Script Properties.
 * No lanza error si el webhook no está configurado.
 */
function sendDiscordNotification_(title, description, color) {
  const cfg = getConfig();
  if (!cfg.DISCORD_WEBHOOK) return;
  try {
    UrlFetchApp.fetch(cfg.DISCORD_WEBHOOK, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        embeds: [{
          title,
          description,
          color: color || 0x2ECC71,
          timestamp: new Date().toISOString(),
          footer: { text: 'AVECO Robot SAT v2.0.0' },
        }],
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('Discord error: ' + e.toString());
  }
}

// =============================================================================
// FUNCIONES DE TEST (ejecutar manualmente desde el editor, no modifican datos)
// =============================================================================

/** Verifica conectividad con el Sheet y Discord sin modificar nada. */
function testConectividad() {
  const cfg = getConfig();
  Logger.log('=== TEST CONECTIVIDAD ===');
  Logger.log('Spreadsheet ID: ' + cfg.SPREADSHEET_ID);

  try {
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    Logger.log('Sheet accesible: ' + ss.getName());
    Object.entries(cfg.HOJAS).forEach(([key, nombre]) => {
      const s = ss.getSheetByName(nombre);
      Logger.log(`  ${key} (${nombre}): ${s ? s.getLastRow() - 1 + ' filas' : 'NO EXISTE'}`);
    });
  } catch (e) {
    Logger.log('ERROR accediendo al Sheet: ' + e.toString());
  }

  if (cfg.DISCORD_WEBHOOK) {
    sendDiscordNotification_('Test AVECO Robot SAT', 'Conectividad verificada. Todo OK.', 0x2ECC71);
    Logger.log('Discord: notificacion de prueba enviada');
  } else {
    Logger.log('Discord: DISCORD_WEBHOOK_URL no configurado en Script Properties');
  }
}

/** Prueba el endpoint getStatus y getResumenDiario. */
function testScript() {
  Logger.log('=== getStatus ===');
  Logger.log(JSON.stringify(getStatus(), null, 2));

  Logger.log('=== getBancarios (ultimos 30d) ===');
  Logger.log(JSON.stringify(getBancarios({ limite: 5 }), null, 2));

  Logger.log('=== getResumenDiario ===');
  Logger.log(JSON.stringify(getResumenDiario(), null, 2));
}

/** Prueba específica de bancarios para confirmar que lee MOVIMIENTOS_BANCARIOS_RAW. */
function testBancarios() {
  Logger.log('=== TEST BANCARIOS ===');
  const r = getBancarios({ desde: getHaceNDias_(90), hasta: hoy_(), limite: 5 });
  Logger.log('Fuente: ' + r.fuente);
  Logger.log('Total registros: ' + r.total_registros);
  Logger.log('Resumen: ' + JSON.stringify(r.resumen));
  Logger.log('Primeros 5: ' + JSON.stringify(r.movimientos));
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
