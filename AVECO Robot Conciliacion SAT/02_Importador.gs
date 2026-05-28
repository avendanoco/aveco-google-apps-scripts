/**
 * ============================================================
 * AVECO Robot Financiero — Importador de Movimientos Bancarios
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.2.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Robot diario de importación bancaria. Cada banco exporta su CSV con
 *   una estructura DISTINTA, así que cada uno tiene su PROPIA función
 *   parser (BANK_PARSERS) que sabe leer su formato y devuelve un registro
 *   homogéneo. Todos escriben el MISMO esquema en MOVIMIENTOS_BANCARIOS_RAW.
 *
 *   El parser se elige por el NOMBRE DE LA SUBCARPETA del banco en Drive
 *   (debe empezar con la clave del banco: 'TD SANTANDER', 'TD FONDEADORA',
 *   'TD DOLAR', 'TD BBVA', 'TC KONFIO', 'TC CLARA').
 *
 * MONEDA:
 *   La columna 'monto' es SIEMPRE en MXN (moneda base del DataLake).
 *   Para la cuenta en dólares, se conserva además 'monto_usd' y 'tipo_cambio'.
 *
 * TRIGGER:
 *   runDailySync()  → diario ~06:00 (America/Mexico_City)
 *   installDailyTrigger() / removeDailyTrigger()
 *
 * CONFIGURACIÓN (Script Properties — ver 00_Config.gs):
 *   SPREADSHEET_ID · DRIVE_BANCOS_FOLDER_ID · DISCORD_WEBHOOK_URL
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig / getSchema_ / requireConfig_ / colIndex_  → 00_Config.gs
 *   notifyDiscordSuccess_/Error_                         → 01_Notificaciones.gs
 *   normalizarMovimientosBancarios                       → 04_DataLake.gs
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — PARSERS POR BANCO
// ============================================================
//
// Cada parser recibe una fila YA partida en campos (array de strings) y
// devuelve un objeto homogéneo, o null si la fila debe ignorarse:
//   { fecha, descripcion, referencia, monto, moneda, monto_usd, tipo_cambio,
//     contraparte }
// 'monto' es firmado y en MXN: negativo = egreso, positivo = ingreso.
//
// CONVENCIÓN DE SIGNO:
//   - Cuentas de débito (TD): cargo/egreso negativo, abono/ingreso positivo.
//   - Tarjetas de crédito (TC): una COMPRA es un gasto → la guardamos negativa;
//     bonificaciones/pagos (montos negativos en el CSV) → positivos.

/**
 * Diccionario de parsers. La clave es el prefijo del nombre de la subcarpeta.
 * separator: ',' o '\t'. skipHeader: nº de filas de encabezado a saltar.
 */
