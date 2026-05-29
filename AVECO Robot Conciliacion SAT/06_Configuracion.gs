/**
 * ============================================================
 * AVECO Robot Financiero — Configuración del DataLake
 * ============================================================
 * Versión    : 3.2.0
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Dos modos de configuración:
 *
 *   A) configurarDataLake()  — SEGURO (el de siempre).
 *      Crea hojas/encabezados faltantes según getSchema_().
 *      No toca datos. Solo reporta diferencias.
 *
 *   B) configurarDesdeCero() — RECONSTRUCCIÓN CON FORMATO.
 *      Para CADA hoja del esquema: repone encabezados, aplica
 *      formato financiero (encabezado de marca, moneda, fechas),
 *      convierte las fechas-texto a fechas REALES y deja bandas.
 *      NO borra filas de datos (conserva lo que ya esté cargado).
 *
 *   + convertirEnTablasNativas()  — envuelve los datos en Tablas
 *      nativas de Google Sheets (requiere servicio avanzado "Sheets").
 *   + purgarPestanasFueraDeEsquema() — lista y borra (con confirmación)
 *      toda pestaña que NO esté en getSchema_().
 *
 * DEPENDENCIAS: getConfig() / getSchema_() / requireConfig_()  (00_Config.gs)
 *               notifyDiscordSuccess_                           (01_Notificaciones.gs)
 *
 * ── Para Tablas nativas ──
 *   Editor Apps Script → Servicios (+) → "Google Sheets API" → Agregar.
 *   Si no se activa, todo lo demás funciona; solo se salta ese paso.
 * ============================================================
 */

// ---- Parámetros de formato (edítalos si quieres dd/mm/yyyy, otro color, etc.) ----
const FMT_FECHA   = 'yyyy-mm-dd';
const FMT_MONEDA  = '$#,##0.00';
const FMT_TASA    = '0.0000';
const FMT_NUMERO  = '#,##0.00';
const HDR_BG      = '#1b4332';   // verde AVECO
const HDR_TXT     = '#ffffff';


// ============================================================
// MODO A — CONFIGURACIÓN SEGURA (sin cambios respecto a 3.1)
// ============================================================

/**
 * Crea hojas y encabezados faltantes según el esquema canónico.
 * Modo seguro: NO borra ni reescribe datos.
 * @returns {Object} Reporte { creadas, encabezadosPuestos, yaExistian, conDiferencias[] }
 */
function configurarDataLake() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const schema = getSchema_();
  const reporte = { creadas: [], encabezadosPuestos: [], yaExistian: [], conDiferencias: [] };

  Object.entries(schema).forEach(([nombreHoja, headers]) => {
    let sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) {
      sheet = ss.insertSheet(nombreHoja);
      escribirEncabezados_(sheet, headers);
      reporte.creadas.push(nombreHoja);
      return;
    }
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      escribirEncabezados_(sheet, headers);
      reporte.encabezadosPuestos.push(nombreHoja);
      return;
    }
    const actuales = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(h => (h === null || h === undefined) ? '' : h.toString().trim());
    const faltantes = headers.filter(h => actuales.indexOf(h) === -1);
    if (faltantes.length) reporte.conDiferencias.push({ hoja: nombreHoja, faltantes });
    else reporte.yaExistian.push(nombreHoja);
  });

  Logger.log('configurarDataLake: ' + JSON.stringify(reporte, null, 2));
  notifyDiscordSuccess_('Configuración del DataLake',
    'Creadas: ' + reporte.creadas.length + ' | OK: ' + reporte.yaExistian.length +
    ' | Con diferencias: ' + reporte.conDiferencias.length,
    { creadas: reporte.creadas.join(', ') || '—', revisar: reporte.conDiferencias.map(d => d.hoja).join(', ') || '—' });
  return reporte;
}

/** Escribe encabezados en negrita + congela fila 1. */
function escribirEncabezados_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}


// ============================================================
// MODO B — RECONSTRUCCIÓN CON FORMATO FINANCIERO
// ============================================================

/**
 * Para cada hoja del esquema: crea si falta, repone encabezados, aplica
 * formato financiero, convierte fechas-texto a fechas reales y bandas.
 * CONSERVA los datos existentes (no borra filas).
 * @returns {{procesadas:string[], creadas:string[], fechasCoercionadas:Object}}
 */
function configurarDesdeCero() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const schema = getSchema_();
  const procesadas = [], creadas = [], fechasCoercionadas = {};

  Object.entries(schema).forEach(([nombreHoja, headers]) => {
    let sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) { sheet = ss.insertSheet(nombreHoja); creadas.push(nombreHoja); }

    // Encabezados (siempre se reponen, por si la hoja perdió la fila 1)
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Fechas-texto → Date real (para que el formato y las Tablas las reconozcan)
    const n = coercionarFechasReales_(sheet, headers);
    if (n) fechasCoercionadas[nombreHoja] = n;

    // Formato financiero + bandas
    formatearHojaFinanciera_(sheet, headers);
    procesadas.push(nombreHoja);
  });

  Logger.log('configurarDesdeCero: ' + JSON.stringify({ procesadas, creadas, fechasCoercionadas }, null, 2));
  notifyDiscordSuccess_('Reconstrucción con formato',
    'Hojas procesadas: ' + procesadas.length + ' | nuevas: ' + creadas.length,
    { creadas: creadas.join(', ') || '—' });
  return { procesadas, creadas, fechasCoercionadas };
}

