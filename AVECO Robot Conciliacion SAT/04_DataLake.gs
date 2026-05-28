/**
 * ============================================================
 * AVECO Robot Financiero — DataLake & Conciliación SAT
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.0.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-04-10
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Núcleo del DataLake financiero AVECO. Expone una Web App (GET/POST)
 *   y las funciones de negocio que consume Charly (05_Charly.gs) por
 *   llamada directa, sin HTTP. Cubre el ciclo:
 *     1. Importar CFDIs SAT desde Drive (DRIVE_SAT_FOLDER_ID)
 *     2. Normalizar bancarios (RAW → MOVIMIENTOS_BANCARIOS)
 *     3. Auto-categorizar (keywords + historial Board)
 *     4. Exportar a formato Board (BudgetBakers)
 *     5. Detectar transferencias internas y anomalías
 *     6. Endpoints de consulta para el agente IA
 *
 * CONFIGURACIÓN (Script Properties — ver 00_Config.gs):
 *   SPREADSHEET_ID       → Google Sheet DataLake
 *   DRIVE_SAT_FOLDER_ID  → Carpeta Drive con archivos SAT (CFDI)
 *   DISCORD_WEBHOOK_URL  → Webhook de notificaciones
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig() / requireConfig_()        → 00_Config.gs
 *   sendDiscordNotification_ / notify*_   → 01_Notificaciones.gs
 *
 * DESPLIEGUE (Web App):
 *   Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo | Acceso: Cualquier usuario
 *
 * NOTA OPERATIVA:
 *   Con Charly corriendo nativo en Apps Script (05_Charly.gs), la Web App
 *   (doGet/doPost) ya NO es indispensable para el agente. Se mantiene por
 *   compatibilidad y para consultas externas; puede retirarse si ya no la
 *   consume ningún cliente Python/n8n.
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — ROUTER WEB APP
// ============================================================

/**
 * doGet — maneja todas las acciones vía GET (cuentas Gmail bloquean POST externo).
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'ping';
  try {
    return jsonResponse_(routeAction_(action, p));
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString(), action });
  }
}

/**
 * doPost — uso interno y compatibilidad.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    return jsonResponse_(routeAction_(body.action || '', body));
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
    default:                 return { success: false, error: 'Accion desconocida: ' + action };
  }
}


// ============================================================
// SECCIÓN 2 — ENDPOINTS DE CONSULTA (usados por Charly)
// ============================================================

/** Estado general del DataLake: filas por hoja y pendientes de revisión. */
function getStatus() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const resultado = { success: true, hojas: {}, timestamp: new Date().toISOString() };

  for (const [key, nombre] of Object.entries(cfg.HOJAS)) {
    const sheet = ss.getSheetByName(nombre);
    resultado.hojas[key] = sheet
      ? { nombre, filas: Math.max(0, sheet.getLastRow() - 1), existe: true }
      : { nombre, filas: 0, existe: false };
  }

  const sheetRev = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (sheetRev && sheetRev.getLastRow() > 1) {
    const headers = sheetRev.getRange(1, 1, 1, sheetRev.getLastColumn()).getValues()[0];
    const datos   = sheetRev.getRange(2, 1, sheetRev.getLastRow() - 1, sheetRev.getLastColumn()).getValues();
    const idxEstado = headers.findIndex(h => h.toString().toLowerCase().includes('estado'));
    resultado.revisionPendiente = datos.filter(r => {
      const est = idxEstado >= 0 ? r[idxEstado].toString().toLowerCase() : '';
      return est === 'pendiente' || est === '';
    }).length;
  }

  return resultado;
}

/** CFDIs SAT filtrados por fecha. */
function getSATCFDIs(params) {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const desde = params.desde || getHaceNDias_(90);
  const hasta = params.hasta || hoy_();
  const limite = parseInt(params.limite || 100);
  const soloSinMatch = params.soloSinMatch === 'true' || params.soloSinMatch === true;

  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.CFDI_SAT);
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
 * Prioriza MOVIMIENTOS_BANCARIOS (normalizado); si está vacío usa RAW.
 */