const BANK_PARSERS = {

  // Santander: coma, 21 columnas. Signo explícito en col 5 (+/-).
  // Fecha 'DDMMYYYY' (con comillas simples). Monto en col 6. MXN.
  'TD SANTANDER': {
    separator: ',', skipHeader: 1,
    parse: function (c) {
      if (c.length < 8) return null;
      const fecha = parseFechaDDMMYYYY_(limpiaComillas_(c[1]));
      const signo = limpiaComillas_(c[5]).trim();
      const importe = parseImporte_(c[6]);
      if (!importe && importe !== 0) return null;
      const monto = signo === '-' ? -Math.abs(importe) : Math.abs(importe);
      const desc = limpiaComillas_(c[4]).trim();
      const concepto = limpiaComillas_(c[9] || '').trim();
      // contraparte: beneficiario (egreso) u ordenante (ingreso) según signo
      const contraparte = signo === '-'
        ? limpiaComillas_(c[12] || '').trim()
        : limpiaComillas_(c[14] || '').trim();
      return {
        fecha, descripcion: (desc + (concepto ? ' | ' + concepto : '')).trim(),
        referencia: limpiaComillas_(c[8] || '').trim(),
        monto, moneda: 'MXN', monto_usd: '', tipo_cambio: '',
        contraparte,
      };
    },
  },

  // Fondeadora: coma, 19 columnas. Cargo col 4 / Abono col 5 (separados).
  // Fecha YYYY-MM-DD. Beneficiario col 11, concepto col 14. MXN.
  'TD FONDEADORA': {
    separator: ',', skipHeader: 1,
    parse: function (c) {
      if (c.length < 7) return null;
      const fecha = (c[1] || '').trim();
      const cargo = parseImporte_(c[4]);
      const abono = parseImporte_(c[5]);
      const monto = (abono || 0) - Math.abs(cargo || 0);
      return {
        fecha, descripcion: (c[14] || c[3] || '').trim(),
        referencia: (c[16] || c[15] || '').trim(),
        monto, moneda: 'MXN', monto_usd: '', tipo_cambio: '',
        contraparte: (c[11] || c[10] || '').trim(),
      };
    },
  },

  // Dólar USD (Wise/fintech): coma, 19 columnas. local_amount col 5 (firmado),
  // local_currency col 6, fx_rate col 7, base_amount col 8 (en USDC).
  // La moneda local suele ser MXN; conservamos USD aparte.
  'TD DOLAR': {
    separator: ',', skipHeader: 1,
    parse: function (c) {
      if (c.length < 9) return null;
      const fecha = parseFechaWise_(limpiaComillas_(c[0]));
      const localAmount = parseImporte_(c[5]);
      const localCur = (c[6] || 'MXN').trim().toUpperCase();
      const fx = parseImporte_(c[7]);
      const baseAmount = parseImporte_(c[8]); // en USDC ≈ USD
      // monto base del DataLake = MXN. Si la moneda local es MXN, ese es el monto.
      // Si la local fuera USD, convertimos a MXN con fx (fx = MXN por USD).
      let montoMXN, montoUSD;
      if (localCur === 'MXN') { montoMXN = localAmount; montoUSD = baseAmount; }
      else                    { montoUSD = localAmount; montoMXN = fx ? localAmount * fx : ''; }
      const tipo = (c[1] || '').trim();
      const desc = (c[4] || tipo || '').trim();
      return {
        fecha, descripcion: desc,
        referencia: (c[1] || '').trim(),
        monto: montoMXN, moneda: 'MXN',
        monto_usd: montoUSD, tipo_cambio: fx || '',
        contraparte: (c[3] || '').trim(),
      };
    },
  },

  // BBVA: TAB, 5 columnas. Fecha DD-MM-YYYY col 0, concepto col 1,
  // cargo col 2 / abono col 3. MXN.
  'TD BBVA': {
    separator: '\t', skipHeader: 1,
    parse: function (c) {
      if (c.length < 4) return null;
      const fecha = parseFechaDDMMYYYYGuion_((c[0] || '').trim());
      const cargo = parseImporte_(c[2]);
      const abono = parseImporte_(c[3]);
      const monto = (abono || 0) - Math.abs(cargo || 0);
      return {
        fecha, descripcion: (c[1] || '').trim(),
        referencia: '', monto, moneda: 'MXN', monto_usd: '', tipo_cambio: '',
        contraparte: '',
      };
    },
  },

  // Konfio (TC): coma, 23 columnas. Fecha YYYY-MM-DD col 0, desc col 1,
  // Monto($) col 3. Una COMPRA es gasto → negativa; un crédito (monto
  // negativo en CSV, p.ej. BONIFICACION) → positivo para nosotros.
  'TC KONFIO': {
    separator: ',', skipHeader: 1,
    parse: function (c) {
      if (c.length < 4) return null;
      const fecha = (c[0] || '').trim();
      const bruto = parseImporte_(c[3]);
      const tipo = (c[8] || '').trim().toUpperCase();
      // En el CSV: compra = positivo, bonificación/crédito = negativo.
      // Gasto debe quedar negativo en el DataLake:
      const monto = -bruto;
      return {
        fecha, descripcion: (c[1] || '').trim(),
        referencia: (c[7] || '').trim(),
        monto, moneda: 'MXN', monto_usd: '', tipo_cambio: '',
        contraparte: (c[16] || c[1] || '').trim(),
      };
    },
  },

  // Clara (TC): coma, 25 columnas, todos los campos entre comillas.
  // Fecha YYYY-MM-DD col 0, comercio col 2, Monto MXN col 5. Compra = gasto.
  'TC CLARA': {
    separator: ',', skipHeader: 1,
    parse: function (c) {
      if (c.length < 6) return null;
      const fecha = limpiaComillas_(c[0]).trim();
      const montoMXN = parseImporte_(c[5]);
      const comercio = limpiaComillas_(c[2]).trim();
      const descripcionExtra = limpiaComillas_(c[24] || '').trim();
      return {
        fecha,
        descripcion: (comercio + (descripcionExtra ? ' | ' + descripcionExtra : '')).trim(),
        referencia: limpiaComillas_(c[12] || '').trim(),
        monto: -Math.abs(montoMXN), moneda: 'MXN', monto_usd: '', tipo_cambio: '',
        contraparte: comercio,
      };
    },
  },
};

