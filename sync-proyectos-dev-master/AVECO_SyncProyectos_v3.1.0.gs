/**
 * ============================================================
 * AVECO Sync Proyectos Dev → Master (MODO ESPEJO ESTRICTO)
 * ============================================================
 * Proyecto   : AVECO Drive Manager - Sync proyectos
 * Versión    : 3.1.0
 * Cuenta GWS : antonio.ac@aveco.mx
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-20
 * Actualizado: 2026-05-20
 *
 * Descripción:
 * Modo ESPEJO ESTRICTO entre carpeta de desarrollador (Dev) y
 * carpeta maestra AVECO (Master) por proyecto:
 *
 * - Replica estructura completa de carpetas y subcarpetas.
 * - Copia archivos nuevos.
 * - Actualiza archivos modificados (fecha/tamaño).
 * - Detecta archivos/carpetas que YA NO existen en el Drive del
 *   desarrollador y los envía DIRECTO A LA PAPELERA de Drive
 *   (setTrashed(true)).
 *
 * Hojas:
 * - SyncProyectos: tabla de configuración por proyecto.
 * - SyncLogs     : histórico de ejecuciones de sync.
 *
 * Menú:
 * - Configurar hoja SyncProyectos
 * - Configurar Discord Webhook
 * - Ejecutar sync Dev → Master (Espejo estricto)
 * - Ver último log de ejecución
 * - Probar notificación
 * ============================================================
 */

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    discordWebhookUrl: props.getProperty('DISCORD_WEBHOOK_URL') || '',
    syncSheetName: props.getProperty('SYNC_SHEET_NAME') || 'SyncProyectos',
    logSheetName: props.getProperty('SYNC_LOG_SHEET_NAME') || 'SyncLogs'
  };
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔁 AVECO Sync')
    .addItem('Configurar hoja SyncProyectos', 'setupSyncSheet')
    .addItem('Configurar Discord Webhook', 'configureDiscordWebhook')
    .addSeparator()
    .addItem('Ejecutar sync Dev → Master (Espejo estricto)', 'runSyncDevToMaster')
    .addItem('Ver último log de ejecución', 'showLastSyncLog')
    .addSeparator()
    .addItem('Probar notificación', 'testNotification')
    .addToUi();
}

function setupSyncSheet() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  const config = getConfig();

  let sheet = ss.getSheetByName(config.syncSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(config.syncSheetName);
  } else {
    sheet.clear();
    sheet.clearFormats();
  }

  const headers = [
    'Activo',
    'Nombre Proyecto',
    'Dev Folder URL',
    'Dev Folder ID',
    'Master Folder URL',
    'Master Folder ID',
    'Última Sync',
    'Nota / Log'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#e0e0e0');
  headerRange.setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 180);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(8, 260);

  const range = sheet.getRange(1, 1, sheet.getMaxRows(), headers.length);
  range.createFilter();

  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).insertCheckboxes();

  sheet.getRange('B2').setNote('Nombre del proyecto');
  sheet.getRange('C2').setNote('URL carpeta del desarrollador (origen)');
  sheet.getRange('E2').setNote('URL carpeta destino (maestra AVECO)');

  props.setProperty('SYNC_SHEET_NAME', config.syncSheetName);
  props.setProperty('SYNC_LOG_SHEET_NAME', config.logSheetName);

  setupLogSheet_();

  SpreadsheetApp.getUi().alert(
    'SyncProyectos y SyncLogs configuradas.\n\n' +
    'Llena Nombre Proyecto, Dev Folder URL y Master Folder URL,\n' +
    'configura el Discord Webhook y ejecuta el sync (espejo estricto).'
  );
}

function setupLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  const config = getConfig();
  let logSheet = ss.getSheetByName(config.logSheetName);

  if (!logSheet) {
    logSheet = ss.insertSheet(config.logSheetName);
  }

  if (logSheet.getLastRow() === 0) {
    const headers = [
      'Fecha Hora',
      'Duración (s)',
      'Proyectos procesados',
      'Archivos nuevos',
      'Archivos actualizados',
      'Enviados a papelera',
      'Advertencias',
      'Detalles'
    ];
    logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const headerRange = logSheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#d0e0ff');
    headerRange.setHorizontalAlignment('center');

    logSheet.setFrozenRows(1);
    logSheet.setColumnWidths(1, headers.length, 200);
    logSheet.setColumnWidth(1, 160);
    logSheet.setColumnWidth(2, 100);
    logSheet.setColumnWidth(6, 180);
    logSheet.setColumnWidth(7, 220);
    logSheet.setColumnWidth(8, 260);

    const range = logSheet.getRange(1, 1, logSheet.getMaxRows(), headers.length);
    range.createFilter();
  }
}

