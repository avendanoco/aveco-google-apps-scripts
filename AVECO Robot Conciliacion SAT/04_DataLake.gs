/**
 * ============================================================
 * AVECO Robot Financiero — DataLake & Conciliación
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.1.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-04-10
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Núcleo del DataLake financiero AVECO. Funciones de negocio que
 *   consume el menú del Sheet y el agente Charly (por llamada directa,
 *   sin HTTP). Cubre:
 *     1. Normalizar bancarios (RAW → MOVIMIENTOS_BANCARIOS)
 *     2. Normalizar Board desde CSV de Wallet (BOARD_CSV_RAW → BOARD_NORMALIZADO)
 *     3. Importar CFDIs SAT desde Drive
 *     4. Conciliación local (fuzzy) SAT vs Bancarios
 *     5. Detección de anomalías y exportación a formato Board
 *     6. Endpoints de consulta (también vía Web App opcional)
 *
 * CONFIGURACIÓN (Script Properties — ver 00_Config.gs):
 *   SPREADSHEET_ID · DRIVE_SAT_FOLDER_ID · DISCORD_WEBHOOK_URL
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig / getSchema_ / requireConfig_ / colIndex_  → 00_Config.gs
 *   notifyDiscord*_ / sendDiscordNotification_           → 01_Notificaciones.gs
 *   ejecutarFuzzyConciliacion_                           → 05_Charly.gs
 *
 * CAMBIOS v3.1.0:
 *   - Board ya NO usa API: se normaliza desde BOARD_CSV_RAW (export Wallet).
 *   - Normalizador bancario robusto: lee por NOMBRE de columna (colIndex_)
 *     y soporta tanto cargo/abono separados como monto único firmado.
 *   - Menú reorganizado por FLUJO DE TRABAJO (ver 04b… onOpen).
 *   - Conciliación desde menú: corre local + notifica a Discord.
 *
 * NOTA OPERATIVA:
 *   Con Charly nativo, la Web App (doGet/doPost) es opcional; se mantiene
 *   por compatibilidad para clientes externos.
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — ROUTER WEB APP (opcional)
// ============================================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'ping';
  try { return jsonResponse_(routeAction_(action, p)); }
  catch (err) { return jsonResponse_({ success: false, error: err.toString(), action }); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    return jsonResponse_(routeAction_(body.action || '', body));
  } catch (err) { return jsonResponse_({ success: false, error: err.toString() }); }
}

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
    const idx = colIndex_(sheetRev);
    const datos = sheetRev.getRange(2, 1, sheetRev.getLastRow() - 1, sheetRev.getLastColumn()).getValues();
    const c = idx['estado_revision'];
    resultado.revisionPendiente = datos.filter(r => {
      const est = (c !== undefined ? r[c] : '').toString().toLowerCase();
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
    const f = (r.fecha_emision || r.fecha || '').toString().substring(0, 10);
    const total = parseFloat(r.total || 0);
    return f >= desde && f <= hasta && total !== 0;
  });
  if (soloSinMatch) datos = datos.filter(r => !r.board_match_id && !r.conciliado);

  return {
    success: true,
    periodo: { desde, hasta },
    cfdis: datos.slice(0, limite),
    total: datos.length,
    importe_total: datos.reduce((s, r) => s + parseFloat(r.total || 0), 0),
  };
}

/** Movimientos bancarios con filtros. Prioriza normalizado; si vacío usa RAW. */
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
    return { success: false, error: 'No hay movimientos bancarios en ninguna hoja' };
  }

  let datos = leerHoja_(sheet).filter(r => {
    const f = (r.fecha_movimiento || r.fecha || '').toString().substring(0, 10);
    if (f < desde || f > hasta) return false;
    const bancoVal = r.banco || '';
    const tipoVal  = r.tipo_movimiento || (parseFloat(r.monto || 0) < 0 ? 'EGRESO' : 'INGRESO');
    if (banco && bancoVal.toString().toUpperCase() !== banco.toUpperCase()) return false;
    if (tipo  && tipoVal.toString().toUpperCase()  !== tipo.toUpperCase())  return false;
    return true;
  });

  datos.sort((a, b) => (b.fecha_movimiento || b.fecha || '').toString().localeCompare((a.fecha_movimiento || a.fecha || '').toString()));

  const montoVal = r => parseFloat(r.monto || 0);
  const tipoVal  = r => (r.tipo_movimiento || (montoVal(r) < 0 ? 'EGRESO' : 'INGRESO')).toString().toUpperCase();
  const egresos  = datos.filter(r => tipoVal(r) === 'EGRESO' || tipoVal(r) === 'CARGO');
  const ingresos = datos.filter(r => tipoVal(r) === 'INGRESO' || tipoVal(r) === 'ABONO');

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
    const f = (r.fecha_emision || r.fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta && parseFloat(r.total || 0) !== 0;
  });
  const boardData = leerHoja_(ss.getSheetByName(cfg.HOJAS.BOARD_NORMALIZADO)).filter(r => {
    const f = (r.fecha_movimiento || '').toString().substring(0, 10);
    return f >= desde && f <= hasta && parseFloat(r.monto || 0) < 0;
  });
  let sheetBanc = ss.getSheetByName(cfg.HOJAS.BANCARIOS);
  if (!sheetBanc || sheetBanc.getLastRow() <= 1) sheetBanc = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
  const bancData = sheetBanc ? leerHoja_(sheetBanc).filter(r => {
    const f = (r.fecha_movimiento || r.fecha || '').toString().substring(0, 10);
    return f >= desde && f <= hasta;
  }) : [];

  const totalSAT   = satData.reduce((s, r)   => s + parseFloat(r.total || 0), 0);
  const totalBoard = boardData.reduce((s, r) => s + Math.abs(parseFloat(r.monto || 0)), 0);
  const totalBanc  = bancData
    .filter(r => (r.tipo_movimiento || '').toString().toUpperCase().match(/EGRESO|CARGO/))
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
  if (!sheet || sheet.getLastRow() < 2) return { success: true, pendientes: [], total: 0, mensaje: 'Sin movimientos pendientes' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos   = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  const pendientes = datos
    .map((row, i) => {
      const obj = { _fila: i + 2 };
      headers.forEach((h, j) => { if (h) obj[h.toString().trim()] = row[j]; });
      return obj;
    })
    .filter(row => {
      const estado = (row['estado_revision'] || '').toString().toLowerCase();
      return (estado === 'pendiente' || estado === '') && row['id_interno'];
    })
    .slice(0, limite)
    .map(mov => {
      const monto = parseFloat(mov.monto || 0);
      const confianza = parseFloat(mov.confianza || 0);
      const problemas = [];
      if (!mov.categoria_sugerida || confianza < 0.5)  problemas.push('sin_categoria');
      if (!mov.obra_sugerida)                          problemas.push('sin_obra');
      if (!mov.uuid_cfdi && Math.abs(monto) > 1000)    problemas.push('sin_cfdi_alto_monto');
      return { ...mov, tipo_problema: problemas, monto_fmt: formatMXN_(monto) };
    });

  return {
    success: true, pendientes, total: pendientes.length,
    sinCategoria: pendientes.filter(p => p.tipo_problema.includes('sin_categoria')).length,
    sinObra:      pendientes.filter(p => p.tipo_problema.includes('sin_obra')).length,
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

  const idx = colIndex_(sheet);
  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const idxId = idx['id_interno'] ?? 0;

  for (let i = 0; i < datos.length; i++) {
    if (datos[i][idxId] && datos[i][idxId].toString() === id_interno.toString()) {
      const fila = i + 2;
      if (categoria && idx['categoria_final'] !== undefined) sheet.getRange(fila, idx['categoria_final'] + 1).setValue(categoria);
      if (obra      && idx['obra_final'] !== undefined)      sheet.getRange(fila, idx['obra_final'] + 1).setValue(obra);
      if (idx['estado_revision'] !== undefined)              sheet.getRange(fila, idx['estado_revision'] + 1).setValue(estado || 'revisado');
      if (notas     && idx['revisor'] !== undefined)         sheet.getRange(fila, idx['revisor'] + 1).setValue(notas);
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
    sheet.getRange(1, 1, 1, 5).setValues([getSchema_().Sesiones_Charly]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date().toISOString(), JSON.stringify(params.datos || {}), params.estado || 'ok', params.resumen || '', new Date().toISOString()]);
  return { success: true, mensaje: 'Sesion registrada' };
}

/** Resumen diario para el briefing matutino de Charly. */
function getResumenDiario() {
  const hoyStr = hoy_();
  const concil30   = getConciliacion({ desde: getHaceNDias_(30), hasta: hoyStr });
  const bancarios7 = getBancarios({ desde: getHaceNDias_(7), hasta: hoyStr, limite: 20 });
  const pendientes = getPendingReview({ limite: 5 });
  const estado     = getStatus();
  return {
    success: true, fecha: hoyStr,
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
// SECCIÓN 3 — NORMALIZACIÓN BANCARIA (RAW → MOVIMIENTOS_BANCARIOS)
// ============================================================

/**
 * Normaliza MOVIMIENTOS_BANCARIOS_RAW → MOVIMIENTOS_BANCARIOS.
 * Lee por NOMBRE de columna (no por posición). El RAW ya viene limpio:
 * cada banco lo escribe su propio parser (BANK_PARSERS en 02_Importador.gs)
 * con 'monto' firmado en MXN, más 'monto_usd'/'tipo_cambio' cuando aplica.
 * Deduplica por id_interno y escribe el esquema de 18 columnas canónico
 * (incluye columnas USD para la cuenta en dólares).
 */
function normalizarMovimientosBancarios() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw  = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
  const sheetNorm = ss.getSheetByName(cfg.HOJAS.BANCARIOS);

  if (!sheetRaw || sheetRaw.getLastRow() <= 1) return { procesados: 0, insertados: 0, duplicados: 0, error: cfg.HOJAS.BANCARIOS_RAW + ' vacía o no existe' };
  if (!sheetNorm) return { procesados: 0, insertados: 0, duplicados: 0, error: 'Hoja ' + cfg.HOJAS.BANCARIOS + ' no existe (ejecuta Configuración)' };

  const datosRaw = leerHoja_(sheetRaw);
  const idxNorm = colIndex_(sheetNorm);
  const colId = idxNorm['id_interno'] ?? 0;

  const existentes = new Set(
    sheetNorm.getLastRow() > 1
      ? sheetNorm.getRange(2, colId + 1, sheetNorm.getLastRow() - 1, 1).getValues().map(r => r[0])
      : []
  );

  let procesados = 0, insertados = 0, duplicados = 0;
  const newRows = [];

  datosRaw.forEach(row => {
    const banco  = row.banco || '';
    const cuenta = row.cuenta_bancaria || row.cuenta || banco; // sin alias, usa banco
    const fecha  = row.fecha || row.fecha_movimiento || '';
    const moneda = row.moneda || 'MXN';
    const desc   = row.descripcion || '';
    const ref    = row.referencia || '';
    const monto  = derivarMonto_(row);               // 'monto' ya viene firmado del parser
    const montoUsd = numOrBlank_(row.monto_usd);
    const tipoCambio = numOrBlank_(row.tipo_cambio);
    const contraparte = row.contraparte || '';

    if (!banco) return;
    procesados++;

    const idInterno = generarIdInterno_(banco, cuenta, fecha, monto, ref);
    if (existentes.has(idInterno)) { duplicados++; return; }
    existentes.add(idInterno);

    const tipo = monto < 0 ? 'EGRESO' : 'INGRESO';
    // Esquema MOVIMIENTOS_BANCARIOS (18 col): id_interno, banco, cuenta_bancaria,
    // fecha_movimiento, monto, moneda, monto_usd, tipo_cambio, tipo_movimiento,
    // descripcion_original, descripcion_limpia, contraparte, referencia,
    // folio_banco, categoria, obra, link_cfdi, estado_revision
    newRows.push([
      idInterno, banco, cuenta, fecha, monto, moneda, montoUsd, tipoCambio, tipo,
      desc, limpiarDescripcion_(desc), contraparte, ref, '',
      row.categoria || '', row.obra || '', row.link_cfdi || '', 'Pendiente',
    ]);
    insertados++;
  });

  if (newRows.length > 0) {
    sheetNorm.getRange(sheetNorm.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  const msg = 'Bancarios: ' + insertados + ' insertados, ' + duplicados + ' duplicados de ' + procesados + ' procesados';
  Logger.log(msg);
  notifyDiscordSuccess_('Normalización bancaria', msg);
  return { procesados, insertados, duplicados };
}

/**
 * Lee el monto firmado de una fila RAW. Los parsers por banco ya entregan
 * 'monto' firmado y en MXN; este helper solo lo convierte a número de forma
 * segura, con respaldo a cargo/abono por si llega un RAW de formato viejo.
 * @param {Object} row
 * @returns {number}
 */
function derivarMonto_(row) {
  const directo = numOrBlank_(row.monto);
  if (directo !== '') return directo;
  // Respaldo: formato antiguo con cargo/abono separados.
  const cargo = numOrBlank_(row.cargo);
  const abono = numOrBlank_(row.abono);
  if (cargo !== '' || abono !== '') return (abono || 0) - Math.abs(cargo || 0);
  return 0;
}

/**
 * Convierte a número o devuelve '' si está vacío/no numérico (para celdas
 * que deben quedar en blanco, como monto_usd en cuentas MXN).
 * @param {*} v
 * @returns {number|string}
 */
function numOrBlank_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? '' : n;
}


// ============================================================
// SECCIÓN 4 — NORMALIZACIÓN BOARD (BOARD_CSV_RAW → BOARD_NORMALIZADO)
// ============================================================

/**
 * Normaliza el export de Wallet/BudgetBakers (BOARD_CSV_RAW) a
 * BOARD_NORMALIZADO. Reemplaza al viejo flujo de API (BOARD_RAW).
 *
 * Columnas CSV Wallet: account, category, currency, amount, ref_currency_amount,
 *   type (Expense/Income), payment_type, note, date, transfer, payee, labels.
 * Se firma el monto: Expense → negativo, Income → positivo.
 */
function normalizarBoard() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetCsv  = ss.getSheetByName(cfg.HOJAS.BOARD_CSV_RAW);
  const sheetNorm = ss.getSheetByName(cfg.HOJAS.BOARD_NORMALIZADO);

  if (!sheetCsv || sheetCsv.getLastRow() <= 1) return { procesados: 0, insertados: 0, error: cfg.HOJAS.BOARD_CSV_RAW + ' vacía o no existe' };
  if (!sheetNorm) return { procesados: 0, insertados: 0, error: 'Hoja ' + cfg.HOJAS.BOARD_NORMALIZADO + ' no existe (ejecuta Configuración)' };

  const filas = leerHoja_(sheetCsv);
  let procesados = 0;
  const newRows = [];

  filas.forEach((row, i) => {
    const account = row.account || '';
    const amount  = parseFloat(String(row.amount || 0).replace(/[$,\s]/g, '')) || 0;
    const tipo    = (row.type || '').toString().toLowerCase();
    const fecha   = (row.date || '').toString();
    if (!account && !amount) return;
    procesados++;

    const montoFirmado = tipo === 'expense' ? -Math.abs(amount) : (tipo === 'income' ? Math.abs(amount) : amount);
    const idInterno = 'BOARD_CSV_' + Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyyMMdd') + '_' + (i + 1);
    const note = row.note || '';

    // Esquema BOARD_NORMALIZADO (15 col).
    newRows.push([
      idInterno, 'Board', account, fecha, montoFirmado, row.currency || 'MXN',
      montoFirmado < 0 ? 'cargo' : 'abono',
      note, limpiarDescripcion_(note), '', '',
      row.category || '', row.labels || '', row.payee || '', idInterno,
    ]);
  });

  // Reemplazo total del normalizado (el CSV es la fuente íntegra del mes).
  if (sheetNorm.getLastRow() > 1) sheetNorm.deleteRows(2, sheetNorm.getLastRow() - 1);
  if (newRows.length > 0) sheetNorm.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);

  const msg = 'Board normalizado desde CSV: ' + newRows.length + ' de ' + procesados + ' filas';
  Logger.log(msg);
  notifyDiscordSuccess_('Normalización Board (Wallet CSV)', msg);
  return { procesados, insertados: newRows.length };
}


// ============================================================
// SECCIÓN 5 — IMPORTACIÓN SAT / CFDI
// ============================================================

/** Importa CFDIs SAT desde DRIVE_SAT_FOLDER_ID (escritura en batch). */
function importSATFromFolder() {
  const cfg = requireConfig_(['SPREADSHEET_ID', 'DRIVE_SAT_FOLDER_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetRaw   = ss.getSheetByName(cfg.HOJAS.CFDI_SAT_RAW);
  const sheetClean = ss.getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheetRaw || !sheetClean) return { success: false, error: 'Hojas CFDI_SAT_RAW o CFDI_SAT no encontradas (ejecuta Configuración)' };

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
      const f = line.split('~');
      if (f.length < 11) continue;
      const monto = parseFloat((f[8] || '').replace(/,/g, ''));
      const subtotal = monto / 1.16;
      rawRows.push([f[0], f[1], f[2], normalizeDate_(f[6]), subtotal.toFixed(2), (monto - subtotal).toFixed(2), monto.toFixed(2), 'MXN', '', f[9] || 'I', f[10]]);
    }
    filesProcessed++;
  }

  if (rawRows.length > 0) {
    sheetRaw.getRange(2, 1, rawRows.length, 11).setValues(rawRows);
    const cleanRows = rawRows.map(r => [...r, '']); // + link_archivo
    sheetClean.getRange(2, 1, cleanRows.length, cleanRows[0].length).setValues(cleanRows);
  }

  const dup = removeDuplicatesSAT();
  const msg = 'SAT importado: ' + rawRows.length + ' registros de ' + filesProcessed + ' archivos. Duplicados: ' + dup.duplicatesRemoved;
  Logger.log(msg);
  notifyDiscordSuccess_('Importación SAT', msg);
  return { success: true, totalRecords: rawRows.length, filesProcessed, duplicatesRemoved: dup.duplicatesRemoved };
}

/** Elimina filas duplicadas en CFDI_SAT por uuid_cfdi (reescritura en batch). */
function removeDuplicatesSAT() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.CFDI_SAT);
  if (!sheet || sheet.getLastRow() <= 1) return { duplicatesRemoved: 0 };

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const seen = new Set(); const unicos = []; let dup = 0;
  data.forEach(row => {
    const uuid = row[0];
    if (seen.has(uuid)) { dup++; return; }
    seen.add(uuid); unicos.push(row);
  });
  if (dup > 0) {
    sheet.getRange(2, 1, data.length, lastCol).clearContent();
    if (unicos.length) sheet.getRange(2, 1, unicos.length, lastCol).setValues(unicos);
  }
  return { duplicatesRemoved: dup };
}