/**
 * Resuelve qué parser usar según el nombre de la subcarpeta.
 * Coincide por prefijo (la carpeta puede llamarse 'TD SANTANDER MXN', etc.).
 * @param {string} folderName
 * @returns {{key:string, parser:Object}|null}
 */
function resolverParser_(folderName) {
  const norm = folderName.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const key of Object.keys(BANK_PARSERS)) {
    if (norm.indexOf(key) === 0) return { key, parser: BANK_PARSERS[key] };
  }
  return null;
}


// ============================================================
// SECCIÓN 2 — FUNCIÓN PRINCIPAL (objetivo del trigger diario)
// ============================================================

/**
 * Función principal diaria: importa, deduplica y normaliza.
 */
function runDailySync() {
  const startedAt = new Date();
  const cfg = getConfig();
  Logger.log('=== runDailySync iniciado: ' + startedAt.toISOString() + ' ===');

  try {
    const importResult = importAllBankMovements_();
    if (!importResult.success) throw new Error('Falla en importación: ' + importResult.error);

    const dedupResult = removeDuplicatesBancarios_();
    if (!dedupResult.success) Logger.log('Advertencia en deduplicación: ' + dedupResult.error);

    // Encadenar normalización RAW → MOVIMIENTOS_BANCARIOS (vive en 04_DataLake.gs)
    const normResult = normalizarMovimientosBancarios();

    PropertiesService.getScriptProperties().setProperty('LAST_SUCCESSFUL_SYNC', startedAt.toISOString());
    const durationMs = new Date().getTime() - startedAt.getTime();

    notifyDiscordSuccess_('Sincronización diaria completada ✅', 'Importación, deduplicación y normalización finalizadas.', {
      importados:   String(importResult.totalMovimientos || 0),
      duplicados:   String(dedupResult.duplicatesRemoved || 0),
      normalizados: String(normResult.insertados || 0),
      duracion:     durationMs + ' ms',
      fecha:        Utilities.formatDate(startedAt, cfg.TIMEZONE, 'dd/MM/yyyy HH:mm'),
    });
    Logger.log('runDailySync completado en ' + durationMs + ' ms');

  } catch (error) {
    Logger.log('Error en runDailySync: ' + error.toString());
    notifyDiscordError_('ERROR en sincronización diaria 🚨', 'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || ''));
  }
}


// ============================================================
// SECCIÓN 3 — LÓGICA DE IMPORTACIÓN
// ============================================================

/**
 * Importa todos los movimientos bancarios desde las subcarpetas de Drive
 * hacia MOVIMIENTOS_BANCARIOS_RAW, usando el parser de cada banco.
 * @returns {Object} { success, totalMovimientos, movimientosPorBanco?, error? }
 */
function importAllBankMovements_() {
  try {
    const cfg = requireConfig_(['SPREADSHEET_ID', 'DRIVE_BANCOS_FOLDER_ID']);
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const sheetRaw = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
    if (!sheetRaw) throw new Error('Hoja ' + cfg.HOJAS.BANCARIOS_RAW + ' no existe (ejecuta Configuración)');

    // Limpiar RAW antes de reimportar (es una foto completa de las carpetas).
    if (sheetRaw.getLastRow() > 1) sheetRaw.deleteRows(2, sheetRaw.getLastRow() - 1);

    const schema = getSchema_().MOVIMIENTOS_BANCARIOS_RAW; // orden de columnas destino
    const parentFolder = DriveApp.getFolderById(cfg.DRIVE_BANCOS_FOLDER_ID);
    const subfolders = parentFolder.getFolders();

    let totalMovimientos = 0;
    const movimientosPorBanco = {};
    const sinParser = [];
    const allRows = [];

    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const resuelto = resolverParser_(folder.getName());
      if (!resuelto) { sinParser.push(folder.getName()); continue; }

      const movs = procesarCarpetaBanco_(folder, resuelto.key, resuelto.parser);
      movimientosPorBanco[resuelto.key] = (movimientosPorBanco[resuelto.key] || 0) + movs.length;
      totalMovimientos += movs.length;

      // Convertir cada registro homogéneo al ORDEN del esquema RAW.
      movs.forEach(m => allRows.push(filaDesdeRegistro_(m, schema)));
    }

    if (allRows.length > 0) {
      sheetRaw.getRange(2, 1, allRows.length, schema.length).setValues(allRows);
    }

    if (sinParser.length) Logger.log('Carpetas sin parser (omitidas): ' + sinParser.join(', '));
    for (const b in movimientosPorBanco) Logger.log(b + ': ' + movimientosPorBanco[b] + ' movimientos');

    return { success: true, totalMovimientos, movimientosPorBanco, sinParser };

  } catch (error) {
    Logger.log('Error en importAllBankMovements_: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Procesa todos los archivos CSV/TSV de una carpeta de banco con su parser.
 * @param {Folder} folder
 * @param {string} bankKey
 * @param {Object} parser  Entrada de BANK_PARSERS.
 * @returns {Array<Object>} Registros homogéneos + campo archivo_origen/banco.
 */
function procesarCarpetaBanco_(folder, bankKey, parser) {
  const files = folder.getFiles();
  const registros = [];

  while (files.hasNext()) {
    const file = files.next();
    const nombre = file.getName();
    if (!/\.(csv|txt|tsv)$/i.test(nombre) &&
        file.getMimeType().indexOf('csv') === -1 &&
        file.getMimeType() !== 'text/plain') {
      continue;
    }

    try {
      const contenido = file.getBlob().getDataAsString('UTF-8');
      const lineas = contenido.split(/\r?\n/).filter(l => l.trim() !== '');
      for (let i = parser.skipHeader; i < lineas.length; i++) {
        const campos = splitLinea_(lineas[i], parser.separator);
        let reg;
        try { reg = parser.parse(campos); } catch (e) { reg = null; }
        if (!reg || !reg.fecha) continue;
        reg.banco = bankKey;
        reg.archivo_origen = nombre;
        registros.push(reg);
      }
      Logger.log(bankKey + ' · ' + nombre + ': ' + (lineas.length - parser.skipHeader) + ' filas leídas');
    } catch (e) {
      Logger.log('Error leyendo ' + nombre + ': ' + e.toString());
    }
  }
  return registros;
}

/**
 * Convierte un registro homogéneo al array ordenado según el esquema RAW.
 * @param {Object} m
 * @param {string[]} schema  Nombres de columna en orden.
 * @returns {Array}
 */
function filaDesdeRegistro_(m, schema) {
  const mapa = {
    banco: m.banco || '', fecha: m.fecha || '', descripcion: m.descripcion || '',
    referencia: m.referencia || '', monto: (m.monto === '' ? '' : m.monto),
    moneda: m.moneda || 'MXN', monto_usd: (m.monto_usd === '' ? '' : m.monto_usd),
    tipo_cambio: (m.tipo_cambio === '' ? '' : m.tipo_cambio),
    contraparte: m.contraparte || '', categoria: '', obra: '', link_cfdi: '',
    archivo_origen: m.archivo_origen || '',
  };
  return schema.map(col => (mapa[col] !== undefined ? mapa[col] : ''));
}


// ============================================================
// SECCIÓN 4 — DEDUPLICACIÓN
// ============================================================

/**
 * Elimina duplicados en MOVIMIENTOS_BANCARIOS_RAW.
 * Criterio: banco | fecha | monto | descripción. Reescribe en batch.
 * @returns {Object} { success, duplicatesRemoved, processedRows, error? }
 */
function removeDuplicatesBancarios_() {
  try {
    const cfg = requireConfig_(['SPREADSHEET_ID']);
    const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
    if (!sheet) throw new Error('Hoja ' + cfg.HOJAS.BANCARIOS_RAW + ' no existe');

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) return { success: true, duplicatesRemoved: 0, message: 'Sin datos' };

    const idx = colIndex_(sheet);
    const cB = idx['banco'] ?? 0, cF = idx['fecha'] ?? 1, cM = idx['monto'] ?? 4, cD = idx['descripcion'] ?? 2;

    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const seen = new Set(); const unicos = []; let dup = 0;
    data.forEach(row => {
      const key = [row[cB], row[cF], row[cM], row[cD]].join('|');
      if (seen.has(key)) { dup++; return; }
      seen.add(key); unicos.push(row);
    });

    if (dup > 0) {
      sheet.getRange(2, 1, data.length, lastCol).clearContent();
      if (unicos.length) sheet.getRange(2, 1, unicos.length, lastCol).setValues(unicos);
    }
    return { success: true, duplicatesRemoved: dup, processedRows: data.length };

  } catch (error) {
    Logger.log('Error en removeDuplicatesBancarios_: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}


// ============================================================
// SECCIÓN 5 — UTILIDADES DE PARSEO
// ============================================================

/**
 * Parser de línea CSV/TSV con soporte de comillas dobles y separador embebido.
 * @param {string} line
 * @param {string} sep  ',' o '\t'
 * @returns {string[]}
 */
function splitLinea_(line, sep) {
  if (sep === '\t') return line.split('\t');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Quita comillas simples envolventes tipo Santander ('texto '). */
function limpiaComillas_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/^['"]+|['"]+$/g, '');
}

/** Convierte importe textual ("1,234.56", "-50000.00", "57") a número. */
function parseImporte_(s) {
  if (s === null || s === undefined || s === '') return 0;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** 'DDMMYYYY' (Santander, con o sin comillas) → 'YYYY-MM-DD'. */
function parseFechaDDMMYYYY_(s) {
  const t = String(s).replace(/\D/g, '');
  if (t.length !== 8) return String(s);
  return t.substring(4, 8) + '-' + t.substring(2, 4) + '-' + t.substring(0, 2);
}

/** 'DD-MM-YYYY' (BBVA) → 'YYYY-MM-DD'. */
function parseFechaDDMMYYYYGuion_(s) {
  const m = String(s).match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s);
}

/** 'Dec 13, 2025, 03:59 PM' (Wise) → 'YYYY-MM-DD'. */
function parseFechaWise_(s) {
  const meses = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const m = String(s).match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return String(s);
  const mes = meses[m[1].toLowerCase()] || '01';
  return m[3] + '-' + mes + '-' + m[2].padStart(2, '0');
}


// ============================================================
// SECCIÓN 6 — GESTIÓN DEL TRIGGER
// ============================================================

function installDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('runDailySync').timeBased().atHour(6).everyDays(1).inTimezone('America/Mexico_City').create();
  Logger.log('Trigger diario instalado: runDailySync() → 06:00 America/Mexico_City');
}

function removeDailyTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDailySync') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('Triggers runDailySync eliminados: ' + removed);
}


// ============================================================
// SECCIÓN 7 — FUNCIONES DE PRUEBA MANUAL
// ============================================================

/** Ejecuta el ciclo diario completo. */
function testRunDailySync() { runDailySync(); }

/** Importa sin normalizar (revisar RAW). */
function testImportBankMovements() {
  Logger.log(JSON.stringify(importAllBankMovements_(), null, 2));
}

/** Lista qué subcarpetas hay y qué parser les tocaría (no importa nada). */
function testDetectarBancos() {
  const cfg = requireConfig_(['DRIVE_BANCOS_FOLDER_ID']);
  const subs = DriveApp.getFolderById(cfg.DRIVE_BANCOS_FOLDER_ID).getFolders();
  while (subs.hasNext()) {
    const f = subs.next();
    const r = resolverParser_(f.getName());
    Logger.log(f.getName() + ' → ' + (r ? r.key : 'SIN PARSER'));
  }
}

/** Verifica el estado del trigger diario. */
function testCheckTriggerStatus() {
  const daily = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runDailySync');
  Logger.log(daily.length ? 'Trigger activo: ' + daily.length : 'Sin trigger. Ejecuta installDailyTrigger().');
}
