/**
 * ============================================================
 * AVECO Renombrador de Movimientos (SAT, Bancarios, Wallet)
 * ============================================================
 * Proyecto   : AVECO Robot Movimientos Bancarios
 * Versión    : 2.0.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Renombra archivos de movimientos en tres carpetas de Drive
 *   extrayendo el rango de fechas desde el contenido del archivo.
 *
 *   Módulos incluidos:
 *   • MOV SAT      → Google Docs y CSV/TXT, formato: MOV-SAT-YY-MM-DD-YY-MM-DD
 *   • MOV BANCARIOS → CSVs en subcarpetas por banco, formato: BANCO-YY-MM-DD-YY-MM-DD.csv
 *   • MOV WALLET   → CSVs directamente en carpeta raíz, formato: WALLET-YY-MM-DD-YY-MM-DD.csv
 *
 * TRIGGER:
 *   - Ejecución manual o bajo demanda.
 *   - Función principal: renombrarTodo()
 *   - No requiere trigger de tiempo automático por su naturaleza puntual.
 *
 * CONFIGURACIÓN INICIAL (Script Properties):
 *   FOLDER_SAT_ID        → ID de la carpeta de archivos MOV SAT
 *   FOLDER_BANCARIOS_ID  → ID de la carpeta raíz de MOV Bancarios (contiene subcarpetas)
 *   FOLDER_WALLET_ID     → ID de la carpeta de MOV Wallet
 *   DISCORD_WEBHOOK_URL  → Webhook de Discord (opcional pero recomendado)
 *
 * FORMATOS DE FECHA SOPORTADOS EN CONTENIDO:
 *   DD/MM/YYYY · YYYY-MM-DD · DD-MM-YYYY · DDMMYYYY' (formato Santander)
 *
 * NOTAS DE SEGURIDAD:
 *   - No guardar IDs de carpetas ni secretos en este archivo.
 *   - Usar exclusivamente Script Properties para IDs y credenciales.
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — CONFIGURACIÓN
// ============================================================

/**
 * Configuración centralizada del proyecto.
 * @returns {Object}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const folderSatId       = props.getProperty('FOLDER_SAT_ID');
  const folderBancariosId = props.getProperty('FOLDER_BANCARIOS_ID');
  const folderWalletId    = props.getProperty('FOLDER_WALLET_ID');
  const discordWebhookUrl = props.getProperty('DISCORD_WEBHOOK_URL') || '';

  if (!folderSatId)       throw new Error('Falta configurar FOLDER_SAT_ID en Script Properties');
  if (!folderBancariosId) throw new Error('Falta configurar FOLDER_BANCARIOS_ID en Script Properties');
  if (!folderWalletId)    throw new Error('Falta configurar FOLDER_WALLET_ID en Script Properties');

  return {
    folderSatId,
    folderBancariosId,
    folderWalletId,
    discordWebhookUrl,
    projectLabel: 'AVECO Renombrador de Movimientos'
  };
}


// ============================================================
// SECCIÓN 2 — FUNCIÓN PRINCIPAL
// ============================================================

/**
 * Ejecuta el renombrado de los tres módulos en secuencia.
 * Esta es la función para ejecutar manualmente o como trigger puntual.
 */
