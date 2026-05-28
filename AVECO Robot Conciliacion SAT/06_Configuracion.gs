/**
 * ============================================================
 * AVECO Robot Financiero — Configuración del DataLake
 * ============================================================
 * Proyecto   : AVECO Robot Financiero
 * Versión    : 3.1.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-28
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Permite REPLICAR la estructura del DataLake en cualquier Google
 *   Sheet: crea las pestañas y encabezados que falten según el esquema
 *   canónico (getSchema_() en 00_Config.gs). NO toca datos existentes:
 *   si una hoja ya tiene encabezados, solo reporta diferencias; nunca
 *   borra ni sobreescribe filas.
 *
 *   Pensado para montar un DataLake nuevo desde cero o reparar la
 *   estructura de uno existente sin riesgo para la información.
 *
 * DEPENDENCIAS INTERNAS:
 *   getConfig() / getSchema_() / requireConfig_()  → 00_Config.gs
 *   notifyDiscordSuccess_                          → 01_Notificaciones.gs
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — FUNCIÓN PRINCIPAL
// ============================================================

/**
 * Crea las hojas y encabezados faltantes según el esquema canónico.
 * Modo seguro: NO borra ni reescribe datos. Para hojas existentes con
 * encabezados, solo detecta y reporta columnas faltantes (no las inserta
 * para no descuadrar datos ya cargados).
 *
 * @returns {Object} Reporte { creadas, encabezadosPuestos, yaExistian, conDiferencias[] }
 */
function configurarDataLake() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const schema = getSchema_();

  const reporte = { creadas: [], encabezadosPuestos: [], yaExistian: [], conDiferencias: [] };

  Object.entries(schema).forEach(([nombreHoja, headers]) => {
    let sheet = ss.getSheetByName(nombreHoja);

    // 1) Hoja nueva → crear y poner encabezados.
    if (!sheet) {
      sheet = ss.insertSheet(nombreHoja);
      escribirEncabezados_(sheet, headers);
      reporte.creadas.push(nombreHoja);
      return;
    }

    // 2) Hoja existente pero vacía (sin encabezados) → poner encabezados.
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      escribirEncabezados_(sheet, headers);
      reporte.encabezadosPuestos.push(nombreHoja);
      return;
    }

    // 3) Hoja con datos → comparar encabezados, reportar diferencias (no tocar).
    const actuales = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(h => (h === null || h === undefined) ? '' : h.toString().trim());
    const faltantes = headers.filter(h => actuales.indexOf(h) === -1);

    if (faltantes.length) reporte.conDiferencias.push({ hoja: nombreHoja, faltantes });
    else reporte.yaExistian.push(nombreHoja);
  });

  Logger.log('configurarDataLake: ' + JSON.stringify(reporte, null, 2));

  const resumen =
    'Creadas: ' + reporte.creadas.length +
    ' | Encabezados puestos: ' + reporte.encabezadosPuestos.length +
    ' | OK: ' + reporte.yaExistian.length +
    ' | Con diferencias: ' + reporte.conDiferencias.length;
  notifyDiscordSuccess_('Configuración del DataLake', resumen, {
    creadas: reporte.creadas.join(', ') || '—',
    revisar: reporte.conDiferencias.map(d => d.hoja).join(', ') || '—',
  });

  return reporte;
}


// ============================================================
// SECCIÓN 2 — UTILIDADES PRIVADAS
// ============================================================

/**
 * Escribe la fila de encabezados con formato (negrita + fila congelada).
 * @param {Sheet} sheet
 * @param {string[]} headers
 */
function escribirEncabezados_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}


// ============================================================
// SECCIÓN 3 — FUNCIÓN DE PRUEBA MANUAL
// ============================================================

/** Reporta el estado de la estructura sin crear nada (solo lectura). */
function testEstructuraDataLake() {
  const cfg = requireConfig_(['SPREADSHEET_ID']);
  const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const schema = getSchema_();

  Object.entries(schema).forEach(([nombreHoja, headers]) => {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) { Logger.log('FALTA HOJA: ' + nombreHoja); return; }
    const actuales = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => (h || '').toString().trim())
      : [];
    const faltantes = headers.filter(h => actuales.indexOf(h) === -1);
    Logger.log(nombreHoja + ': ' + (faltantes.length ? 'faltan [' + faltantes.join(', ') + ']' : 'OK'));
  });
}