/**
 * Aplica el look financiero a una hoja: encabezado de marca, congelado,
 * formato de moneda/fecha/número por columna (sobre toda la columna, para
 * que los datos reimportados lo hereden), bandas y autoajuste.
 * @param {Sheet} sheet
 * @param {string[]} headers
 */
function formatearHojaFinanciera_(sheet, headers) {
  const nCols = headers.length;

  // Encabezado
  const hdr = sheet.getRange(1, 1, 1, nCols);
  hdr.setBackground(HDR_BG).setFontColor(HDR_TXT).setFontWeight('bold')
     .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 28);

  // Formato por columna (filas 2 → fin del área de la hoja)
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  headers.forEach((h, i) => {
    const col = sheet.getRange(2, i + 1, maxRows, 1);
    switch (clasificarColumna_(h)) {
      case 'moneda': col.setNumberFormat(FMT_MONEDA).setHorizontalAlignment('right'); break;
      case 'tasa':   col.setNumberFormat(FMT_TASA).setHorizontalAlignment('right'); break;
      case 'numero': col.setNumberFormat(FMT_NUMERO).setHorizontalAlignment('right'); break;
      case 'fecha':  col.setNumberFormat(FMT_FECHA); break;
      default:       col.setNumberFormat('@'); // texto plano
    }
  });

  // Bandas alternadas (se quitan las previas para no apilar)
  sheet.getBandings().forEach(b => b.remove());
  const filas = Math.max(sheet.getLastRow(), 2);
  sheet.getRange(1, 1, filas, nCols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);

  sheet.autoResizeColumns(1, nCols);
}

/**
 * Clasifica una columna por su nombre para decidir el formato.
 * @param {string} nombre
 * @returns {'fecha'|'moneda'|'tasa'|'numero'|'texto'}
 */
function clasificarColumna_(nombre) {
  const n = String(nombre).toLowerCase();
  if (n === 'date' || n.indexOf('fecha') !== -1) return 'fecha';
  if (n === 'tipo_cambio') return 'tasa';
  const moneda = ['monto', 'subtotal', 'iva', 'total', 'amount', 'saldo', 'cargo', 'abono', 'importe', 'diff'];
  if (moneda.some(k => n.indexOf(k) !== -1)) return 'moneda';
  if (['frecuencia', 'confidence', 'confianza'].some(k => n.indexOf(k) !== -1)) return 'numero';
  return 'texto';
}

/**
 * Convierte las celdas de las columnas de fecha (texto 'YYYY-MM-DD' o el
 * texto feo de un Date serializado) a objetos Date reales, evitando el
 * corrimiento de un día por zona horaria.
 * @param {Sheet} sheet
 * @param {string[]} headers
 * @returns {number} total de celdas convertidas
 */
function coercionarFechasReales_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  let total = 0;

  headers.forEach((h, i) => {
    if (clasificarColumna_(h) !== 'fecha') return;
    const rng = sheet.getRange(2, i + 1, lastRow - 1, 1);
    const vals = rng.getValues();
    let cambios = 0;
    const out = vals.map(r => {
      const v = r[0];
      if (v instanceof Date || v === '' || v == null) return [v];
      const d = aFechaCelda_(v);
      if (d) { cambios++; return [d]; }
      return [v];
    });
    if (cambios) { rng.setValues(out); total += cambios; }
  });
  return total;
}

/**
 * Parsea un valor a Date real. 'YYYY-MM-DD' se construye en hora local
 * (sin corrimiento). Otros formatos se intentan con new Date().
 * @param {string} v
 * @returns {Date|null}
 */
function aFechaCelda_(v) {
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}


// ============================================================
// TABLAS NATIVAS  (requiere servicio avanzado "Sheets")
// ============================================================

/**
 * Envuelve el rango con datos de cada hoja del esquema en una Tabla nativa.
 * Si el servicio "Sheets" no está activo, no truena: lo reporta.
 * @returns {{ok:string[], saltadas:string[]}}
 */
