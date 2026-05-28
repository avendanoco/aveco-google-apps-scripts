/**
 * ============================================================
 * AVECO Robot Movimientos Bancarios
 * ============================================================
 * Proyecto   : AVECO Robot Movimientos Bancarios
 * Versión    : 2.3.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Robot diario para importación y deduplicación de movimientos
 *   bancarios desde carpetas de Google Drive hacia las hojas
 *   MOVIMIENTOS_BANCARIOS_RAW y MOVIMIENTOS_BANCARIOS.
 *   Soporta Sheets, CSV, TXT, TSV y XML (parser base).
 *   Notifica resultados y errores a Discord.
 *
 * TRIGGER:
 *   - Time-based: diario entre 06:00–07:00 (hora Ciudad de México)
 *   - Función objetivo: runDailySync()
 *   - Para instalar el trigger ejecutar: installDailyTrigger()
 *   - Para removerlo ejecutar: removeDailyTrigger()
 *
 * CONFIGURACIÓN INICIAL (Script Properties):
 *   SPREADSHEET_ID       → ID del archivo de Google Sheets destino
 *   BANCOS_FOLDER_ID     → ID de la carpeta padre de bancos en Drive
 *   DISCORD_WEBHOOK_URL  → Webhook de Discord (opcional pero recomendado)
 *
 * HOJAS REQUERIDAS EN EL SPREADSHEET:
 *   - MOVIMIENTOS_BANCARIOS_RAW
 *   - MOVIMIENTOS_BANCARIOS
 *
 * NOTAS DE SEGURIDAD:
 *   - No guardar IDs, webhooks ni credenciales en este archivo.
 *   - Usar exclusivamente Script Properties para secretos.
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — CONFIGURACIÓN
// ============================================================

/**
 * Configuración centralizada del proyecto.
 * Lee todos los parámetros desde Script Properties.
 * @returns {Object}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const spreadsheetId     = props.getProperty('SPREADSHEET_ID');
  const bancosFolderId    = props.getProperty('BANCOS_FOLDER_ID');
  const discordWebhookUrl = props.getProperty('DISCORD_WEBHOOK_URL') || '';

  if (!spreadsheetId)  throw new Error('Falta configurar SPREADSHEET_ID en Script Properties');
  if (!bancosFolderId) throw new Error('Falta configurar BANCOS_FOLDER_ID en Script Properties');

  return {
    spreadsheetId,
    bancosFolderId,
    discordWebhookUrl,
    projectLabel: 'AVECO Robot Movimientos Bancarios'
  };
}

/**
 * Mapeo de columnas por banco.
 * Columna -1 = campo no disponible en ese extracto.
 */
const BANK_CONFIG = {
  'TD FONDEADORA': {
    columnMap: { fecha: 1, descripcion: 3, cargo: 4, abono: 5, saldo: 6, referencia: 9 }
  },
  'TC KONFIO': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 3, abono: 4, saldo: 5, referencia: 7 }
  },
  'TC CLARA': {
    columnMap: { fecha: 0, descripcion: 2, cargo: 3, abono: 5, saldo: -1, referencia: 6 }
  },
  'TD SANTANDER': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 }
  },
  'TD BBVA': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: -1 },
    useTSV: true,
    dateFormat: 'MM-DD-YYYY'
  },
  'TD BASE MXN': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 }
  },
  'TD BASE USD': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 }
  },
  'TD DOLAR MXN': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 }
  },
  'TD DOLAR USD': {
    columnMap: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, referencia: 5 }
  }
};


// ============================================================
// SECCIÓN 2 — FUNCIÓN PRINCIPAL (objetivo del trigger diario)
// ============================================================

/**
 * Función principal diaria: importa movimientos y deduplica.
 * Esta es la función configurada como trigger de tiempo.
 * Secuencia: importar → deduplicar → notificar resumen.
 */
