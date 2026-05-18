/**
 * ============================================================
 * MONITOR DE CARPETA GOOGLE DRIVE → DISCORD
 * ============================================================
 * Proyecto   : AM10 CATALINA – AVECO
 * Versión    : 2.0.0
 * Cuenta GWS : jose.avendanoco@gmail.com   ← cuenta propietaria del script
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2025
 *
 * Descripción:
 *   Monitorea una carpeta de Google Drive y envía una
 *   notificación enriquecida (embed) a Discord vía Webhook
 *   cada vez que se detectan archivos nuevos.
 *
 * CONFIGURACIÓN INICIAL:
 *   1. Crea un Webhook en tu canal de Discord:
 *      Canal → Configuración → Integraciones → Webhooks → Crear
 *   2. Guarda las credenciales en Script Properties (recomendado):
 *      Proyecto → Configuración del proyecto → Propiedades del script
 *      Clave: DISCORD_WEBHOOK_URL  Valor: https://discord.com/api/webhooks/...
 *      Clave: DRIVE_FOLDER_ID      Valor: 1JSxboom...
 *      Clave: FOLDER_LABEL         Valor: AM10 CATALINA
 *   3. Crea un Trigger de tiempo (cada 5 o 10 min):
 *      Menú → Activadores → + Agregar activador
 *      Función: checkFolderAndNotify | Basado en tiempo | Cada 5 minutos
 *
 * NOTAS DE SEGURIDAD:
 *   - NUNCA guardes el Webhook URL directamente en el código
 *     si compartes el script. Usa Script Properties.
 *   - El fallback hardcodeado en getConfig() es solo para desarrollo
 *     local. Elimínalo antes de compartir o hacer commit del archivo.
 * ============================================================
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────
// Se leen desde Script Properties para mayor seguridad.
// Fallback hardcodeado SOLO para desarrollo — eliminar en producción.
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    folderId   : props.getProperty('DRIVE_FOLDER_ID')     || 'TU_FOLDER_ID_AQUI',
    webhookUrl : props.getProperty('DISCORD_WEBHOOK_URL') || 'PEGA_AQUI_TU_WEBHOOK_DE_DISCORD',
    folderLabel: props.getProperty('FOLDER_LABEL')        || 'AM10 CATALINA',
    embedColor : 5793266, // Verde Discord: 0x57F287
  };
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────
/**
 * Revisa si hay archivos nuevos en la carpeta configurada
 * y envía un embed a Discord si los hay.
 * Diseñada para ejecutarse via Trigger cada 5–10 minutos.
 */
function checkFolderAndNotify() {
  const config = getConfig();
  const props  = PropertiesService.getScriptProperties();

  // Recuperar timestamp del último chequeo (o hace 30 min si es primera ejecución)
  const lastCheckStr = props.getProperty('lastCheck');
  const lastCheck    = lastCheckStr ? new Date(lastCheckStr) : new Date(Date.now() - 30 * 60 * 1000);
  const now          = new Date();

  // Actualizar timestamp ANTES de escanear para evitar duplicados en caso de error
  props.setProperty('lastCheck', now.toISOString());

  // Escanear archivos de la carpeta
  let folder;
  try {
    folder = DriveApp.getFolderById(config.folderId);
  } catch (e) {
    Logger.log('❌ Error al acceder a la carpeta: ' + e.message);
    return;
  }

  const files    = folder.getFiles();
  const newFiles = [];

  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() > lastCheck) {
      newFiles.push({
        name: file.getName(),
        url : file.getUrl(),
        type: file.getMimeType(),
        size: formatBytes_(file.getSize()),
      });
    }
  }

  if (newFiles.length === 0) {
    Logger.log('✅ Sin archivos nuevos desde ' + lastCheck.toLocaleString('es-MX'));
    return;
  }

  // Construir y enviar el embed a Discord
  const sent = sendDiscordEmbed_(config, newFiles, lastCheck);
  if (sent) {
    Logger.log('📨 Notificación enviada a Discord: ' + newFiles.length + ' archivo(s)');
  }
}

// ─── ENVIAR EMBED A DISCORD ───────────────────────────────────
/**
 * Envía un embed enriquecido al canal de Discord via Webhook.
 * @param {Object} config  - Configuración del script
 * @param {Array}  files   - Archivos nuevos detectados
 * @param {Date}   since   - Fecha del último chequeo
 * @returns {boolean} true si el envío fue exitoso
 */
function sendDiscordEmbed_(config, files, since) {
  const maxShow   = 10;
  const shown     = files.slice(0, maxShow);
  const remaining = files.length - maxShow;

  const fileLines = shown.map((f, i) =>
    '\`' + (i + 1) + '.\` [' + f.name + '](' + f.url + ') — ' + f.size
  ).join('\n');

  const description = remaining > 0
    ? fileLines + '\n_...y ' + remaining + ' archivo(s) más_'
    : fileLines;

  const embed = {
    title      : '📁 Nuevos archivos detectados',
    description: description,
    color      : config.embedColor,
    fields     : [
      { name: '📂 Carpeta', value: config.folderLabel,               inline: true  },
      { name: '📊 Total',   value: files.length + ' archivo(s)',     inline: true  },
      { name: '🕐 Desde',   value: since.toLocaleString('es-MX'),    inline: false },
    ],
    footer    : { text: 'AVECO • Monitor de Drive' },
    timestamp : new Date().toISOString(),
  };

  const payload = JSON.stringify({
    username  : 'AVECO Drive Bot',
    avatar_url: 'https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
    embeds    : [embed],
  });

  const options = {
    method            : 'post',
    contentType       : 'application/json',
    payload           : payload,
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(config.webhookUrl, options);
    const code     = response.getResponseCode();

    if (code === 204 || code === 200) {
      return true;
    } else {
      Logger.log('⚠️ Discord respondió con código ' + code + ': ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('❌ Error al enviar a Discord: ' + e.message);
    return false;
  }
}

// ─── UTILIDADES ───────────────────────────────────────────────
/**
 * Convierte bytes a formato legible (KB, MB, etc.)
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes_(bytes) {
  if (!bytes || bytes === 0) return '—';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Función de prueba manual — ejecutar desde el editor para verificar
 * que el Webhook y la carpeta están correctamente configurados.
 * NO usar como trigger automático.
 */
function testNotification() {
  const config    = getConfig();
  const testFiles = [
    { name: 'planos_v3.pdf',         url: 'https://drive.google.com', type: 'application/pdf',             size: '2.4 MB' },
    { name: 'presupuesto_final.xlsx', url: 'https://drive.google.com', type: 'application/vnd.ms-excel',   size: '540 KB' },
  ];

  Logger.log('🧪 Enviando notificación de prueba a Discord...');
  const sent = sendDiscordEmbed_(config, testFiles, new Date(Date.now() - 10 * 60 * 1000));
  Logger.log(sent ? '✅ Prueba exitosa' : '❌ Prueba fallida — revisa el Webhook URL y los logs');
}