// ============================================================
// SECCIÓN 6 — CONCILIACIÓN, ANOMALÍAS, EXPORT BOARD
// ============================================================

/**
 * Corre la conciliación fuzzy local (SAT vs Bancarios), escribe el resumen
 * en Historial_Conciliacion y notifica a Discord. La lógica fuzzy vive en
 * 05_Charly.gs (ejecutarFuzzyConciliacion_); aquí se orquesta y persiste.
 * @param {Object=} params { desde, hasta }
 */
function conciliarYRegistrar(params) {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const p = params || {};
  const r = ejecutarFuzzyConciliacion_({ desde: p.desde, hasta: p.hasta });
  if (r.error) { notifyDiscordError_('Error en conciliación', r.error); return r; }

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.HOJAS.HISTORIAL_CONCILIACION);
  if (sheet) {
    const ahora = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd HH:mm');
    const fila = ['CONCILIACION_' + ahora, ahora, 'TODOS', '', 0,
      'resumen', '', r.periodo + ' → confirmados:' + r.resumen.confirmados + ' posibles:' + r.resumen.posibles + ' sin_match:' + r.resumen.sin_match + ' cobertura:' + r.resumen.cobertura_pct + '%'];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
  }

  notifyDiscordSuccess_('Conciliación financiera', 'Período ' + r.periodo, {
    confirmados:  String(r.resumen.confirmados),
    posibles:     String(r.resumen.posibles),
    sin_match:    String(r.resumen.sin_match),
    cobertura:    r.resumen.cobertura_pct + '%',
  });
  return r;
}

