/**
 * ============================================================
 * AVECO Robot Financiero — Renombrador de Movimientos
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
 *   Renombra archivos de movimientos en tres carpetas de Drive
 *   extrayendo el rango de fechas desde el contenido del archivo.
 *     • MOV SAT       → MOV-SAT-YY-MM-DD-YY-MM-DD[(doc)]
 *     • MOV BANCARIOS → NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
 *     • MOV WALLET    → NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
 *
 * TRIGGER:
 *   - Ejecución manual / bajo demanda. Función: renombrarTodo()
 *
 * CONFIGURACIÓN (Script Properties — ver 00_Config.gs):
 *   DRIVE_SAT_FOLDER_ID     → Carpeta de archivos MOV SAT
 *   DRIVE_BANCOS_FOLDER_ID  → Carpeta raíz de MOV Bancarios (subcarpetas)
 *   DRIVE_WALLET_FOLDER_ID  → Carpeta de MOV Wallet
 *   DISCORD_WEBHOOK_URL     → Webhook de notificaciones
 *
 *   NOTA: estas claves son COMPARTIDAS con el Importador. La carpeta
 *   de bancos y la de SAT son las mismas que usa la importación; así
 *   un solo Script Property describe cada recurso en todo el proyecto.
 *
 * FORMATOS DE FECHA EN CONTENIDO:
 *   DD/MM/YYYY · YYYY-MM-DD · DD-MM-YYYY · DDMMYYYY' (Santander)
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig() / requireConfig_()  → 00_Config.gs
 *   notifyDiscordSuccess_/Error_    → 01_Notificaciones.gs
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — FUNCIÓN PRINCIPAL
// ============================================================

/**
 * Ejecuta el renombrado de los tres módulos en secuencia.
 */
function renombrarTodo() {
  const startedAt = new Date();
  const cfg = getConfig();
  Logger.log('=== renombrarTodo iniciado: ' + startedAt.toISOString() + ' ===');

  const resumen = {
    sat:       { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 },
    bancarios: { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 },
    wallet:    { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 },
  };

  try {
    resumen.sat       = renombrarMovSat_();
    resumen.bancarios = renombrarMovBancarios_();
    resumen.wallet    = renombrarMovWallet_();

    const durationMs = new Date().getTime() - startedAt.getTime();

    const descripcion =
      'SAT       → OK: ' + resumen.sat.ok       + ' | Sin cambio: ' + resumen.sat.sinCambio       + ' | Sin fechas: ' + resumen.sat.sinFechas       + ' | Errores: ' + resumen.sat.errores       + '\n' +
      'Bancarios → OK: ' + resumen.bancarios.ok + ' | Sin cambio: ' + resumen.bancarios.sinCambio + ' | Sin fechas: ' + resumen.bancarios.sinFechas + ' | Errores: ' + resumen.bancarios.errores + '\n' +
      'Wallet    → OK: ' + resumen.wallet.ok    + ' | Sin cambio: ' + resumen.wallet.sinCambio    + ' | Sin fechas: ' + resumen.wallet.sinFechas    + ' | Errores: ' + resumen.wallet.errores;

    notifyDiscordSuccess_('Renombrado completado ✅', descripcion, {
      totalRenombrados: String(resumen.sat.ok + resumen.bancarios.ok + resumen.wallet.ok),
      duracion:         durationMs + ' ms',
      fecha:            Utilities.formatDate(startedAt, cfg.TIMEZONE, 'dd/MM/yyyy HH:mm'),
    });

    Logger.log('renombrarTodo completado en ' + durationMs + ' ms');

  } catch (error) {
    Logger.log('Error en renombrarTodo: ' + error.toString());
    notifyDiscordError_('ERROR en renombrado 🚨', 'Error: ' + error.toString() + '\n\nStack: ' + (error.stack || ''));
  }
}


// ============================================================
// SECCIÓN 2 — MÓDULOS DE RENOMBRADO
// ============================================================