function configureDiscordWebhook() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty('DISCORD_WEBHOOK_URL') || '';

  const response = ui.prompt(
    'Configurar Discord Webhook',
    'Pega el URL completo del webhook de Discord.\n' +
    'Deja vacío para desactivar notificaciones.\n\n' +
    'Webhook actual (solo lectura):\n' +
    (current ? current : 'Ninguno configurado'),
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const value = response.getResponseText().trim();
    if (value) {
      props.setProperty('DISCORD_WEBHOOK_URL', value);
      ui.alert('Webhook actualizado correctamente.');
    } else {
      props.deleteProperty('DISCORD_WEBHOOK_URL');
      ui.alert('Webhook eliminado. No se enviarán notificaciones.');
    }
  }
}

function runSyncDevToMaster() {
  const start = new Date();
  const config = getConfig();
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(config.syncSheetName);

  if (!sheet) {
    notifyDiscordError_(
      '❌ Sync Dev → Master',
      'No se encontró la hoja de configuración: ' + config.syncSheetName
    );
    throw new Error('Hoja de configuración no encontrada: ' + config.syncSheetName);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No hay filas de configuración.');
    return;
  }

  const range = sheet.getRange(2, 1, lastRow - 1, 8);
  const values = range.getValues();
  const now = new Date();
  const scriptProps = PropertiesService.getScriptProperties();

  let totalProyectos = 0;
  let totalNuevos = 0;
  let totalActualizados = 0;
  let totalEliminados = 0;
  const warnings = [];
  const projectSummaries = [];

  values.forEach((row, i) => {
    const rowIndex = i + 2;
    const [activo, nombreProyecto, devUrl, devId, masterUrl, masterId] = row;
    if (!activo) return;

    const finalDevId = devId || extractFolderId_(devUrl);
    const finalMasterId = masterId || extractFolderId_(masterUrl);

    if (!finalDevId || !finalMasterId) {
      const warn = 'Fila ' + rowIndex + ' (' + (nombreProyecto || 'sin nombre') + '): ' +
        'faltan IDs de carpeta (Dev/Master).';
      warnings.push(warn);
      sheet.getRange(rowIndex, 8).setValue('Faltan IDs de carpeta');
      return;
    }

    try {
      const devFolder = DriveApp.getFolderById(finalDevId);
      const masterRootFolder = DriveApp.getFolderById(finalMasterId);

      const result = syncProjectMirrorStrict_(devFolder, masterRootFolder, scriptProps);

      sheet.getRange(rowIndex, 4).setValue(finalDevId);
      sheet.getRange(rowIndex, 6).setValue(finalMasterId);
      sheet.getRange(rowIndex, 7).setValue(now);
      sheet.getRange(rowIndex, 8).setValue(result.note);

      totalProyectos++;
      totalNuevos += result.created;
      totalActualizados += result.updated;
      totalEliminados += result.deleted;

      projectSummaries.push(
        (nombreProyecto || devFolder.getName()) +
        ' → Nuevos: ' + result.created +
        ', Actualizados: ' + result.updated +
        ', Enviados a papelera: ' + result.deleted
      );
    } catch (e) {
      const msg = 'Fila ' + rowIndex + ' (' + (nombreProyecto || 'sin nombre') + '): ' +
        'Error: ' + e.message;
      Logger.log(msg);
      warnings.push(msg);
      sheet.getRange(rowIndex, 8).setValue('Error: ' + e.message);
    }
  });

  const end = new Date();
  const durationSeconds = (end.getTime() - start.getTime()) / 1000;

  const resumen = 'Proyectos: ' + totalProyectos +
    ' | Nuevos: ' + totalNuevos +
    ' | Actualizados: ' + totalActualizados +
    ' | Enviados a papelera: ' + totalEliminados +
    ' | Duración: ' + durationSeconds.toFixed(1) + 's';

  const details = projectSummaries.join('\n');

  appendSyncLog_(
    end, durationSeconds, totalProyectos, totalNuevos,
    totalActualizados, totalEliminados, warnings, details
  );

  if (warnings.length > 0) {
    const fullText = resumen + '\n\n' +
      (details ? details + '\n\n' : '') +
      'Advertencias:\n' + warnings.join('\n');
    notifyDiscordWarning_('⚠️ Sync Dev → Master (Espejo estricto) con advertencias', fullText);
  } else {
    const fullText = resumen + '\n\n' + (details || '');
    notifyDiscordSuccess_('✅ Sync Dev → Master (Espejo estricto) completado', fullText);
  }
}