function renombrarTodo() {
  const startedAt = new Date();
  Logger.log('=== renombrarTodo iniciado: ' + startedAt.toISOString() + ' ===');

  const resumenGlobal = {
    sat:       { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 },
    bancarios: { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 },
    wallet:    { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 }
  };

  try {
    resumenGlobal.sat       = renombrarMovSat_();
    resumenGlobal.bancarios = renombrarMovBancarios_();
    resumenGlobal.wallet    = renombrarMovWallet_();

    const durationMs = new Date().getTime() - startedAt.getTime();

    const descripcion =
      'SAT       → OK: ' + resumenGlobal.sat.ok       + ' | Sin cambio: ' + resumenGlobal.sat.sinCambio       + ' | Sin fechas: ' + resumenGlobal.sat.sinFechas       + ' | Errores: ' + resumenGlobal.sat.errores       + '\n' +
      'Bancarios → OK: ' + resumenGlobal.bancarios.ok + ' | Sin cambio: ' + resumenGlobal.bancarios.sinCambio + ' | Sin fechas: ' + resumenGlobal.bancarios.sinFechas + ' | Errores: ' + resumenGlobal.bancarios.errores + '\n' +
      'Wallet    → OK: ' + resumenGlobal.wallet.ok    + ' | Sin cambio: ' + resumenGlobal.wallet.sinCambio    + ' | Sin fechas: ' + resumenGlobal.wallet.sinFechas    + ' | Errores: ' + resumenGlobal.wallet.errores;

    notifyDiscordSuccess_('Renombrado completado ✅', descripcion, {
      totalRenombrados: String(resumenGlobal.sat.ok + resumenGlobal.bancarios.ok + resumenGlobal.wallet.ok),
      duracion:         durationMs + ' ms',
      fecha:            Utilities.formatDate(startedAt, 'GMT-6', 'dd/MM/yyyy HH:mm')
    });

    Logger.log('renombrarTodo completado en ' + durationMs + ' ms');

  } catch (error) {
    Logger.log('Error en renombrarTodo: ' + error.toString());
    notifyDiscordError_(
      'ERROR en renombrado 🚨',
      'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || '')
    );
  }
}


// ============================================================
// SECCIÓN 3 — MÓDULOS DE RENOMBRADO
// ============================================================