/**
 * Renombra archivos MOV SAT (Google Docs y CSV/TXT).
 * @returns {Object} { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovSat_() {
  const cfg     = requireConfig_(['DRIVE_SAT_FOLDER_ID']);
  const folder  = DriveApp.getFolderById(cfg.DRIVE_SAT_FOLDER_ID);
  const files   = folder.getFiles();
  const counter = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV SAT: ' + folder.getName() + ' ---');

  while (files.hasNext()) {
    const file         = files.next();
    const nombreActual = file.getName();
    const mimeType     = file.getMimeType();

    try {
      const fechas = obtenerFechasDeArchivo_(file, mimeType);
      if (fechas.length === 0) { Logger.log('SIN FECHAS: ' + nombreActual); counter.sinFechas++; continue; }

      fechas.sort((a, b) => a - b);
      const sufijo      = mimeType === MimeType.GOOGLE_DOCS ? ' (doc)' : '';
      const nuevoNombre = 'MOV-SAT-' + formatYYMMDD_(fechas[fechas.length - 1]) + '-' + formatYYMMDD_(fechas[0]) + sufijo;

      if (nombreActual === nuevoNombre) { Logger.log('SIN CAMBIO: ' + nombreActual); counter.sinCambio++; continue; }

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
 * @returns {Object} { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovBancarios_() {
  const cfg        = requireConfig_(['DRIVE_BANCOS_FOLDER_ID']);
  const rootFolder = DriveApp.getFolderById(cfg.DRIVE_BANCOS_FOLDER_ID);
  const subFolders = rootFolder.getFolders();
  const counter    = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV BANCARIOS: ' + rootFolder.getName() + ' ---');

  while (subFolders.hasNext()) {
    const subFolder     = subFolders.next();
    const nombreCarpeta = subFolder.getName();
    const files         = subFolder.getFiles();

    Logger.log('Subcarpeta: ' + nombreCarpeta);

    while (files.hasNext()) {
      const file         = files.next();
      const nombreActual = file.getName();

      if (!esArchivoCSV_(file)) { Logger.log('  Omitiendo: ' + nombreActual + ' (' + file.getMimeType() + ')'); continue; }

      try {
        const fechas = extraerFechasDeContenido_(file.getBlob().getDataAsString());
        if (fechas.length === 0) { Logger.log('  SIN FECHAS: ' + nombreActual); counter.sinFechas++; continue; }

        fechas.sort((a, b) => a - b);
        const nuevoNombre = nombreCarpeta + '-' + formatYYMMDD_(fechas[fechas.length - 1]) + '-' + formatYYMMDD_(fechas[0]) + '.csv';

        if (nombreActual === nuevoNombre) { Logger.log('  SIN CAMBIO: ' + nombreActual); counter.sinCambio++; continue; }

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
 * @returns {Object} { ok, sinCambio, sinFechas, errores }
 */
