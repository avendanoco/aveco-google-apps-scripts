/**
 * ============================================================
 * AVECO Robot Movimientos Bancarios - Importador
 * ============================================================
 * Proyecto   : AVECO Robot Movimientos Bancarios
 * Versión    : 2.1.0
 * Cuenta GWS : aveco.bancos@aveco.mx
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-27
 *
 * Descripción:
 * Importa movimientos bancarios desde carpetas de Drive por banco
 * hacia la hoja MOVIMIENTOS_BANCARIOS_RAW. Soporta Google Sheets,
 * CSV, TXT y XML (parser base). Aplica mapeos por banco y envía
 * notificaciones operativas a Discord.
 *
 * CONFIGURACIÓN INICIAL:
 * 1. Configurar en Script Properties (ver Code.gs):
 *    - SPREADSHEET_ID
 *    - BANCOS_FOLDER_ID
 *    - DISCORD_WEBHOOK_URL
 * 2. Crear hojas en el spreadsheet:
 *    - MOVIMIENTOS_BANCARIOS_RAW
 *    - MOVIMIENTOS_BANCARIOS
 * ============================================================
 */

/**
 * ========== CONFIGURACIÓN DE MAPEOS POR BANCO ==========
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

/**
 * Función principal que importa todos los movimientos bancarios
 * @returns {Object} Resultado de la operación
 */
function importAllBankMovements() {
  try {
    const config = getConfig();
    const ss = SpreadsheetApp.openById(config.spreadsheetId);
    const sheetRaw = ss.getSheetByName('MOVIMIENTOS_BANCARIOS_RAW');
    const sheetClean = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');

    if (!sheetRaw || !sheetClean) {
      throw new Error('Las sheets MOVIMIENTOS_BANCARIOS_RAW y MOVIMIENTOS_BANCARIOS no existen');
    }

    const lastRowRaw = sheetRaw.getLastRow();
    const lastRowClean = sheetClean.getLastRow();
    if (lastRowRaw > 1) sheetRaw.deleteRows(2, lastRowRaw - 1);
    if (lastRowClean > 1) sheetClean.deleteRows(2, lastRowClean - 1);

    const parentFolder = DriveApp.getFolderById(config.bancosFolderId);
    const subfolders = parentFolder.getFolders();
    const bancoFolders = {};

    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const folderName = folder.getName().toUpperCase();
      bancoFolders[folderName] = folder.getId();
      Logger.log('Carpeta detectada: ' + folderName + ' (ID: ' + folder.getId() + ')');
    }

    let totalMovimientos = 0;
    const movimientosPorBanco = {};

    for (const bancoName in bancoFolders) {
      if (BANK_CONFIG[bancoName]) {
        Logger.log('Procesando banco: ' + bancoName);
        const movs = processBankFolder_(bancoFolders[bancoName], bancoName);
        movimientosPorBanco[bancoName] = movs.length;
        totalMovimientos += movs.length;
        if (movs.length > 0) writeToSheet_(sheetRaw, movs);
      } else {
        Logger.log('AVISO: Banco ' + bancoName + ' sin configuración. Se omitirá.');
      }
    }

    let resumen = 'Total movimientos importados: ' + totalMovimientos + '\n\n';
    for (const banco in movimientosPorBanco) {
      resumen += banco + ': ' + movimientosPorBanco[banco] + ' movimientos\n';
    }

    if (totalMovimientos > 0) {
      notifyDiscordSuccess_('Importación completada ✅', resumen, {
        totalMovimientos: String(totalMovimientos),
        bancosProcesados: Object.keys(movimientosPorBanco).length.toString()
      });
    } else {
      notifyDiscordWarning_(
        'Importación sin datos ⚠️',
        'No se encontraron nuevos movimientos bancarios.\n\nCarpetas detectadas:\n' +
          JSON.stringify(Object.keys(bancoFolders), null, 2),
        { totalMovimientos: '0', carpetasDetectadas: Object.keys(bancoFolders).length.toString() }
      );
    }

    return { success: true, totalMovimientos: totalMovimientos };

  } catch (error) {
    Logger.log('Error en importAllBankMovements: ' + error.toString());
    notifyDiscordError_(
      'ERROR en importación 🚨',
      'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || '')
    );
    return { success: false, error: error.toString() };
  }
}

/**
 * Procesa archivos de una carpeta de banco
 * @param {string} folderId
 * @param {string} bancoName
 * @returns {Array<Array>}
 */