function getBancarios(params) {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const desde = params.desde || getHaceNDias_(30);
  const hasta = params.hasta || hoy_();
  const banco = params.banco || null;
  const tipo  = params.tipo || null;
  const limite = parseInt(params.limite || 50);

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);

  let sheet = ss.getSheetByName(cfg.HOJAS.BANCARIOS);
  let fuenteUsada = cfg.HOJAS.BANCARIOS;
  if (!sheet || sheet.getLastRow() <= 1) {
    sheet = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
    fuenteUsada = cfg.HOJAS.BANCARIOS_RAW;
  }
  if (!sheet || sheet.getLastRow() <= 1) {
    return { success: false, error: 'No hay movimientos bancarios en ninguna hoja (' + cfg.HOJAS.BANCARIOS + ' ni ' + cfg.HOJAS.BANCARIOS_RAW + ')' };
  }

  let datos = leerHoja_(sheet).filter(r => {
    const f = (r.fecha || r.fecha_movimiento || r.Fecha || '').toString().substring(0, 10);
    if (f < desde || f > hasta) return false;
    const bancoVal = r.banco || r.Banco || '';
    const tipoVal  = r.tipo || r.tipo_movimiento || (parseFloat(r.monto || 0) < 0 ? 'EGRESO' : 'INGRESO');
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
  const cfg = requireConfig_(['SPREADSHEET_ID']);
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
    sat:       { total: satData.length,   importe: totalSAT },
    board:     { total: boardData.length, importe: totalBoard },
    bancarios: { total: bancData.length,  egresos: totalBanc },
    cobertura_pct: totalSAT > 0 ? Math.round((Math.min(totalBoard, totalSAT) / totalSAT) * 100) : 0,
    generado: new Date().toISOString(),
  };
}