/** Detecta gastos inusuales (>2σ por categoría) y los manda a Revision_Humana. */
function detectarAnomalias() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet  = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetR = ss.getSheetByName(cfg.HOJAS.REVISION_HUMANA);
  if (!sheet || sheet.getLastRow() <= 1) return { anomalias: 0 };

  const idx = colIndex_(sheet);
  const cMonto = idx['monto'], cCat = idx['categoria_board'], cDesc = idx['descripcion_limpia'];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const stats = new Map();

  data.forEach(row => {
    const monto = Math.abs(parseFloat(row[cMonto] || 0));
    const cat = row[cCat];
    if (!cat) return;
    if (!stats.has(cat)) stats.set(cat, { montos: [], sum: 0 });
    stats.get(cat).montos.push(monto); stats.get(cat).sum += monto;
  });
  stats.forEach(s => { const avg = s.sum / s.montos.length; s.avg = avg; s.std = Math.sqrt(s.montos.reduce((a, m) => a + (m - avg) ** 2, 0) / s.montos.length); });

  const anomalias = [];
  data.forEach(row => {
    const monto = Math.abs(parseFloat(row[cMonto] || 0));
    const cat = row[cCat];
    if (!cat || !stats.has(cat)) return;
    const s = stats.get(cat);
    if (monto > s.avg + 2 * s.std && s.montos.length > 5) {
      // Esquema Revision_Humana (14 col).
      anomalias.push([row[idx['id_interno']] || '', row[idx['fecha_movimiento']] || '', row[idx['banco']] || '', -monto, row[cDesc] || '', cat, 0, '', '', '', '', '', 'pendiente', 'ANOMALIA']);
    }
  });
  if (anomalias.length > 0 && sheetR) sheetR.getRange(sheetR.getLastRow() + 1, 1, anomalias.length, anomalias[0].length).setValues(anomalias);
  return { anomalias: anomalias.length };
}