function syncProjectMirrorStrict_(sourceRootFolder, masterRootFolder, scriptProps) {
  const projectName = sourceRootFolder.getName();

  let targetProjectFolder = null;
  const subFolders = masterRootFolder.getFoldersByName(projectName);
  if (subFolders.hasNext()) {
    targetProjectFolder = subFolders.next();
  } else {
    targetProjectFolder = masterRootFolder.createFolder(projectName);
  }

  const folderMapPrefix = 'SYNC_FOLDER_DEV_MASTER_';
  scriptProps.setProperty(folderMapPrefix + sourceRootFolder.getId(), targetProjectFolder.getId());

  const counters = { created: 0, updated: 0, deleted: 0 };
  const usedSourceFolderIds = {};
  const usedSourceFileIds = {};

  syncFolderRecursiveMirror_(
    sourceRootFolder, targetProjectFolder, scriptProps,
    counters, usedSourceFolderIds, usedSourceFileIds
  );

  cleanOrphansStrict_(
    targetProjectFolder, scriptProps, folderMapPrefix,
    usedSourceFolderIds, usedSourceFileIds, counters
  );

  const note = 'Proyecto "' + projectName + '" → Nuevos: ' +
    counters.created + ', Actualizados: ' + counters.updated +
    ', Enviados a papelera: ' + counters.deleted;

  return { created: counters.created, updated: counters.updated, deleted: counters.deleted, note: note };
}

function syncFolderRecursiveMirror_(
  sourceFolder, targetFolder, scriptProps,
  counters, usedSourceFolderIds, usedSourceFileIds
) {
  const sourceFolderId = sourceFolder.getId();
  const targetFolderId = targetFolder.getId();
  const fileMapPrefix = 'SYNC_FILE_DEV_MASTER_' + sourceFolderId + '->' + targetFolderId + '_';
  const folderMapPrefix = 'SYNC_FOLDER_DEV_MASTER_';

  usedSourceFolderIds[sourceFolderId] = true;
  scriptProps.setProperty(folderMapPrefix + sourceFolderId, targetFolderId);

  const sourceFiles = sourceFolder.getFiles();
  while (sourceFiles.hasNext()) {
    const srcFile = sourceFiles.next();
    const srcId = srcFile.getId();
    const srcName = srcFile.getName();
    const srcUpdated = srcFile.getLastUpdated().getTime();
    const srcSize = srcFile.getSize();

    usedSourceFileIds[srcId] = true;

    const mapKey = fileMapPrefix + srcId;
    const knownTargetId = scriptProps.getProperty(mapKey);

    if (!knownTargetId) {
      const copy = srcFile.makeCopy(srcName, targetFolder);
      copy.setDescription('SRC_ID:' + srcId);
      scriptProps.setProperty(mapKey, copy.getId());
      counters.created++;
    } else {
      try {
        const tgtFile = DriveApp.getFileById(knownTargetId);
        const tgtUpdated = tgtFile.getLastUpdated().getTime();
        const tgtSize = tgtFile.getSize();
        if (srcUpdated > tgtUpdated || srcSize !== tgtSize) {
          const parent = tgtFile.getParents().hasNext()
            ? tgtFile.getParents().next()
            : targetFolder;
          tgtFile.setTrashed(true);
          const newCopy = srcFile.makeCopy(srcName, parent);
          newCopy.setDescription('SRC_ID:' + srcId);
          scriptProps.setProperty(mapKey, newCopy.getId());
          counters.updated++;
        }
      } catch (e) {
        const copy = srcFile.makeCopy(srcName, targetFolder);
        copy.setDescription('SRC_ID:' + srcId);
        scriptProps.setProperty(mapKey, copy.getId());
        counters.created++;
      }
    }
  }

  const sourceSubFolders = sourceFolder.getFolders();
  while (sourceSubFolders.hasNext()) {
    const srcSubFolder = sourceSubFolders.next();
    const srcSubId = srcSubFolder.getId();
    const srcSubName = srcSubFolder.getName();

    usedSourceFolderIds[srcSubId] = true;

    let targetSubFolderId = scriptProps.getProperty(folderMapPrefix + srcSubId);
    let targetSubFolder = null;

    if (targetSubFolderId) {
      try { targetSubFolder = DriveApp.getFolderById(targetSubFolderId); } catch (e) { targetSubFolder = null; }
    }

    if (!targetSubFolder) {
      const existing = targetFolder.getFoldersByName(srcSubName);
      if (existing.hasNext()) {
        targetSubFolder = existing.next();
      } else {
        targetSubFolder = targetFolder.createFolder(srcSubName);
        targetSubFolder.setDescription('SRC_FOLDER_ID:' + srcSubId);
      }
      scriptProps.setProperty(folderMapPrefix + srcSubId, targetSubFolder.getId());
    }

    syncFolderRecursiveMirror_(
      srcSubFolder, targetSubFolder, scriptProps,
      counters, usedSourceFolderIds, usedSourceFileIds
    );
  }
}