/**
 * Renombra archivos MOV SAT (Google Docs y CSV/TXT).
 * Formato destino: MOV-SAT-YY-MM-DD-YY-MM-DD[sufijo]
 * @returns {Object} Contadores { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovSat_() {
  const config  = getConfig();
  const folder  = DriveApp.getFolderById(config.folderSatId);
  const files   = folder.getFiles();
  const counter = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV SAT: ' + folder.getName() + ' ---');

  while (files.hasNext()) {
    const file        = files.next();
    const nombreActual = file.getName();
    const mimeType    = file.getMimeType();

    try {
      const todasFechas = obtenerFechasDeArchivo_(file, mimeType);

      if (todasFechas.length === 0) {
        Logger.log('SIN FECHAS: ' + nombreActual);
        counter.sinFechas++;
        continue;
      }

      todasFechas.sort((a, b) => a - b);
      const sufijo     = mimeType === MimeType.GOOGLE_DOCS ? ' (doc)' : '';
      const nuevoNombre = 'MOV-SAT-' +
        formatYYMMDD_(todasFechas[todasFechas.length - 1]) + '-' +
        formatYYMMDD_(todasFechas[0]) + sufijo;

      if (nombreActual === nuevoNombre) {
        Logger.log('SIN CAMBIO: ' + nombreActual);
        counter.sinCambio++;
        continue;
      }

      file.setName(nuevoNombre);
      Logger.log('OK: "' + nombreActual + '" → "' + nuevoNombre + '"');
      counter.ok++;

    } catch (e) {
      Logger.log('ERROR: "' + nombreActual + '" - ' + e.message);
      counter.errores++;
    }
  }

  Logger.log('MOV SAT finalizado: ' + JSON.stringify(counter));
  return counter;
}

/**
 * Renombra CSVs de subcarpetas de MOV Bancarios.
 * Formato destino: NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
 * @returns {Object} Contadores { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovBancarios_() {
  const config     = getConfig();
  const rootFolder = DriveApp.getFolderById(config.folderBancariosId);
  const subFolders = rootFolder.getFolders();
  const counter    = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV BANCARIOS: ' + rootFolder.getName() + ' ---');

  while (subFolders.hasNext()) {
    const subFolder    = subFolders.next();
    const nombreCarpeta = subFolder.getName();
    const files        = subFolder.getFiles();

    Logger.log('Subcarpeta: ' + nombreCarpeta);

    while (files.hasNext()) {
      const file        = files.next();
      const nombreActual = file.getName();
      const mimeType    = file.getMimeType();

      if (!esArchivoCSV_(file)) {
        Logger.log('  Omitiendo: ' + nombreActual + ' (' + mimeType + ')');
        continue;
      }

      try {
        const contenido   = file.getBlob().getDataAsString();
        const todasFechas = extraerFechasDeContenido_(contenido);

        if (todasFechas.length === 0) {
          Logger.log('  SIN FECHAS: ' + nombreActual);
          counter.sinFechas++;
          continue;
        }

        todasFechas.sort((a, b) => a - b);
        const nuevoNombre = nombreCarpeta + '-' +
          formatYYMMDD_(todasFechas[todasFechas.length - 1]) + '-' +
          formatYYMMDD_(todasFechas[0]) + '.csv';

        if (nombreActual === nuevoNombre) {
          Logger.log('  SIN CAMBIO: ' + nombreActual);
          counter.sinCambio++;
          continue;
        }

        file.setName(nuevoNombre);
        Logger.log('  OK: "' + nombreActual + '" → "' + nuevoNombre + '"');
        counter.ok++;

      } catch (e) {
        Logger.log('  ERROR: "' + nombreActual + '" - ' + e.message);
        counter.errores++;
      }
    }
  }

  Logger.log('MOV BANCARIOS finalizado: ' + JSON.stringify(counter));
  return counter;
}

/**
 * Renombra CSVs directamente en la carpeta MOV Wallet.
 * Formato destino: NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
 * @returns {Object} Contadores { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovWallet_() {
  const config       = getConfig();
  const folder       = DriveApp.getFolderById(config.folderWalletId);
  const nombreCarpeta = folder.getName();
  const files        = folder.getFiles();
  const counter      = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV WALLET: ' + nombreCarpeta + ' ---');

  while (files.hasNext()) {
    const file        = files.next();
    const nombreActual = file.getName();

    if (!esArchivoCSV_(file)) {
      Logger.log('Omitiendo: ' + nombreActual + ' (' + file.getMimeType() + ')');
      continue;
    }

    try {
      const contenido   = file.getBlob().getDataAsString();

      // Log de primeras 3 líneas útil para detectar formatos nuevos
      const primerasLineas = contenido.split('\n').slice(0, 3).join(' | ');
      Logger.log('Primeras líneas de "' + nombreActual + '": ' + primerasLineas);

      const todasFechas = extraerFechasDeContenido_(contenido);

      if (todasFechas.length === 0) {
        Logger.log('SIN FECHAS: ' + nombreActual);
        counter.sinFechas++;
        continue;
      }

      todasFechas.sort((a, b) => a - b);
      const nuevoNombre = nombreCarpeta + '-' +
        formatYYMMDD_(todasFechas[todasFechas.length - 1]) + '-' +
        formatYYMMDD_(todasFechas[0]) + '.csv';

      if (nombreActual === nuevoNombre) {
        Logger.log('SIN CAMBIO: ' + nombreActual);
        counter.sinCambio++;
        continue;
      }

      file.setName(nuevoNombre);
      Logger.log('OK: "' + nombreActual + '" → "' + nuevoNombre + '"');
      counter.ok++;

    } catch (e) {
      Logger.log('ERROR: "' + nombreActual + '" - ' + e.message);
      counter.errores++;
    }
  }

  Logger.log('MOV WALLET finalizado: ' + JSON.stringify(counter));
  return counter;
}


// ============================================================
// SECCIÓN 4 — UTILIDADES PRIVADAS
// ============================================================

/**
 * Lee el contenido de un archivo y extrae fechas.
 * Soporta Google Docs (texto) y archivos blob (CSV, TXT).
 * @param {File} file
 * @param {string} mimeType
 * @returns {Date[]}
 */