function renombrarMovWallet_() {
  const cfg           = requireConfig_(['DRIVE_WALLET_FOLDER_ID']);
  const folder        = DriveApp.getFolderById(cfg.DRIVE_WALLET_FOLDER_ID);
  const nombreCarpeta = folder.getName();
  const files         = folder.getFiles();
  const counter       = { ok: 0, sinCambio: 0, sinFechas: 0, errores: 0 };

  Logger.log('--- MOV WALLET: ' + nombreCarpeta + ' ---');

  while (files.hasNext()) {
    const file         = files.next();
    const nombreActual = file.getName();

    if (!esArchivoCSV_(file)) { Logger.log('Omitiendo: ' + nombreActual + ' (' + file.getMimeType() + ')'); continue; }

    try {
      const contenido = file.getBlob().getDataAsString();
      Logger.log('Primeras líneas de "' + nombreActual + '": ' + contenido.split('\n').slice(0, 3).join(' | '));

      const fechas = extraerFechasDeContenido_(contenido);
      if (fechas.length === 0) { Logger.log('SIN FECHAS: ' + nombreActual); counter.sinFechas++; continue; }

      fechas.sort((a, b) => a - b);
      const nuevoNombre = nombreCarpeta + '-' + formatYYMMDD_(fechas[fechas.length - 1]) + '-' + formatYYMMDD_(fechas[0]) + '.csv';

      if (nombreActual === nuevoNombre) { Logger.log('SIN CAMBIO: ' + nombreActual); counter.sinCambio++; continue; }

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
// SECCIÓN 3 — UTILIDADES PRIVADAS
// ============================================================

/**
 * Lee el contenido de un archivo y extrae fechas (Docs o blob CSV/TXT).
 * @param {File} file
 * @param {string} mimeType
 * @returns {Date[]}
 */
function obtenerFechasDeArchivo_(file, mimeType) {
  try {
    const contenido = mimeType === MimeType.GOOGLE_DOCS
      ? DocumentApp.openById(file.getId()).getBody().getText()
      : file.getBlob().getDataAsString();
    return extraerFechasDeContenido_(contenido);
  } catch (e) {
    Logger.log('Error leyendo "' + file.getName() + '": ' + e.message);
    return [];
  }
}

/**
 * Extrae todas las fechas encontradas en un texto.
 * @param {string} contenido
 * @returns {Date[]}
 */
function extraerFechasDeContenido_(contenido) {
  const fechas   = [];
  const patrones = [
    { re: /(\d{2})\/(\d{2})\/(\d{4})/g, parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
    { re: /(\d{4})-(\d{2})-(\d{2})/g,   parse: m => new Date(+m[1], +m[2] - 1, +m[3]) },
    { re: /(\d{2})-(\d{2})-(\d{4})/g,   parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
    { re: /(\d{2})(\d{2})(\d{4})'/g,    parse: m => new Date(+m[3], +m[2] - 1, +m[1]) }, // Santander DDMMYYYY'
  ];

  for (const { re, parse } of patrones) {
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(contenido)) !== null) {
      const d = parse(match);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) fechas.push(d);
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
  return fileName.endsWith('.csv') ||
         mimeType === 'text/csv' ||
         mimeType === 'text/plain' ||
         mimeType === 'application/vnd.ms-excel';
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
// SECCIÓN 4 — FUNCIONES DE PRUEBA MANUAL
// ============================================================

/** Ejecuta el ciclo completo de renombrado. */
function testRenombrarTodo() {
  renombrarTodo();
}

/** Prueba solo el módulo MOV SAT. */
function testRenombrarMovSat() {
  Logger.log('MOV SAT: ' + JSON.stringify(renombrarMovSat_()));
}

/** Prueba solo el módulo MOV BANCARIOS. */
function testRenombrarMovBancarios() {
  Logger.log('MOV BANCARIOS: ' + JSON.stringify(renombrarMovBancarios_()));
}

/** Prueba solo el módulo MOV WALLET. */
function testRenombrarMovWallet() {
  Logger.log('MOV WALLET: ' + JSON.stringify(renombrarMovWallet_()));
}

/** Verifica acceso a las tres carpetas configuradas. */
function testDriveAccess() {
  const cfg = getConfig();
  try {
    if (cfg.DRIVE_SAT_FOLDER_ID)    Logger.log('SAT:       ' + DriveApp.getFolderById(cfg.DRIVE_SAT_FOLDER_ID).getName());
    if (cfg.DRIVE_BANCOS_FOLDER_ID) Logger.log('BANCARIOS: ' + DriveApp.getFolderById(cfg.DRIVE_BANCOS_FOLDER_ID).getName());
    if (cfg.DRIVE_WALLET_FOLDER_ID) Logger.log('WALLET:    ' + DriveApp.getFolderById(cfg.DRIVE_WALLET_FOLDER_ID).getName());
    Logger.log('Acceso a carpetas verificado.');
  } catch (e) {
    Logger.log('Error de acceso a Drive: ' + e.message);
  }
}