function cleanOrphansStrict_(
  targetProjectFolder, scriptProps, folderMapPrefix,
  usedSourceFolderIds, usedSourceFileIds, counters
) {
  const stackFolders = [targetProjectFolder];

  while (stackFolders.length) {
    const current = stackFolders.pop();

    const files = current.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const description = f.getDescription();
      let sourceId = null;
      if (description && description.indexOf('SRC_ID:') === 0) {
        sourceId = description.replace('SRC_ID:', '').trim();
      }
      if (sourceId && !usedSourceFileIds[sourceId]) {
        try { f.setTrashed(true); counters.deleted++; } catch (e) {
          Logger.log('No se pudo enviar a papelera: ' + f.getName() + ' - ' + e.message);
        }
      }
    }

    const subs = current.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      const desc = sub.getDescription();
      let sourceFolderId = null;
      if (desc && desc.indexOf('SRC_FOLDER_ID:') === 0) {
        sourceFolderId = desc.replace('SRC_FOLDER_ID:', '').trim();
      }
      if (sourceFolderId && !usedSourceFolderIds[sourceFolderId]) {
        try { sub.setTrashed(true); counters.deleted++; continue; } catch (e) {
          Logger.log('No se pudo enviar a papelera carpeta: ' + sub.getName() + ' - ' + e.message);
        }
      }
      stackFolders.push(sub);
    }
  }
}

function appendSyncLog_(fechaFin, duracionSeg, proyectos, nuevos, actualizados, eliminados, warnings, details) {
  const ss = SpreadsheetApp.getActive();
  const config = getConfig();
  let logSheet = ss.getSheetByName(config.logSheetName);
  if (!logSheet) { setupLogSheet_(); logSheet = ss.getSheetByName(config.logSheetName); }
  logSheet.appendRow([fechaFin, duracionSeg, proyectos, nuevos, actualizados, eliminados,
    warnings.length > 0 ? warnings.join('\n') : '', details]);
}

function showLastSyncLog() {
  const ss = SpreadsheetApp.getActive();
  const config = getConfig();
  const logSheet = ss.getSheetByName(config.logSheetName);
  if (!logSheet || logSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Aún no hay registros en "' + config.logSheetName + '".');
    return;
  }
  const lastRowIdx = logSheet.getLastRow();
  const row = logSheet.getRange(lastRowIdx, 1, 1, 8).getValues()[0];
  const [fecha, duracion, proyectos, nuevos, actualizados, eliminados, advertencias, detalles] = row;
  const msg =
    'Fecha: ' + fecha + '\n' +
    'Duración: ' + (duracion.toFixed ? duracion.toFixed(1) : duracion) + 's\n' +
    'Proyectos: ' + proyectos + '\n' +
    'Nuevos: ' + nuevos + '\n' +
    'Actualizados: ' + actualizados + '\n' +
    'Enviados a papelera: ' + eliminados + '\n\n' +
    (detalles ? 'Detalles:\n' + detalles + '\n\n' : '') +
    (advertencias ? 'Advertencias:\n' + advertencias : 'Sin advertencias.');
  SpreadsheetApp.getUi().alert('Último Sync Dev → Master (Espejo estricto)', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function extractFolderId_(url) {
  if (!url) return null;
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function notifyDiscordSuccess_(title, description) { sendDiscordEmbed_(title, description, 5793266); }
function notifyDiscordWarning_(title, description) { sendDiscordEmbed_(title, description, 16753920); }
function notifyDiscordError_(title, description) { sendDiscordEmbed_(title, description, 15548997); }

function sendDiscordEmbed_(title, description, color) {
  const config = getConfig();
  const webhookUrl = config.discordWebhookUrl;
  if (!webhookUrl) { Logger.log('Discord webhook no configurado (DISCORD_WEBHOOK_URL).'); return; }
  const payload = JSON.stringify({
    username: 'AVECO Bot',
    embeds: [{ title: title, description: description, color: color,
      timestamp: new Date().toISOString(), footer: { text: 'AVECO • Google Apps Script' } }]
  });
  try {
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200 && code !== 204) {
      Logger.log('Respuesta inesperada Discord: ' + code + ' - ' + response.getContentText());
    }
  } catch (e) { Logger.log('Error enviando webhook Discord: ' + e.message); }
}

function testNotification() {
  try { runSyncDevToMaster(); } catch (e) { Logger.log('Error en testNotification: ' + e.message); }
}
