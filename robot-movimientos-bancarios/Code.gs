/**
 * ============================================================
 * AVECO Robot Movimientos Bancarios - Core
 * ============================================================
 * Proyecto   : AVECO Robot Movimientos Bancarios
 * Versión    : 2.1.0
 * Cuenta GWS : antonio.ac@aveco.mx
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-27
 *
 * Descripción:
 * Núcleo del robot de movimientos bancarios:
 * - Configuración centralizada vía Script Properties
 * - Endpoint HTTP para n8n (doPost)
 * - Helpers de respuesta y logging
 *
 * CONFIGURACIÓN INICIAL (Script Properties):
 *   SPREADSHEET_ID        -> ID del archivo de Google Sheets
 *   BANCOS_FOLDER_ID      -> ID de la carpeta padre de bancos en Drive
 *   DISCORD_WEBHOOK_URL   -> Webhook de Discord (opcional pero recomendado)
 *
 * NOTAS:
 * - No se deben dejar IDs ni correos sensibles hardcodeados.
 * - Este archivo no contiene lógica de negocio de bancos; esa
 *   vive en ImportBancos.gs y Deduplication.gs.
 * ============================================================
 */

/**
 * Configuración centralizada del proyecto
 * Lee los valores desde Script Properties
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  const bancosFolderId = props.getProperty('BANCOS_FOLDER_ID');
  const discordWebhookUrl = props.getProperty('DISCORD_WEBHOOK_URL') || '';

  if (!spreadsheetId) {
    throw new Error('Falta configurar SPREADSHEET_ID en Script Properties');
  }

  if (!bancosFolderId) {
    throw new Error('Falta configurar BANCOS_FOLDER_ID en Script Properties');
  }

  return {
    spreadsheetId: spreadsheetId,
    bancosFolderId: bancosFolderId,
    discordWebhookUrl: discordWebhookUrl,
    projectLabel: 'AVECO Robot Movimientos Bancarios'
  };
}

/**
 * Endpoint HTTP para n8n
 * Router que dirige las peticiones a las funciones correspondientes
 *
 * Ejemplo de payload:
 * {
 *   "action": "importBancos"
 * }
 */
function doPost(e) {
  const startedAt = new Date();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return buildJsonResponse_({
        success: false,
        message: 'Sin contenido en la petición'
      });
    }

    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    switch (action) {
      case 'importBancos':
        result = importAllBankMovements();
        break;

      case 'detectDuplicates':
        result = detectAndRemoveDuplicates();
        break;

      default:
        result = {
          success: false,
          message: 'Acción no reconocida: ' + action
        };
        break;
    }

    const durationMs = new Date().getTime() - startedAt.getTime();
    const normalized = result || { success: true, message: 'Operación completada' };
    normalized.action = action;
    normalized.durationMs = durationMs;

    return buildJsonResponse_(normalized);

  } catch (error) {
    Logger.log('Error en doPost: ' + error.toString());

    try {
      notifyDiscordError_(
        'ERROR en endpoint n8n 🚨',
        'Error en doPost: ' + error.toString() + '\n\nStack: ' + (error.stack || '')
      );
    } catch (notifyError) {
      Logger.log('Error notificando a Discord desde doPost: ' + notifyError);
    }

    return buildJsonResponse_({
      success: false,
      error: error.toString(),
      line: error.lineNumber || null
    });
  }
}

/**
 * Construye una respuesta JSON estándar para doPost
 * @param {Object} payload
 * @returns {TextOutput}
 */
function buildJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Prueba del endpoint simulando llamada de n8n - acción importBancos
 */
function testDoPostImportBancos() {
  const fakeEvent = {
    postData: { contents: JSON.stringify({ action: 'importBancos' }) }
  };
  const response = doPost(fakeEvent);
  Logger.log('Respuesta test importBancos: ' + response.getContent());
}

/**
 * Prueba del endpoint simulando llamada de n8n - acción detectDuplicates
 */
function testDoPostDetectDuplicates() {
  const fakeEvent = {
    postData: { contents: JSON.stringify({ action: 'detectDuplicates' }) }
  };
  const response = doPost(fakeEvent);
  Logger.log('Respuesta test detectDuplicates: ' + response.getContent());
}
