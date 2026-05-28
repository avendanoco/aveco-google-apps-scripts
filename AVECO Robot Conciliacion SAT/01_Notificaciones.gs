/**
 * ============================================================
 * AVECO Robot Financiero — Notificaciones Discord
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.0.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-28
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Módulo ÚNICO de notificaciones operativas por Discord vía WEBHOOK.
 *   Según los lineamientos de AVECO, las alertas de procesos usan
 *   Webhook (no Bot Token). El Bot Token queda reservado para Charly,
 *   que necesita leer y responder en el canal (ver 05_Charly.gs).
 *
 *   Todos los módulos (Importador, Renombrador, DataLake, Charly)
 *   llaman a estos helpers en lugar de definir su propio envío.
 *
 * CONFIGURACIÓN:
 *   DISCORD_WEBHOOK_URL → en Script Properties (ver 00_Config.gs)
 *
 * NOTAS:
 *   - Si no hay webhook configurado, se registra en Logger y se omite
 *     el envío (no se rompe el flujo principal).
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — COLORES ESTÁNDAR (paleta AVECO para embeds)
// ============================================================

const DISCORD_COLOR = {
  SUCCESS: 5793266,    // Verde
  WARNING: 16776960,   // Amarillo
  ERROR:   15548997,   // Rojo
  INFO:    5814783,    // Azul Discord
};


// ============================================================
// SECCIÓN 2 — HELPERS DE ALTO NIVEL (éxito / aviso / error)
// ============================================================

/**
 * Notificación de éxito (verde).
 * @param {string} title
 * @param {string} description
 * @param {Object=} extraFields Campos clave→valor mostrados en línea.
 */
function notifyDiscordSuccess_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, DISCORD_COLOR.SUCCESS, extraFields);
}

/**
 * Notificación de advertencia (amarillo).
 * @param {string} title
 * @param {string} description
 * @param {Object=} extraFields
 */
function notifyDiscordWarning_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, DISCORD_COLOR.WARNING, extraFields);
}

/**
 * Notificación de error (rojo).
 * @param {string} title
 * @param {string} description
 * @param {Object=} extraFields
 */
function notifyDiscordError_(title, description, extraFields) {
  sendDiscordEmbed_(title, description, DISCORD_COLOR.ERROR, extraFields);
}


// ============================================================
// SECCIÓN 3 — ENVÍO GENÉRICO POR WEBHOOK
// ============================================================

/**
 * Envío genérico de embed a Discord vía Webhook.
 * Es el único punto de salida hacia el webhook en todo el proyecto.
 * @param {string} title
 * @param {string} description
 * @param {number} color  Entero de color Discord (ver DISCORD_COLOR).
 * @param {Object=} extraFields  Objeto plano clave→valor para fields inline.
 * @returns {boolean} true si el envío fue aceptado por Discord.
 */
function sendDiscordEmbed_(title, description, color, extraFields) {
  const cfg = getConfig();

  if (!cfg.DISCORD_WEBHOOK_URL) {
    Logger.log('DISCORD_WEBHOOK_URL no configurado. Notificación omitida: ' + title);
    return false;
  }

  const fields = [];
  if (extraFields) {
    for (const key in extraFields) {
      fields.push({ name: key, value: String(extraFields[key]), inline: true });
    }
  }

  const payload = {
    username: cfg.PROJECT_LABEL,
    embeds: [{
      title:       String(title || '').substring(0, 256),
      description: '```\n' + String(description || '').substring(0, 3900) + '\n```',
      color:       color || DISCORD_COLOR.INFO,
      fields:      fields.slice(0, 25),
      timestamp:   new Date().toISOString(),
      footer:      { text: cfg.PROJECT_LABEL + ' • Google Apps Script v' + cfg.VERSION },
    }],
  };

  try {
    const response = UrlFetchApp.fetch(cfg.DISCORD_WEBHOOK_URL, {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200 && code !== 204) {
      Logger.log('Respuesta inesperada de Discord: ' + code + ' → ' + response.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    Logger.log('Error enviando a Discord: ' + e.message);
    return false;
  }
}

/**
 * Alias de compatibilidad usado por módulos que envían embeds simples
 * (DataLake y el fallback de Charly). Firma: (title, description, color).
 * @param {string} title
 * @param {string} description
 * @param {number=} color
 */
function sendDiscordNotification_(title, description, color) {
  sendDiscordEmbed_(title, description, color || DISCORD_COLOR.SUCCESS);
}


// ============================================================
// SECCIÓN 4 — FUNCIÓN DE PRUEBA MANUAL
// ============================================================

/**
 * Prueba de notificación Discord (única en todo el proyecto).
 * Ejecutar manualmente desde el editor para validar el webhook.
 */
function testDiscordNotification() {
  notifyDiscordSuccess_(
    'Prueba AVECO Robot Financiero ✅',
    'Webhook configurado correctamente.',
    {
      cuenta: Session.getActiveUser().getEmail(),
      fecha:  Utilities.formatDate(new Date(), getConfig().TIMEZONE, 'dd/MM/yyyy HH:mm'),
    }
  );
  Logger.log('Notificación de prueba enviada (revisa Discord).');
}