/** Exporta movimientos categorizados de Maestros a formato Board (Estandares_Board). */
function exportarABoard() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheetM = ss.getSheetByName(cfg.HOJAS.MOVIMIENTOS_MAESTROS);
  const sheetE = ss.getSheetByName(cfg.HOJAS.ESTANDARES_BOARD);
  if (!sheetM || !sheetE) return { procesados: 0, exportados: 0, error: 'Hoja(s) requeridas no encontradas' };
  if (sheetM.getLastRow() <= 1) return { procesados: 0, exportados: 0 };

  const idx = colIndex_(sheetM);
  const data = sheetM.getRange(2, 1, sheetM.getLastRow() - 1, sheetM.getLastColumn()).getValues();
  const exportRows = [];
  let procesados = 0;

  data.forEach(row => {
    const cat = row[idx['categoria_board']];
    if (!cat) return;
    procesados++;
    const monto = parseFloat(row[idx['monto']] || 0);
    const banco = row[idx['banco']] || '', cuenta = row[idx['cuenta_bancaria']] || '';
    const desc = row[idx['descripcion_limpia']] || row[idx['descripcion_original']] || '';
    exportRows.push([
      (banco + ' - ' + cuenta).trim(), cat, row[idx['moneda']] || 'MXN',
      Math.abs(monto), Math.abs(monto), monto < 0 ? 'Expense' : 'Income',
      determinarPaymentType_(desc), desc, row[idx['fecha_movimiento']] || '',
      row[idx['transfer_board']] ? 'TRUE' : 'FALSE', row[idx['referencia']] || '', row[idx['labels_board']] || '',
    ]);
  });

  if (sheetE.getLastRow() > 1) sheetE.deleteRows(2, sheetE.getLastRow() - 1);
  if (exportRows.length > 0) sheetE.getRange(2, 1, exportRows.length, exportRows[0].length).setValues(exportRows);
  return { procesados, exportados: exportRows.length };
}