function runDailySync() {
  const startedAt = new Date();
  Logger.log('=== runDailySync iniciado: ' + startedAt.toISOString() + ' ===');

  try {
    // Paso 1: Importar movimientos bancarios
    const importResult = importAllBankMovements_();

    if (!importResult.success) {
      throw new Error('Falla en importación: ' + importResult.error);
    }

    // Paso 2: Deduplicar
    const dedupResult = detectAndRemoveDuplicates_();

    if (!dedupResult.success) {
      // Deduplicación no es crítica; se registra y continúa
      Logger.log('Advertencia en deduplicación: ' + dedupResult.error);
    }

    const durationMs = new Date().getTime() - startedAt.getTime();

    // Guardar timestamp de última ejecución exitosa
    PropertiesService.getScriptProperties()
      .setProperty('LAST_SUCCESSFUL_SYNC', startedAt.toISOString());

    notifyDiscordSuccess_(
      'Sincronización diaria completada ✅',
      'Importación y deduplicación finalizadas correctamente.',
      {
        movimientosImportados: String(importResult.totalMovimientos || 0),
        duplicadosEliminados:  String(dedupResult.duplicatesRemoved  || 0),
        duracion:              durationMs + ' ms',
        fecha:                 Utilities.formatDate(startedAt, 'GMT-6', 'dd/MM/yyyy HH:mm')
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
 * @returns {Object} { success, totalMovimientos, error? }
 */
function importAllBankMovements_() {
  try {
    const config   = getConfig();
    const ss       = SpreadsheetApp.openById(config.spreadsheetId);
    const sheetRaw   = ss.getSheetByName('MOVIMIENTOS_BANCARIOS_RAW');
    const sheetClean = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');

    if (!sheetRaw || !sheetClean) {
      throw new Error('Las hojas MOVIMIENTOS_BANCARIOS_RAW y MOVIMIENTOS_BANCARIOS no existen');
    }

    // Limpiar hojas antes de reimportar
    if (sheetRaw.getLastRow()   > 1) sheetRaw.deleteRows(2,   sheetRaw.getLastRow()   - 1);
    if (sheetClean.getLastRow() > 1) sheetClean.deleteRows(2, sheetClean.getLastRow() - 1);

    // Detectar subcarpetas por banco
    const parentFolder = DriveApp.getFolderById(config.bancosFolderId);
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

    // Log detallado por banco
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
 * Criterio: Banco | Fecha normalizada | Cargo | Abono | Referencia
 * @returns {Object} { success, duplicatesRemoved, processedRows, durationMs, error? }
 */
function detectAndRemoveDuplicates_() {
  const startedAt = new Date();

  try {
    const config = getConfig();
    const sheet  = SpreadsheetApp.openById(config.spreadsheetId)
                                 .getSheetByName('MOVIMIENTOS_BANCARIOS');

    if (!sheet) throw new Error('Hoja MOVIMIENTOS_BANCARIOS no existe');

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, duplicatesRemoved: 0, message: 'No hay datos para procesar' };
    }

    const data         = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const seen         = new Set();
    const rowsToDelete = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const key = [
        row[0],
        normalizeDateForKey_(row[1]),
        row[4],
        row[5],
        row[3]
      ].join('|');

      if (seen.has(key)) {
        rowsToDelete.push(i + 2);
      } else {
        seen.add(key);
      }
    }

    // Eliminar de abajo hacia arriba para no desplazar índices
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    return {
      success:          true,
      duplicatesRemoved: rowsToDelete.length,
      processedRows:    data.length,
      durationMs:       new Date().getTime() - startedAt.getTime()
    };

  } catch (error) {
    Logger.log('Error en detectAndRemoveDuplicates_: ' + error.toString());
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
        const cargo       = row[configBanco.columnMap.cargo]       || '0';
        const abono       = row[configBanco.columnMap.abono]       || '0';
        const saldo       = configBanco.columnMap.saldo      >= 0 ? (row[configBanco.columnMap.saldo]      || '0') : '0';
        const referencia  = configBanco.columnMap.referencia >= 0 ? (row[configBanco.columnMap.referencia] || '')  : '';

        movimientos.push([
          bancoName, fechaFinal, descripcion, referencia,
          cargo, abono, saldo,
          '', '', '',
          file.getName()
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
 * Normaliza fecha a formato yyyy-MM-dd para claves de deduplicación.
 * @param {Date|string} date
 * @returns {string}
 */
function normalizeDateForKey_(date) {
  if (!date) return '';

  if (date instanceof Date) {
    return Utilities.formatDate(date, 'GMT-6', 'yyyy-MM-dd');
  }

  const dateStr = date.toString().trim();
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})$/,
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/
  ];

  for (const fmt of formats) {
    const match = dateStr.match(fmt);
    if (match) {
      return match[1].length === 4
        ? dateStr
        : match[3] + '-' + match[2] + '-' + match[1];
    }
  }

  return dateStr;
}


// ============================================================
// SECCIÓN 6 — NOTIFICACIONES DISCORD
// ============================================================

/** @param {string} title @param {string} description @param {Object=} extraFields */
function notifyDiscordSuccess_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 5793266, extraFields);   // Verde
}

/** @param {string} title @param {string} description @param {Object=} extraFields */
function notifyDiscordWarning_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 16776960, extraFields);  // Amarillo
}

