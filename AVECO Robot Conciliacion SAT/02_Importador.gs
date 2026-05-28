/**
 * ============================================================
 * AVECO Robot Financiero — Importador de Movimientos Bancarios
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.0.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Robot diario para importación y deduplicación de movimientos
 *   bancarios desde Google Drive hacia MOVIMIENTOS_BANCARIOS_RAW.
 *   Soporta Sheets, CSV, TXT, TSV y XML (parser base por banco).
 *   Notifica resultados y errores a Discord (módulo compartido).
 *
 * TRIGGER:
 *   - Time-based diario ~06:00 (America/Mexico_City).
 *   - Función objetivo: runDailySync()
 *   - Instalar: installDailyTrigger()  ·  Remover: removeDailyTrigger()
 *
 * CONFIGURACIÓN (Script Properties — ver 00_Config.gs):
 *   SPREADSHEET_ID          → Google Sheet destino
 *   DRIVE_BANCOS_FOLDER_ID  → Carpeta raíz de bancos (subcarpetas por banco)
 *   DISCORD_WEBHOOK_URL     → Webhook de notificaciones
 *
 * HOJAS REQUERIDAS:
 *   MOVIMIENTOS_BANCARIOS_RAW · MOVIMIENTOS_BANCARIOS
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig() / requireConfig_()   → 00_Config.gs
 *   notifyDiscordSuccess_/Error_     → 01_Notificaciones.gs
 *
 * NOTAS DE SEGURIDAD:
 *   - Sin IDs ni webhooks en el código. Todo en Script Properties.
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — MAPEO DE COLUMNAS POR BANCO
// ============================================================

/**
 * Mapeo de columnas por banco. Columna -1 = campo no disponible.
 * Es una constante fija del proyecto (no cambia por entorno).
 */
const BANK_CONFIG = {
  'TD FONDEADORA': { columnMap: { fecha: 1, descripcion: 3, cargo: 4, abono: 5, saldo: 6, referencia: 9 } },
  'TC KONFIO':     { columnMap: { fecha: 0, descripcion: 1, cargo: 3, abono: 4, saldo: 5, referencia: 7 } },
  'TC CLARA':      { columnMap: { fecha: 0, descripcion: 2, cargo: 3, abono: 5, saldo: -1, referencia: 6 } },
  'TD SANTANDER':  { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 } },
  'TD BBVA':       { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: -1 }, useTSV: true, dateFormat: 'MM-DD-YYYY' },
  'TD BASE MXN':   { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 } },
  'TD BASE USD':   { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 } },
  'TD DOLAR MXN':  { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 } },
  'TD DOLAR USD':  { columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 } },
};


// ============================================================
// SECCIÓN 2 — FUNCIÓN PRINCIPAL (objetivo del trigger diario)
// ============================================================

/**
 * Función principal diaria: importa movimientos y deduplica.
 * Secuencia: importar → deduplicar → notificar resumen.
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

    const durationMs = new Date().getTime() - startedAt.getTime();

    PropertiesService.getScriptProperties()
      .setProperty('LAST_SUCCESSFUL_SYNC', startedAt.toISOString());

    notifyDiscordSuccess_(
      'Sincronización diaria completada ✅',
      'Importación y deduplicación finalizadas correctamente.',
      {
        movimientosImportados: String(importResult.totalMovimientos || 0),
        duplicadosEliminados:  String(dedupResult.duplicatesRemoved || 0),
        duracion:              durationMs + ' ms',
        fecha:                 Utilities.formatDate(startedAt, cfg.TIMEZONE, 'dd/MM/yyyy HH:mm'),
      }
    );

    Logger.log('runDailySync completado en ' + durationMs + ' ms');

  } catch (error) {
    Logger.log('Error en runDailySync: ' + error.toString());
    notifyDiscordError_(
      'ERROR en sincronización diaria 🚨',
      'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || '')
    );
  }
}


// ============================================================
// SECCIÓN 3 — LÓGICA DE IMPORTACIÓN
// ============================================================

/**
 * Importa todos los movimientos bancarios desde las subcarpetas
 * de Drive hacia MOVIMIENTOS_BANCARIOS_RAW.
 * @returns {Object} { success, totalMovimientos, movimientosPorBanco?, error? }
 */
