/**
 * ============================================================
 * AVECO Robot Movimientos Bancarios - Deduplicación
 * ============================================================
 * Proyecto   : AVECO Robot Movimientos Bancarios
 * Versión    : 2.1.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-27
 *
 * Descripción:
 * Lógica para detectar y eliminar movimientos bancarios duplicados
 * en la hoja MOVIMIENTOS_BANCARIOS.
 *
 * Criterio de duplicado:
 *   Banco + Fecha normalizada + Cargo + Abono + Referencia
 *
 * Uso:
 *   - Manual: ejecutar detectAndRemoveDuplicates()
 *   - Automático: vía doPost (action = "detectDuplicates")
 * ============================================================
 */

/**
 * Detecta y elimina duplicados en MOVIMIENTOS_BANCARIOS
 * @returns {Object} Resultado del proceso
 */
function detectAndRemoveDuplicates() {
  const startedAt = new Date();

  try {
    const config = getConfig();
    const ss = SpreadsheetApp.openById(config.spreadsheetId);
    const sheet = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');

    if (!sheet) {
      throw new Error('Sheet MOVIMIENTOS_BANCARIOS no existe');
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, duplicatesRemoved: 0, message: 'No hay datos para procesar' };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const seen = new Set();
    const rowsToDelete = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const key = row[0] + '|' +
        normalizeDateForKey_(row[1]) + '|' +
        row[4] + '|' +
        row[5] + '|' +
        row[3];

      if (seen.has(key)) {
        rowsToDelete.push(i + 2);
      } else {
        seen.add(key);
      }
    }

    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    return {
      success: true,
      duplicatesRemoved: rowsToDelete.length,
      processedRows: data.length,
      durationMs: new Date().getTime() - startedAt.getTime()
    };

  } catch (error) {
    Logger.log('Error en detectAndRemoveDuplicates: ' + error.toString());
    try {
      notifyDiscordError_(
        'ERROR en deduplicación 🚨',
        'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || '')
      );
    } catch (notifyError) {
      Logger.log('Error notificando Discord desde Deduplication: ' + notifyError);
    }
    return { success: false, error: error.toString() };
  }
}

/**
 * Normaliza fecha para key de duplicados → yyyy-MM-dd
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

  for (let i = 0; i < formats.length; i++) {
    const match = dateStr.match(formats[i]);
    if (match) {
      if (match[1].length === 4) return dateStr;
      return match[3] + '-' + match[2] + '-' + match[1];
    }
  }

  return dateStr;
}

/**
 * Prueba manual de deduplicación
 */
function testDetectAndRemoveDuplicates() {
  const result = detectAndRemoveDuplicates();
  Logger.log('Resultado deduplicación: ' + JSON.stringify(result));
}