/** Movimientos pendientes de revisión humana. */
function getPendingReview(params) {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const limite = parseInt(params.limite || 10);
  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.REVISION_HUMANA);

  if (!sheet || sheet.getLastRow() < 2) {
    return { success: true, pendientes: [], total: 0, mensaje: 'Sin movimientos pendientes' };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos   = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

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
      if (!mov.categoria_board || confianza < 0.5)  problemas.push('sin_categoria');
      if (!mov.centro_costo_id_obra)                problemas.push('sin_obra');
      if (!mov.uuid_cfdi && Math.abs(monto) > 1000) problemas.push('sin_cfdi_alto_monto');
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
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const { id_interno, categoria, obra, notas, estado } = params;
  if (!id_interno) return { success: false, error: 'Falta id_interno' };

  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (!sheet) return { success: false, error: 'Hoja Revision_Humana no encontrada' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx  = {};
  headers.forEach((h, i) => { if (h) colIdx[h.toString().trim()] = i; });

  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const idxId = colIdx['id_interno'] ?? 0;

  for (let i = 0; i < datos.length; i++) {
    if (datos[i][idxId] && datos[i][idxId].toString() === id_interno.toString()) {
      const fila = i + 2;
      if (categoria && colIdx['categoria_board'] !== undefined)      sheet.getRange(fila, colIdx['categoria_board'] + 1).setValue(categoria);
      if (obra      && colIdx['centro_costo_id_obra'] !== undefined) sheet.getRange(fila, colIdx['centro_costo_id_obra'] + 1).setValue(obra);
      if (notas     && colIdx['notas_revision'] !== undefined)       sheet.getRange(fila, colIdx['notas_revision'] + 1).setValue(notas);
      const idxEstado = colIdx['estado_revision'] ?? colIdx['estado'];
      if (idxEstado !== undefined) sheet.getRange(fila, idxEstado + 1).setValue(estado || 'revisado');
      const idxFechaRev = colIdx['fecha_revision'];
      if (idxFechaRev !== undefined) sheet.getRange(fila, idxFechaRev + 1).setValue(new Date().toISOString());
      return { success: true, mensaje: 'Movimiento ' + id_interno + ' actualizado', fila };
    }
  }
  return { success: false, error: 'No se encontro id_interno: ' + id_interno };
}

/** Registra una sesión de Charly en el historial. */
function logSesionCharly(params) {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(cfg.HOJAS.SESIONES_CHARLY);

  if (!sheet) {
    sheet = ss.insertSheet(cfg.HOJAS.SESIONES_CHARLY);
    sheet.getRange(1, 1, 1, 5).setValues([['fecha', 'tipo', 'resumen', 'sesion_json', 'estado']]).setFontWeight('bold');
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
  const hoyStr = hoy_();
  const hace7  = getHaceNDias_(7);
  const hace30 = getHaceNDias_(30);

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


// ============================================================
// SECCIÓN 3 — PROCESAMIENTO (normalización, categorización, export)
// ============================================================

/**
 * Normaliza movimientos desde MOVIMIENTOS_BANCARIOS_RAW → MOVIMIENTOS_BANCARIOS.
 * Deduplica por id_interno.
 */
function normalizarMovimientosBancarios() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw  = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
  const sheetNorm = ss.getSheetByName(cfg.HOJAS.BANCARIOS);

  if (!sheetRaw || sheetRaw.getLastRow() <= 1) return { procesados: 0, insertados: 0, duplicados: 0, error: cfg.HOJAS.BANCARIOS_RAW + ' vacia o no existe' };
  if (!sheetNorm) return { procesados: 0, insertados: 0, duplicados: 0, error: 'Hoja ' + cfg.HOJAS.BANCARIOS + ' no existe' };

  const datosRaw = leerHoja_(sheetRaw);

  const existentes = new Set(
    sheetNorm.getLastRow() > 1
      ? sheetNorm.getRange(2, 1, sheetNorm.getLastRow() - 1, 1).getValues().map(r => r[0])
      : []
  );

  let procesados = 0, insertados = 0, duplicados = 0;
  const newRows = [];

  datosRaw.forEach(row => {
    const banco  = row.banco || row.Banco || '';
    const cuenta = row.cuenta_bancaria || row.cuenta || row.Cuenta || '';
    const fecha  = row.fecha || row.fecha_movimiento || row.Fecha || '';
    const monto  = parseFloat(row.monto || row.Monto || 0);
    const moneda = row.moneda || row.Moneda || 'MXN';
    const desc   = row.descripcion || row.descripcion_original || row.Descripcion || '';
    const folio  = row.folio_banco || row.folio || row.Folio || '';
    const ref    = row.referencia || row.Referencia || '';
    const tipo   = row.tipo || row.tipo_movimiento || (monto < 0 ? 'EGRESO' : 'INGRESO');

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
    sheetNorm.getRange(sheetNorm.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  const msg = 'Normalizacion: ' + insertados + ' insertados, ' + duplicados + ' duplicados de ' + procesados + ' procesados';
  Logger.log(msg);
  notifyDiscordSuccess_('Bancarios normalizados', msg);
  return { procesados, insertados, duplicados };
}

/** Auto-categoriza movimientos en Movimientos_Maestros usando keywords + historial. */
function categorizarMovimientos() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros  = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetBoardHist = ss.getSheetByName(cfg.HOJAS.BOARD_NORMALIZADO);

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

  Logger.log('Categorizacion: ' + procesados + ' procesados, ' + categorizados + ' categorizados');
  return { procesados, categorizados };
}

/** Exporta movimientos categorizados al formato Board (Estandares_Board). */
function exportarABoard() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetExport   = ss.getSheetByName(cfg.HOJAS.ESTANDARES_BOARD);

  if (!sheetMaestros || !sheetExport) return { procesados: 0, exportados: 0, error: 'Hoja(s) requeridas no encontradas' };

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
      banco + ' - ' + cuenta,
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

/** Detecta y marca transferencias entre cuentas propias (escritura en batch). */
function detectarTransferenciasInternas() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheet || sheet.getLastRow() <= 1) return { detectadas: 0, pareadas: 0 };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 24).getValues();
  const porFechaMonto = new Map();

  data.forEach((row, idx) => {
    const [idInterno, banco, cuenta, fecha, monto, moneda] = row;
    if (!fecha || !monto) return;
    const key = Utilities.formatDate(new Date(fecha), cfg.TIMEZONE, 'yyyy-MM-dd') + '_' + Math.abs(monto) + '_' + moneda;
    if (!porFechaMonto.has(key)) porFechaMonto.set(key, []);
    porFechaMonto.get(key).push({ idx, idInterno, cuenta, esCargo: monto < 0, esAbono: monto > 0 });
  });

  // Columna 22 (1-based) = transferId → índice 21 en el array leído.
  const transferCol = data.map(row => [row[21] || '']);
  let detectadas = 0, pareadas = 0;

  porFechaMonto.forEach(movs => {
    if (movs.length < 2) return;
    movs.filter(m => m.esCargo).forEach(cargo => {
      movs.filter(m => m.esAbono && m.cuenta !== cargo.cuenta).forEach(abono => {
        const tId = 'TRF_' + String(cargo.idInterno).substring(4, 16);
        transferCol[cargo.idx][0] = tId;
        transferCol[abono.idx][0] = tId;
        detectadas++;
        pareadas += 2;
      });
    });
  });

  // Escritura única de toda la columna transferId.
  sheet.getRange(2, 22, transferCol.length, 1).setValues(transferCol);

  return { detectadas, pareadas };
}

/** Detecta gastos inusuales (>2σ por categoría) y los envía a Revision_Humana. */
function detectarAnomalias() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
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

  stats.forEach(s => {
    const avg = s.sum / s.montos.length;
    s.avg = avg;
    s.std = Math.sqrt(s.montos.reduce((a, m) => a + (m - avg) ** 2, 0) / s.montos.length);
  });

  const anomalias = [];
  data.forEach((row, idx) => {
    const monto = Math.abs(row[4]);
    const cat   = row[15];
    const desc  = row[8];
    if (!cat || !stats.has(cat)) return;
    const s = stats.get(cat);
    if (monto > s.avg + 2 * s.std && s.montos.length > 5) {
      anomalias.push([new Date(), 'Monto Inusual', cat + ': $' + monto.toFixed(2) + ' (avg: $' + s.avg.toFixed(2) + ')', desc, idx + 2, 'Pendiente']);
    }
  });

  if (anomalias.length > 0 && sheetR) {
    sheetR.getRange(sheetR.getLastRow() + 1, 1, anomalias.length, 6).setValues(anomalias);
  }

  return { anomalias: anomalias.length };
}