function importAllBankMovements_() {
  try {
    const cfg = requireConfig_(['SPREADSHEET_ID', 'DRIVE_BANCOS_FOLDER_ID']);
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const sheetRaw   = ss.getSheetByName(cfg.HOJAS.BANCARIOS_RAW);
    const sheetClean = ss.getSheetByName(cfg.HOJAS.BANCARIOS);

    if (!sheetRaw || !sheetClean) {
      throw new Error('Las hojas ' + cfg.HOJAS.BANCARIOS_RAW + ' y ' + cfg.HOJAS.BANCARIOS + ' no existen');
    }

    // Limpiar hojas antes de reimportar
    if (sheetRaw.getLastRow()   > 1) sheetRaw.deleteRows(2,   sheetRaw.getLastRow()   - 1);
    if (sheetClean.getLastRow() > 1) sheetClean.deleteRows(2, sheetClean.getLastRow() - 1);

    // Detectar subcarpetas por banco
    const parentFolder = DriveApp.getFolderById(cfg.DRIVE_BANCOS_FOLDER_ID);
    const subfolders   = parentFolder.getFolders();
    const bancoFolders = {};
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      bancoFolders[folder.getName().toUpperCase()] = folder.getId();
    }

    let totalMovimientos      = 0;
    const movimientosPorBanco = {};

    for (const bancoName in bancoFolders) {
      if (!BANK_CONFIG[bancoName]) {
        Logger.log('AVISO: ' + bancoName + ' sin configuración en BANK_CONFIG. Se omitirá.');
        continue;
      }
      const movs = processBankFolder_(bancoFolders[bancoName], bancoName);
      movimientosPorBanco[bancoName] = movs.length;
      totalMovimientos += movs.length;
      if (movs.length > 0) writeToSheet_(sheetRaw, movs);
    }

    for (const banco in movimientosPorBanco) {
      Logger.log(banco + ': ' + movimientosPorBanco[banco] + ' movimientos importados');
    }

    return { success: true, totalMovimientos, movimientosPorBanco };

  } catch (error) {
    Logger.log('Error en importAllBankMovements_: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}


// ============================================================
// SECCIÓN 4 — LÓGICA DE DEDUPLICACIÓN
// ============================================================

/**
 * Detecta y elimina duplicados en MOVIMIENTOS_BANCARIOS.
 * Criterio: Banco | Fecha normalizada | Cargo | Abono | Referencia.
 * Reescribe la hoja en un solo batch (más eficiente que deleteRow en bucle).
 * @returns {Object} { success, duplicatesRemoved, processedRows, durationMs, error? }
 */
function removeDuplicatesBancarios_() {
  const startedAt = new Date();

  try {
    const cfg   = requireConfig_(['SPREADSHEET_ID']);
    const sheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName(cfg.HOJAS.BANCARIOS);
    if (!sheet) throw new Error('Hoja ' + cfg.HOJAS.BANCARIOS + ' no existe');

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) {
      return { success: true, duplicatesRemoved: 0, message: 'No hay datos para procesar' };
    }

    const data    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const seen     = new Set();
    const unicos   = [];
    let duplicados = 0;

    data.forEach(row => {
      const key = [row[0], normalizeDateForKey_(row[1]), row[4], row[5], row[3]].join('|');
      if (seen.has(key)) { duplicados++; return; }
      seen.add(key);
      unicos.push(row);
    });

    if (duplicados > 0) {
      sheet.getRange(2, 1, data.length, lastCol).clearContent();
      if (unicos.length) sheet.getRange(2, 1, unicos.length, lastCol).setValues(unicos);
    }

    return {
      success:           true,
      duplicatesRemoved: duplicados,
      processedRows:     data.length,
      durationMs:        new Date().getTime() - startedAt.getTime(),
    };

  } catch (error) {
    Logger.log('Error en removeDuplicatesBancarios_: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}


// ============================================================
// SECCIÓN 5 — UTILIDADES PRIVADAS
// ============================================================

/**
 * Procesa los archivos de una carpeta de banco.
 * @param {string} folderId
 * @param {string} bancoName
 * @returns {Array<Array>}
 */
function processBankFolder_(folderId, bancoName) {
  const folder      = DriveApp.getFolderById(folderId);
  const files       = folder.getFiles();
  const movimientos = [];
  const configBanco = BANK_CONFIG[bancoName];

  while (files.hasNext()) {
    const file = files.next();
    try {
      const fileData = readFileUniversal_(file, bancoName);
      if (!fileData || fileData.length <= 1) {
        Logger.log('Archivo vacío o sin datos: ' + file.getName());
        continue;
      }

      for (let i = 1; i < fileData.length; i++) {
        const row = fileData[i];
        if (!row || !row[0]) continue;

        const fechaRaw = row[configBanco.columnMap.fecha] || '';
        let fechaFinal = fechaRaw;

        // Normalización de fecha MM-DD-YYYY → DD-MM-YYYY (específico BBVA)
        if (configBanco.dateFormat === 'MM-DD-YYYY' && fechaRaw) {
          const partes = String(fechaRaw).split('-');
          if (partes.length === 3) fechaFinal = partes[1] + '-' + partes[0] + '-' + partes[2];
        }

        const descripcion = row[configBanco.columnMap.descripcion] || '';
        const cargo       = row[configBanco.columnMap.cargo] || '0';
        const abono       = row[configBanco.columnMap.abono] || '0';
        const saldo       = configBanco.columnMap.saldo      >= 0 ? (row[configBanco.columnMap.saldo]      || '0') : '0';
        const referencia  = configBanco.columnMap.referencia >= 0 ? (row[configBanco.columnMap.referencia] || '')  : '';

        movimientos.push([
          bancoName, fechaFinal, descripcion, referencia,
          cargo, abono, saldo,
          '', '', '',
          file.getName(),
        ]);
      }

      Logger.log('Procesados ' + (fileData.length - 1) + ' registros de ' + file.getName());

    } catch (e) {
      Logger.log('Error procesando ' + file.getName() + ': ' + e.toString());
    }
  }

  return movimientos;
}

/**
 * Lee un archivo de forma universal: Sheets, CSV, TXT, TSV o XML.
 * @param {File} file
 * @param {string} bancoName
 * @returns {Array<Array>}
 */
function readFileUniversal_(file, bancoName) {
  const mimeType = file.getMimeType();
  const fileName = file.getName().toLowerCase();

  try {
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getValues();
    }

    if (mimeType === 'text/csv' || mimeType === 'text/plain' ||
        fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      const content = file.getBlob().getDataAsString('UTF-8');
      const useTSV  = BANK_CONFIG[bancoName] && BANK_CONFIG[bancoName].useTSV;
      return content.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => useTSV ? line.split('\t') : parseCSVLine_(line));
    }

    if (mimeType === 'text/xml' || mimeType === 'application/xml' || fileName.endsWith('.xml')) {
      return parseXMLToArray_(file.getBlob().getDataAsString('UTF-8'));
    }

    Logger.log('Tipo MIME no soportado: ' + mimeType + ' → ' + file.getName());
    return [];

  } catch (e) {
    Logger.log('Error leyendo ' + file.getName() + ': ' + e.toString());
    return [];
  }
}

/**
 * Parser XML base. Implementación específica por banco pendiente.
 * @param {string} xmlContent
 * @returns {Array<Array>}
 */
function parseXMLToArray_(xmlContent) {
  try {
    XmlService.parse(xmlContent);
    Logger.log('Parser XML: implementación específica pendiente por banco.');
  } catch (e) {
    Logger.log('Error parseando XML: ' + e.toString());
  }
  return [];
}

/**
 * Escribe movimientos en la hoja destino en un solo batch.
 * @param {Sheet} sheet
 * @param {Array<Array>} movimientos
 */
function writeToSheet_(sheet, movimientos) {
  if (!movimientos || movimientos.length === 0) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, movimientos.length, 11).setValues(movimientos);
}

/**
 * Parser CSV con soporte para comillas y comas dentro de campos.
 * @param {string} line
 * @returns {Array<string>}
 */
function parseCSVLine_(line) {
  const fields = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Normaliza fecha a yyyy-MM-dd para claves de deduplicación.
 * @param {Date|string} date
 * @returns {string}
 */
function normalizeDateForKey_(date) {
  if (!date) return '';
  if (date instanceof Date) {
    return Utilities.formatDate(date, getConfig().TIMEZONE, 'yyyy-MM-dd');
  }

  const dateStr = date.toString().trim();
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})$/,
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
  ];

  for (const fmt of formats) {
    const match = dateStr.match(fmt);
    if (match) {
      return match[1].length === 4 ? dateStr : match[3] + '-' + match[2] + '-' + match[1];
    }
  }
  return dateStr;
}