/** @param {string} title @param {string} description @param {Object=} extraFields */
function notifyDiscordError_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 15548997, extraFields);  // Rojo
}

/**
 * Envío genérico de embed a Discord vía Webhook.
 * @param {string} title
 * @param {string} description
 * @param {number} color
 * @param {Object=} extraFields
 */
function sendDiscordEmbed_(title, description, color, extraFields) {
  const config = getConfig();

  if (!config.discordWebhookUrl) {
    Logger.log('DISCORD_WEBHOOK_URL no configurado. Notificación omitida.');
    return;
  }

  const fields = [];
  if (extraFields) {
    for (const key in extraFields) {
      fields.push({ name: key, value: String(extraFields[key]), inline: true });
    }
  }

  const payload = {
    username: 'AVECO Bancos 🏦',
    embeds: [{
      title,
      description: '```\n' + description + '\n```',
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: config.projectLabel + ' • Google Apps Script' }
    }]
  };

  try {
    const response = UrlFetchApp.fetch(config.discordWebhookUrl, {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code !== 200 && code !== 204) {
      Logger.log('Respuesta inesperada Discord: ' + code + ' → ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('Error enviando a Discord: ' + e.message);
  }
}


// ============================================================
// SECCIÓN 7 — GESTIÓN DEL TRIGGER
// ============================================================

/**
 * Instala el trigger diario para runDailySync().
 * Ejecutar UNA VEZ manualmente desde el editor.
 * Horario: entre 06:00 y 07:00 hora Ciudad de México (GMT-6).
 */
function installDailyTrigger() {
  // Eliminar triggers previos del mismo nombre para evitar duplicados
  removeDailyTrigger();

  ScriptApp.newTrigger('runDailySync')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone('America/Mexico_City')
    .create();

  Logger.log('✅ Trigger diario instalado: runDailySync() → 06:00 América/Ciudad de México');
}

/**
 * Elimina todos los triggers apuntando a runDailySync().
 * Ejecutar para desactivar el robot.
 */
function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed    = 0;

  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'runDailySync') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }

  Logger.log('Triggers eliminados: ' + removed);
}


// ============================================================
// SECCIÓN 8 — FUNCIONES DE PRUEBA MANUAL
// ============================================================

/** Ejecuta el ciclo completo igual que el trigger (sin alterar trigger) */
function testRunDailySync() {
  runDailySync();
}

/** Prueba solo la importación */
function testImportBankMovements() {
  const result = importAllBankMovements_();
  Logger.log('Resultado importación: ' + JSON.stringify(result));
}

/** Prueba solo la deduplicación */
function testDetectAndRemoveDuplicates() {
  const result = detectAndRemoveDuplicates_();
  Logger.log('Resultado deduplicación: ' + JSON.stringify(result));
}

/** Verifica que el trigger esté correctamente instalado */
function testCheckTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const daily    = triggers.filter(t => t.getHandlerFunction() === 'runDailySync');

  if (daily.length === 0) {
    Logger.log('⚠️  No hay trigger instalado para runDailySync. Ejecutar installDailyTrigger().');
  } else {
    Logger.log('✅ Trigger activo: ' + daily.length + ' instancia(s) de runDailySync');
  }
}

/** Prueba de notificación Discord */
function testDiscordNotification() {
  notifyDiscordSuccess_(
    'Prueba AVECO Bancos ✅',
    'Webhook configurado correctamente.',
    {
      entorno: Session.getActiveUser().getEmail(),
      fecha:   Utilities.formatDate(new Date(), 'GMT-6', 'dd/MM/yyyy HH:mm')
    }
  );
}