/** Entrena el modelo guardando keywords → categoría en ML_Training_Data. */
function entrenarModeloCategorizacion() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetMaestros = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheetMaestros || sheetMaestros.getLastRow() <= 1) return { patrones: 0, categorias: 0 };

  let sheetML = ss.getSheetByName(cfg.HOJAS.ML_TRAINING);
  if (!sheetML) {
    sheetML = ss.insertSheet(cfg.HOJAS.ML_TRAINING);
    sheetML.getRange('A1:D1').setValues([['keyword', 'categoria', 'frecuencia', 'confidence']]);
  }

  const kf = new Map();
  sheetMaestros.getRange(2, 1, sheetMaestros.getLastRow() - 1, 24).getValues().forEach(row => {
    const desc = row[8], cat = row[15];
    if (!desc || !cat) return;
    limpiarDescripcion_(desc).split(' ').filter(t => t.length > 3).forEach(t => {
      const key = t + '|' + cat;
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
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  if (!sheet || sheet.getLastRow() <= 1) return { ingresos: 0, egresos: 0, neto: 0 };

  const hace90 = new Date();
  hace90.setDate(hace90.getDate() - 90);
  let totalI = 0, totalE = 0;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 24).getValues().forEach(row => {
    if (new Date(row[3]) >= hace90) {
      const m = row[4];
      if (m > 0) totalI += m; else totalE += Math.abs(m);
    }
  });

  return {
    ingresos: (totalI / 90) * 30,
    egresos:  (totalE / 90) * 30,
    neto:     ((totalI - totalE) / 90) * 30,
  };
}


// ============================================================
// SECCIÓN 4 — IMPORTACIÓN SAT / CFDI
// ============================================================

/** Importa CFDIs SAT desde DRIVE_SAT_FOLDER_ID (escritura en batch). */
function importSATFromFolder() {
  const cfg = requireConfig_(['SPREADSHEET_ID', 'DRIVE_SAT_FOLDER_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw   = ss.getSheetByName(cfg.HOJAS.CFDI_SAT_RAW);
  const sheetClean = ss.getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheetRaw || !sheetClean) return { success: false, error: 'Hojas CFDI_SAT_RAW o CFDI_SAT no encontradas' };

  if (sheetRaw.getLastRow()   > 1) sheetRaw.deleteRows(2,   sheetRaw.getLastRow()   - 1);
  if (sheetClean.getLastRow() > 1) sheetClean.deleteRows(2, sheetClean.getLastRow() - 1);

  const folder = DriveApp.getFolderById(cfg.DRIVE_SAT_FOLDER_ID);
  const files  = folder.getFiles();
  const rawRows = [];
  let filesProcessed = 0;

  while (files.hasNext()) {
    const file  = files.next();
    const lines = file.getBlob().getDataAsString().split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = line.split('~');
      if (fields.length < 11) continue;

      const monto    = parseFloat((fields[8] || '').replace(/,/g, ''));
      const subtotal = monto / 1.16;
      rawRows.push([
        fields[0], fields[1], fields[2],
        normalizeDate_(fields[6]),
        subtotal.toFixed(2), (monto - subtotal).toFixed(2), monto.toFixed(2),
        'MXN', '', fields[9] || 'I', fields[10],
      ]);
    }
    filesProcessed++;
  }

  // Escritura en batch (en lugar de appendRow por fila).
  if (rawRows.length > 0) {
    sheetRaw.getRange(2, 1, rawRows.length, 11).setValues(rawRows);
    const cleanRows = rawRows.map(r => [...r, '']);
    sheetClean.getRange(2, 1, cleanRows.length, cleanRows[0].length).setValues(cleanRows);
  }

  const dupResult = removeDuplicatesSAT();
  const msg = 'SAT importado: ' + rawRows.length + ' registros de ' + filesProcessed + ' archivos. Duplicados eliminados: ' + dupResult.duplicatesRemoved;
  Logger.log(msg);
  notifyDiscordSuccess_('Importacion SAT completada', msg);
  return { success: true, totalRecords: rawRows.length, filesProcessed, duplicatesRemoved: dupResult.duplicatesRemoved };
}

/** Elimina filas duplicadas en CFDI_SAT por UUID (reescritura en batch). */
function removeDuplicatesSAT() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheet || sheet.getLastRow() <= 1) return { duplicatesRemoved: 0 };

  const lastCol = sheet.getLastColumn();
  const data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const seen    = new Set();
  const unicos  = [];
  let duplicados = 0;

  data.forEach(row => {
    const uuid = row[0];
    if (seen.has(uuid)) { duplicados++; return; }
    seen.add(uuid);
    unicos.push(row);
  });

  if (duplicados > 0) {
    sheet.getRange(2, 1, data.length, lastCol).clearContent();
    if (unicos.length) sheet.getRange(2, 1, unicos.length, lastCol).setValues(unicos);
  }
  return { duplicatesRemoved: duplicados };
}