// ============================================================
// SECCIÓN 6 — GESTIÓN DEL TRIGGER
// ============================================================

/**
 * Instala el trigger diario para runDailySync() a las 06:00 (México).
 * Ejecutar UNA VEZ manualmente desde el editor.
 */
function installDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('runDailySync')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone('America/Mexico_City')
    .create();
  Logger.log('Trigger diario instalado: runDailySync() → 06:00 America/Mexico_City');
}

/**
 * Elimina todos los triggers que apuntan a runDailySync().
 */
function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'runDailySync') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }
  Logger.log('Triggers runDailySync eliminados: ' + removed);
}


// ============================================================
// SECCIÓN 7 — FUNCIONES DE PRUEBA MANUAL
// ============================================================

/** Ejecuta el ciclo completo igual que el trigger. */
function testRunDailySync() {
  runDailySync();
}

/** Prueba solo la importación. */
function testImportBankMovements() {
  Logger.log('Resultado importación: ' + JSON.stringify(importAllBankMovements_()));
}

/** Prueba solo la deduplicación. */
function testDetectAndRemoveDuplicates() {
  Logger.log('Resultado deduplicación: ' + JSON.stringify(removeDuplicatesBancarios_()));
}

/** Verifica que el trigger esté correctamente instalado. */
function testCheckTriggerStatus() {
  const daily = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runDailySync');
  Logger.log(daily.length === 0
    ? 'No hay trigger instalado para runDailySync. Ejecutar installDailyTrigger().'
    : 'Trigger activo: ' + daily.length + ' instancia(s) de runDailySync');
}