function convertirEnTablasNativas() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const schema = getSchema_();
  const ok = [], saltadas = [];

  if (typeof Sheets === 'undefined') {
    Logger.log('Servicio avanzado "Sheets" no activado (Servicios + → Google Sheets API).');
    return { ok, saltadas: Object.keys(schema) };
  }

  Object.entries(schema).forEach(([nombreHoja, headers]) => {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet || sheet.getLastRow() < 2) { saltadas.push(nombreHoja); return; }
    try {
      const f = sheet.getFilter(); if (f) f.remove();           // Tabla y filtro no conviven
      sheet.getBandings().forEach(b => b.remove());             // la Tabla trae su propio estilo
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          addTable: {
            table: {
              name: 'tbl_' + nombreHoja,
              range: {
                sheetId: sheet.getSheetId(),
                startRowIndex: 0, endRowIndex: sheet.getLastRow(),
                startColumnIndex: 0, endColumnIndex: headers.length,
              },
            },
          },
        }],
      }, ss.getId());
      ok.push(nombreHoja);
    } catch (e) {
      Logger.log('Tabla nativa falló en ' + nombreHoja + ': ' + e);
      saltadas.push(nombreHoja);
    }
  });
  return { ok, saltadas };
}


// ============================================================
// PURGA DE PESTAÑAS FUERA DE ESQUEMA
// ============================================================

/**
 * Lista las pestañas que NO están en getSchema_() (RAW basura, copias,
 * volcados manuales) para que decidas. NO borra aquí: solo reporta.
 * @returns {string[]} nombres fuera de esquema
 */
function listarPestanasFueraDeEsquema_() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const canon = Object.keys(getSchema_());
  return ss.getSheets().map(s => s.getName()).filter(n => canon.indexOf(n) === -1);
}

/**
 * Borra (con confirmación) toda pestaña que no esté en el esquema.
 * Las del esquema se conservan siempre.
 * @returns {{borradas:string[]}}
 */
function purgarPestanasFueraDeEsquema() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sobran = listarPestanasFueraDeEsquema_();
  const borradas = [];
  sobran.forEach(n => {
    try { ss.deleteSheet(ss.getSheetByName(n)); borradas.push(n); }
    catch (e) { Logger.log('No se pudo borrar ' + n + ': ' + e); }
  });
  Logger.log('purgarPestanasFueraDeEsquema: ' + JSON.stringify(borradas));
  return { borradas };
}


// ============================================================
// WRAPPERS DE MENÚ  (cuélgalos en onOpen de 04_DataLake.gs)
// ============================================================

/** Menú: reconstrucción con formato (no borra datos). */
function menuConfigurarDesdeCero() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Configurar desde cero (con formato)',
      'Repone encabezados, aplica formato financiero, convierte fechas a fechas reales y bandas en TODAS las hojas del esquema.\n\nNO borra filas de datos. ¿Continuar?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try {
    const r = configurarDesdeCero();
    ui.alert('Listo', 'Hojas procesadas: ' + r.procesadas.length + '\nNuevas: ' + (r.creadas.join(', ') || '—'), ui.ButtonSet.OK);
  } catch (e) { ui.alert('Error', e.message, ui.ButtonSet.OK); }
}

/** Menú: convertir en Tablas nativas (tras tener datos). */
function menuConvertirTablasNativas() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Convertir en Tablas nativas',
      'Envuelve los datos en Tablas nativas de Sheets. Requiere el servicio avanzado "Google Sheets API". ¿Continuar?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const r = convertirEnTablasNativas();
  ui.alert('Tablas nativas', 'Creadas: ' + (r.ok.join(', ') || '—') + (r.saltadas.length ? '\nSaltadas: ' + r.saltadas.join(', ') : ''), ui.ButtonSet.OK);
}

/** Menú: purgar pestañas fuera de esquema (lista y confirma antes de borrar). */
function menuPurgarPestanas() {
  const ui = SpreadsheetApp.getUi();
  const sobran = listarPestanasFueraDeEsquema_();
  if (!sobran.length) { ui.alert('Nada que purgar', 'Solo existen las pestañas del esquema.', ui.ButtonSet.OK); return; }
  if (ui.alert('Purgar pestañas fuera de esquema',
      'Voy a BORRAR estas ' + sobran.length + ' pestañas:\n\n' + sobran.join('\n') +
      '\n\n(Las del esquema se conservan. Irreversible.)\n¿Continuar?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const r = purgarPestanasFueraDeEsquema();
  ui.alert('Purga completa', 'Borradas: ' + r.borradas.length + ' de ' + sobran.length, ui.ButtonSet.OK);
}


// ============================================================
// PRUEBA MANUAL (solo lectura)
// ============================================================

/** Reporta el estado de la estructura sin crear nada. */
function testEstructuraDataLake() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  Object.entries(getSchema_()).forEach(([nombreHoja, headers]) => {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) { Logger.log('FALTA HOJA: ' + nombreHoja); return; }
    const actuales = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => (h || '').toString().trim())
      : [];
    const faltantes = headers.filter(h => actuales.indexOf(h) === -1);
    Logger.log(nombreHoja + ': ' + (faltantes.length ? 'faltan [' + faltantes.join(', ') + ']' : 'OK'));
  });
  Logger.log('Fuera de esquema: ' + (listarPestanasFueraDeEsquema_().join(', ') || '—'));
}