// ============================================================
// SECCIÓN 7 — MENÚ INTERACTIVO (organizado por FLUJO DE TRABAJO)
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Robot Finanzas AVECO')
    .addItem('▶ Ejecutar flujo completo', 'menuFlujoCompleto')
    .addItem('📊 Estado del sistema', 'menuEstado')
    .addSeparator()
    .addItem('1️⃣  Renombrar archivos en Drive', 'menuPaso1Renombrar')
    .addItem('2️⃣  Importar datos (Bancos + SAT)', 'menuPaso2Importar')
    .addItem('3️⃣  Normalizar datos (RAW → limpio)', 'menuPaso3Normalizar')
    .addItem('4️⃣  Conciliar con Charly', 'menuPaso4Conciliar')
    .addSeparator()
    .addSubMenu(ui.createMenu('🔧 Herramientas')
      .addItem('Normalizar solo Bancarios', 'menuNormalizarBancos')
      .addItem('Normalizar solo Board (Wallet CSV)', 'menuNormalizarBoard')
      .addItem('Importar solo SAT desde Drive', 'importSATFromFolder')
      .addItem('Detectar duplicados SAT', 'removeDuplicatesSAT')
      .addItem('Detectar anomalías', 'menuDetectarAnomalias')
      .addItem('Exportar a Board (Estandares_Board)', 'menuExportarBoard'))
    .addSeparator()
    .addItem('⚙️ Configuración (crear/reparar hojas)', 'menuConfigurar')
    .addToUi();
}