// ============================================================
// SECCIÓN 5 — MENÚ INTERACTIVO (Sheets)
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Robot Finanzas AVECO')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Bancarios')
      .addItem('1. Normalizar RAW a MOVIMIENTOS_BANCARIOS', 'menuNormalizarBancos')
      .addItem('2. Auto-categorizar movimientos', 'menuCategorizarMovimientos')
      .addItem('3. Detectar transferencias internas', 'menuDetectarTransferencias'))
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('SAT / CFDI')
      .addItem('Importar CFDI desde Drive', 'importSATFromFolder')
      .addItem('Detectar duplicados SAT', 'removeDuplicatesSAT'))
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Board Export')
      .addItem('Exportar a Board (Estandares_Board)', 'menuExportarBoard'))
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Analisis Avanzado')
      .addItem('Entrenar modelo', 'menuEntrenarModelo')
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
      'Normalizacion: ' + r1.insertados + ' insertados\nCategorizacion: ' + r2.categorizados + ' categorizados\nBoard Export: ' + r3.exportados + ' exportados',
      ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuNormalizarBancos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = normalizarMovimientosBancarios();
    if (r.error) { ui.alert('Error', r.error, ui.ButtonSet.OK); return; }
    ui.alert('Normalizacion completada', 'Procesados: ' + r.procesados + '\nInsertados: ' + r.insertados + '\nDuplicados: ' + r.duplicados, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuCategorizarMovimientos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = categorizarMovimientos();
    ui.alert('Categorizacion completada', 'Procesados: ' + r.procesados + '\nCategorizados: ' + r.categorizados, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuExportarBoard() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = exportarABoard();
    ui.alert('Exportacion completada', 'Procesados: ' + r.procesados + '\nExportados: ' + r.exportados, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuEstado() {
  const ui = SpreadsheetApp.getUi();
  try {
    const s = getStatus();
    const lineas = Object.values(s.hojas).map(v => v.nombre + ': ' + v.filas + ' filas' + (v.existe ? '' : ' (NO EXISTE)')).join('\n');
    ui.alert('Estado del DataLake', lineas + '\n\nPendientes revision: ' + (s.revisionPendiente || 0), ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuDetectarTransferencias() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = detectarTransferenciasInternas();
    ui.alert('Transferencias detectadas', 'Detectadas: ' + r.detectadas + '\nMovimientos pareados: ' + r.pareadas, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuEntrenarModelo() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = entrenarModeloCategorizacion();
    ui.alert('Modelo entrenado', 'Patrones: ' + r.patrones + '\nCategorias: ' + r.categorias, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuDetectarAnomalias() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = detectarAnomalias();
    ui.alert('Anomalias detectadas', 'Movimientos inusuales: ' + r.anomalias + (r.anomalias > 0 ? '\nRevisa Revision_Humana.' : ''), ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}

function menuPredecirFlujoCaja() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = predecirFlujoCaja();
    ui.alert('Prediccion flujo 30 dias',
      'Ingresos estimados: ' + formatMXN_(r.ingresos) + '\nEgresos estimados: ' + formatMXN_(r.egresos) + '\nBalance neto: ' + formatMXN_(r.neto) + '\n\nBasado en promedios 90 dias.',
      ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error', err.message, ui.ButtonSet.OK); }
}


// ============================================================
// SECCIÓN 6 — UTILIDADES INTERNAS (sufijo _ = privadas)
// ============================================================

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
  return Utilities.formatDate(new Date(), getConfig().TIMEZONE, 'yyyy-MM-dd');
}

function getHaceNDias_(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, getConfig().TIMEZONE, 'yyyy-MM-dd');
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
  const fechaStr = Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), 'yyyyMMdd');
  const montoStr = String(monto).replace('.', '').replace('-', '');
  const raw      = banco + '_' + cuenta + '_' + fechaStr + '_' + montoStr + '_' + (folio || '');
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
    const cat = row[1], note = row[7];
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

  desc.split(' ').filter(t => t.length > 3).forEach(token => {
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


// ============================================================
// SECCIÓN 7 — FUNCIONES DE PRUEBA MANUAL (no modifican datos)
// ============================================================

/** Verifica conectividad con el Sheet y Discord sin modificar nada. */
function testConectividad() {
  const cfg = getConfig();
  Logger.log('=== TEST CONECTIVIDAD ===');
  Logger.log('Spreadsheet ID: ' + (cfg.SPREADSHEET_ID || '(no configurado)'));

  try {
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    Logger.log('Sheet accesible: ' + ss.getName());
    Object.entries(cfg.HOJAS).forEach(([key, nombre]) => {
      const s = ss.getSheetByName(nombre);
      Logger.log('  ' + key + ' (' + nombre + '): ' + (s ? (s.getLastRow() - 1) + ' filas' : 'NO EXISTE'));
    });
  } catch (e) {
    Logger.log('ERROR accediendo al Sheet: ' + e.toString());
  }

  if (cfg.DISCORD_WEBHOOK_URL) {
    notifyDiscordSuccess_('Test AVECO DataLake', 'Conectividad verificada. Todo OK.');
    Logger.log('Discord: notificacion de prueba enviada');
  } else {
    Logger.log('Discord: DISCORD_WEBHOOK_URL no configurado');
  }
}

/** Prueba los endpoints de consulta principales. */
function testScript() {
  Logger.log('=== getStatus ===\n' + JSON.stringify(getStatus(), null, 2));
  Logger.log('=== getBancarios (30d) ===\n' + JSON.stringify(getBancarios({ limite: 5 }), null, 2));
  Logger.log('=== getResumenDiario ===\n' + JSON.stringify(getResumenDiario(), null, 2));
}

/** Prueba específica de bancarios. */
function testBancarios() {
  const r = getBancarios({ desde: getHaceNDias_(90), hasta: hoy_(), limite: 5 });
  Logger.log('Fuente: ' + r.fuente);
  Logger.log('Total registros: ' + r.total_registros);
  Logger.log('Resumen: ' + JSON.stringify(r.resumen));
}