function processBankFolder_(folderId, bancoName) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const movimientos = [];
  const configBanco = BANK_CONFIG[bancoName];

  while (files.hasNext()) {
    const file = files.next();
    try {
      const data = readFileUniversal_(file, bancoName);
      if (!data || data.length <= 1) {
        Logger.log('Archivo vacío o sin datos: ' + file.getName());
        continue;
      }

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue;

        const fechaRaw = row[configBanco.columnMap.fecha] || '';
        let fechaFinal = fechaRaw;
        if (configBanco.dateFormat === 'MM-DD-YYYY' && fechaRaw) {
          const partes = String(fechaRaw).split('-');
          if (partes.length === 3) fechaFinal = partes[1] + '-' + partes[0] + '-' + partes[2];
        }

        const descripcion = row[configBanco.columnMap.descripcion] || '';
        const cargo       = row[configBanco.columnMap.cargo] || '0';
        const abono       = row[configBanco.columnMap.abono] || '0';
        const saldo       = configBanco.columnMap.saldo >= 0 ? (row[configBanco.columnMap.saldo] || '0') : '0';
        const referencia  = configBanco.columnMap.referencia >= 0 ? (row[configBanco.columnMap.referencia] || '') : '';

        movimientos.push([
          bancoName, fechaFinal, descripcion, referencia,
          cargo, abono, saldo,
          '', '', '',
          file.getName()
        ]);
      }

      Logger.log('Procesados ' + (data.length - 1) + ' registros de ' + file.getName());
    } catch (e) {
      Logger.log('Error procesando archivo ' + file.getName() + ': ' + e.toString());
    }
  }

  return movimientos;
}

/**
 * Lee archivo de manera universal (Google Sheets, CSV, TXT, XML)
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
      const useTSV = bancoName && BANK_CONFIG[bancoName] && BANK_CONFIG[bancoName].useTSV;
      return content.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => useTSV ? line.split('\t') : parseCSVLine_(line));
    }

    if (mimeType === 'text/xml' || mimeType === 'application/xml' || fileName.endsWith('.xml')) {
      return parseXMLToArray_(file.getBlob().getDataAsString('UTF-8'));
    }

    Logger.log('Tipo no soportado: ' + mimeType + ' para ' + file.getName());
    return [];
  } catch (e) {
    Logger.log('Error leyendo archivo ' + file.getName() + ': ' + e.toString());
    return [];
  }
}

/**
 * Parser XML base (pendiente implementación específica por banco)
 * @param {string} xmlContent
 * @returns {Array<Array>}
 */
function parseXMLToArray_(xmlContent) {
  try {
    XmlService.parse(xmlContent);
    Logger.log('Parser XML base: implementación específica pendiente');
  } catch (e) {
    Logger.log('Error parseando XML: ' + e.toString());
  }
  return [];
}

/**
 * Escribe movimientos a la hoja destino en un solo batch
 * @param {Sheet} sheet
 * @param {Array<Array>} movimientos
 */
function writeToSheet_(sheet, movimientos) {
  if (!movimientos || movimientos.length === 0) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, movimientos.length, 11).setValues(movimientos);
}

/**
 * Parsea una línea CSV manejando comillas y comas
 * @param {string} line
 * @returns {Array<string>}
 */
function parseCSVLine_(line) {
  const fields = [];
  let current = '';
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
 * ============================================================
 * NOTIFICACIONES DISCORD (ESTÁNDAR AVECO)
 * ============================================================
 */

function notifyDiscordSuccess_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 5793266, extraFields);
}

function notifyDiscordWarning_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 16776960, extraFields);
}

function notifyDiscordError_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, 15548997, extraFields);
}

/**
 * Envío genérico de embed a Discord via Webhook
 * @param {string} title
 * @param {string} description
 * @param {number} color
 * @param {Object} extraFields
 */
function sendDiscordEmbed_(title, description, color, extraFields) {
  const config = getConfig();
  if (!config.discordWebhookUrl) {
    Logger.log('DISCORD_WEBHOOK_URL no configurado, se omite notificación.');
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
      title: title,
      description: '```\n' + description + '\n```',
      color: color,
      fields: fields,
      timestamp: new Date().toISOString(),
      footer: { text: config.projectLabel + ' • Google Apps Script' }
    }]
  };

  try {
    const response = UrlFetchApp.fetch(config.discordWebhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200 && code !== 204) {
      Logger.log('Respuesta inesperada Discord: ' + code + ' - ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('Error enviando notificación a Discord: ' + e.message);
  }
}

/**
 * Prueba de notificación Discord (ejecutar manualmente)
 */
function testDiscordNotification() {
  notifyDiscordSuccess_(
    'Prueba AVECO Bancos ✅',
    'Notificación de prueba.\nWebhook configurado correctamente.',
    { entorno: Session.getActiveUser().getEmail(), fecha: new Date().toISOString() }
  );
}