function obtenerFechasDeArchivo_(file, mimeType) {
  try {
    let contenido = '';
    if (mimeType === MimeType.GOOGLE_DOCS) {
      contenido = DocumentApp.openById(file.getId()).getBody().getText();
    } else {
      contenido = file.getBlob().getDataAsString();
    }
    return extraerFechasDeContenido_(contenido);
  } catch (e) {
    Logger.log('Error leyendo "' + file.getName() + '": ' + e.message);
    return [];
  }
}

/**
 * Extrae todas las fechas encontradas en un texto.
 * Formatos soportados:
 *   DD/MM/YYYY · YYYY-MM-DD · DD-MM-YYYY · DDMMYYYY' (Santander)
 * @param {string} contenido
 * @returns {Date[]}
 */
function extraerFechasDeContenido_(contenido) {
  const fechas  = [];
  const patrones = [
    { re: /(\d{2})\/(\d{2})\/(\d{4})/g,  parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
    { re: /(\d{4})-(\d{2})-(\d{2})/g,    parse: m => new Date(+m[1], +m[2] - 1, +m[3]) },
    { re: /(\d{2})-(\d{2})-(\d{4})/g,    parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
    // Formato Santander: DDMMYYYY seguido de comilla simple
    { re: /(\d{2})(\d{2})(\d{4})'/g,     parse: m => new Date(+m[3], +m[2] - 1, +m[1]) }
  ];

  for (const { re, parse } of patrones) {
    let match;
    re.lastIndex = 0; // reset regex stateful
    while ((match = re.exec(contenido)) !== null) {
      const d = parse(match);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        fechas.push(d);
      }
    }
  }

  return fechas;
}

/**
 * Verifica si un archivo es CSV o texto plano procesable.
 * @param {File} file
 * @returns {boolean}
 */
function esArchivoCSV_(file) {
  const mimeType = file.getMimeType();
  const fileName = file.getName().toLowerCase();
  return (
    fileName.endsWith('.csv') ||
    mimeType === 'text/csv'   ||
    mimeType === 'text/plain' ||
    mimeType === 'application/vnd.ms-excel'
  );
}

/**
 * Formatea una fecha como YY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function formatYYMMDD_(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}


// ============================================================
// SECCIÓN 5 — NOTIFICACIONES DISCORD
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
// SECCIÓN 6 — FUNCIONES DE PRUEBA MANUAL
// ============================================================

/** Ejecuta el ciclo completo de renombrado */
function testRenombrarTodo() {
  renombrarTodo();
}

/** Prueba solo el módulo MOV SAT */
function testRenombrarMovSat() {
  const result = renombrarMovSat_();
  Logger.log('MOV SAT: ' + JSON.stringify(result));
}

/** Prueba solo el módulo MOV BANCARIOS */
function testRenombrarMovBancarios() {
  const result = renombrarMovBancarios_();
  Logger.log('MOV BANCARIOS: ' + JSON.stringify(result));
}

/** Prueba solo el módulo MOV WALLET */
function testRenombrarMovWallet() {
  const result = renombrarMovWallet_();
  Logger.log('MOV WALLET: ' + JSON.stringify(result));
}

/** Verifica acceso a las tres carpetas configuradas */
function testDriveAccess() {
  const config = getConfig();
  try {
    Logger.log('SAT:       ' + DriveApp.getFolderById(config.folderSatId).getName());
    Logger.log('BANCARIOS: ' + DriveApp.getFolderById(config.folderBancariosId).getName());
    Logger.log('WALLET:    ' + DriveApp.getFolderById(config.folderWalletId).getName());
    Logger.log('✅ Acceso a las tres carpetas confirmado.');
  } catch (e) {
    Logger.log('❌ Error de acceso a Drive: ' + e.message);
  }
}

/** Prueba de notificación Discord */
function testDiscordNotification() {
  notifyDiscordSuccess_(
    'Prueba AVECO Renombrador ✅',
    'Webhook configurado correctamente.',
    {
      entorno: Session.getActiveUser().getEmail(),
      fecha:   Utilities.formatDate(new Date(), 'GMT-6', 'dd/MM/yyyy HH:mm')
    }
  );
}