/** Paso 1 — Renombrado de todas las carpetas (vive en 03_Renombrador.gs). */
function menuPaso1Renombrar() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Paso 1 — Renombrar', 'Renombrar archivos en SAT, Bancarios y Wallet según su contenido?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try { renombrarTodo(); ui.alert('Renombrado', 'Proceso ejecutado. Revisa el log y Discord para el detalle.', ui.ButtonSet.OK); }
  catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

/** Paso 2 — Importación de bancos (desde Drive) + SAT. */
function menuPaso2Importar() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Paso 2 — Importar', 'Importar movimientos bancarios desde Drive e importar CFDIs SAT?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const b = importAllBankMovements_();  // 02_Importador.gs
    const s = importSATFromFolder();
    ui.alert('Importación', 'Bancos: ' + (b.totalMovimientos || 0) + ' movimientos\nSAT: ' + (s.totalRecords || 0) + ' CFDIs', ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

/** Paso 3 — Normalizar RAW → limpio (Bancarios + Board). */
function menuPaso3Normalizar() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Paso 3 — Normalizar', 'Pasar datos RAW a las tablas normalizadas (Bancarios + Board)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const b = normalizarMovimientosBancarios();
    const bo = normalizarBoard();
    ui.alert('Normalización', 'Bancarios: ' + (b.insertados || 0) + ' (' + (b.error || 'ok') + ')\nBoard: ' + (bo.insertados || 0) + ' (' + (bo.error || 'ok') + ')', ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

/** Paso 4 — Conciliación local + notificación a Discord. */
function menuPaso4Conciliar() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Paso 4 — Conciliar', 'Correr la conciliación financiera (SAT vs Bancarios) y notificar a Discord?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const r = conciliarYRegistrar({});
    if (r.error) { ui.alert('Error', r.error, ui.ButtonSet.OK); return; }
    ui.alert('Conciliación completada',
      'Período: ' + r.periodo + '\nConfirmados: ' + r.resumen.confirmados + '\nPosibles: ' + r.resumen.posibles + '\nSin match: ' + r.resumen.sin_match + '\nCobertura: ' + r.resumen.cobertura_pct + '%\n\nDetalle enviado a Discord.',
      ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuFlujoCompleto() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Flujo completo', '1) Importar Bancos + SAT\n2) Normalizar Bancos + Board\n3) Conciliar y notificar\n\n(El renombrado se corre aparte en el Paso 1).', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const b  = importAllBankMovements_();
    const s  = importSATFromFolder();
    const nb = normalizarMovimientosBancarios();
    const nbo = normalizarBoard();
    const c  = conciliarYRegistrar({});
    ui.alert('Flujo completo terminado',
      'Bancos import: ' + (b.totalMovimientos || 0) + '\nSAT import: ' + (s.totalRecords || 0) +
      '\nBancos norm: ' + (nb.insertados || 0) + '\nBoard norm: ' + (nbo.insertados || 0) +
      '\nConciliación: ' + (c.resumen ? c.resumen.cobertura_pct + '% cobertura' : 'ver Discord'),
      ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuConfigurar() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Configuración', 'Crear las pestañas y encabezados que falten según el esquema?\n\nNo borra ni modifica datos existentes.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const r = configurarDataLake();
    let msg = 'Hojas creadas: ' + (r.creadas.join(', ') || 'ninguna') +
      '\nEncabezados puestos: ' + (r.encabezadosPuestos.join(', ') || 'ninguno') +
      '\nYa correctas: ' + r.yaExistian.length;
    if (r.conDiferencias.length) {
      msg += '\n\n⚠ Revisar (faltan columnas, NO se tocaron):\n' +
        r.conDiferencias.map(d => '• ' + d.hoja + ': ' + d.faltantes.join(', ')).join('\n');
    }
    ui.alert('Configuración completada', msg, ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuNormalizarBancos() {
  const ui = SpreadsheetApp.getUi();
  try { const r = normalizarMovimientosBancarios(); ui.alert(r.error ? 'Aviso' : 'Bancarios normalizados', r.error || ('Insertados: ' + r.insertados + '\nDuplicados: ' + r.duplicados), ui.ButtonSet.OK); }
  catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuNormalizarBoard() {
  const ui = SpreadsheetApp.getUi();
  try { const r = normalizarBoard(); ui.alert(r.error ? 'Aviso' : 'Board normalizado', r.error || ('Insertados: ' + r.insertados + ' de ' + r.procesados), ui.ButtonSet.OK); }
  catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuExportarBoard() {
  const ui = SpreadsheetApp.getUi();
  try { const r = exportarABoard(); ui.alert('Exportación', 'Procesados: ' + r.procesados + '\nExportados: ' + r.exportados, ui.ButtonSet.OK); }
  catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuDetectarAnomalias() {
  const ui = SpreadsheetApp.getUi();
  try { const r = detectarAnomalias(); ui.alert('Anomalías', 'Movimientos inusuales: ' + r.anomalias + (r.anomalias > 0 ? '\nRevisa Revision_Humana.' : ''), ui.ButtonSet.OK); }
  catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

function menuEstado() {
  const ui = SpreadsheetApp.getUi();
  try {
    const s = getStatus();
    const lineas = Object.values(s.hojas).map(v => v.nombre + ': ' + v.filas + (v.existe ? '' : ' (NO EXISTE)')).join('\n');
    ui.alert('Estado del DataLake', lineas + '\n\nPendientes revisión: ' + (s.revisionPendiente || 0), ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}


// ============================================================
// SECCIÓN 8 — UTILIDADES INTERNAS
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

function hoy_() { return Utilities.formatDate(new Date(), getConfig().TIMEZONE, 'yyyy-MM-dd'); }

function getHaceNDias_(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, getConfig().TIMEZONE, 'yyyy-MM-dd');
}

function formatMXN_(monto) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto || 0);
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
  const raw = banco + '_' + cuenta + '_' + fechaStr + '_' + montoStr + '_' + (folio || '');
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


// ============================================================
// SECCIÓN 9 — PRUEBAS MANUALES (no modifican datos)
// ============================================================

function testConectividad() {
  const cfg = getConfig();
  Logger.log('Spreadsheet ID: ' + (cfg.SPREADSHEET_ID || '(no configurado)'));
  try {
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    Logger.log('Sheet accesible: ' + ss.getName());
    Object.entries(cfg.HOJAS).forEach(([k, n]) => {
      const s = ss.getSheetByName(n);
      Logger.log('  ' + k + ' (' + n + '): ' + (s ? (s.getLastRow() - 1) + ' filas' : 'NO EXISTE'));
    });
  } catch (e) { Logger.log('ERROR: ' + e.toString()); }
  if (cfg.DISCORD_WEBHOOK_URL) notifyDiscordSuccess_('Test AVECO DataLake', 'Conectividad verificada.');
}

function testScript() {
  Logger.log('getStatus:\n' + JSON.stringify(getStatus(), null, 2));
  Logger.log('getBancarios:\n' + JSON.stringify(getBancarios({ limite: 5 }), null, 2));
}
