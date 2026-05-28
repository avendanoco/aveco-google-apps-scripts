/**
 * AGREGAR ESTO A TU APPS SCRIPT EXISTENTE (Code.gs o un nuevo archivo CharlyEndpoint.gs)
 * 
 * Este endpoint es llamado por Charly (n8n) cada mañana para obtener 
 * los movimientos que necesitan decisión humana.
 */

// ============================================================
// AGREGA ESTE CASE A TU doPost EXISTENTE:
// ============================================================
// case 'getPendingReview':
//   return getPendingReviewMovements();

/**
 * Obtiene movimientos pendientes de revisión para que Charly los analice
 */
function getPendingReviewMovements() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetRevision = ss.getSheetByName('Revision_Humana');
  
  if (!sheetRevision || sheetRevision.getLastRow() < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        pendientes: [],
        total: 0,
        mensaje: 'Sin movimientos pendientes'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const headers = sheetRevision.getRange(1, 1, 1, sheetRevision.getLastColumn()).getValues()[0];
  const data = sheetRevision.getRange(2, 1, sheetRevision.getLastRow() - 1, sheetRevision.getLastColumn()).getValues();
  
  // Mapear columnas por nombre
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h.toString().trim()] = i; });
  
  // Filtrar solo pendientes
  const pendientes = data
    .filter(row => {
      const estado = row[colIdx['estado_revision'] ?? 14]?.toString().toLowerCase() || '';
      return estado === 'pendiente' || estado === '';
    })
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h.toString().trim()] = row[i];
      });
      return obj;
    })
    .filter(row => row.id_interno) // Solo filas con ID
    .slice(0, 15); // Máximo 15 por sesión
  
  // Enriquecer con contexto de anomalías
  const pendientesEnriquecidos = pendientes.map(mov => {
    const monto = parseFloat(mov.monto || 0);
    const confianza = parseFloat(mov.confianza_categoria || 0);
    
    let tipoProblema = [];
    if (!mov.categoria_board || confianza < 0.5) tipoProblema.push('sin_categoria');
    if (!mov.centro_costo_id_obra) tipoProblema.push('sin_obra');
    if (!mov.uuid_cfdi && monto < -1000) tipoProblema.push('sin_cfdi_alto_monto');
    if (mov.notas_revision && mov.notas_revision.toString().includes('ANOMALIA')) tipoProblema.push('anomalia');
    
    return {
      ...mov,
      tipo_problema: tipoProblema,
      monto_formateado: new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto)
    };
  });
  
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      pendientes: pendientesEnriquecidos,
      total: pendientesEnriquecidos.length,
      sinCategoria: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('sin_categoria')).length,
      sinObra: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('sin_obra')).length,
      anomalias: pendientesEnriquecidos.filter(p => p.tipo_problema.includes('anomalia')).length,
      fecha_consulta: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * TAMBIÉN AGREGA ESTA NUEVA HOJA A TU SHEET - Sesiones_Charly
 * Con estos encabezados (fila 1):
 * fecha | sesion_json | estado | mensaje | fecha_respuesta
 * 
 * Corre esta función UNA VEZ para crear la hoja automáticamente:
 */
function crearHojaSesionesCharly() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  let sheet = ss.getSheetByName('Sesiones_Charly');
  if (!sheet) {
    sheet = ss.insertSheet('Sesiones_Charly');
    Logger.log('Hoja Sesiones_Charly creada');
  }
  
  // Solo agregar headers si la hoja está vacía
  if (sheet.getLastRow() === 0) {
    const headers = ['fecha', 'sesion_json', 'estado', 'mensaje', 'fecha_respuesta'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    Logger.log('Headers de Sesiones_Charly creados');
  }
  
  // Confirmar
  Logger.log('✅ Hoja Sesiones_Charly lista. Charly puede operar.');
}


/**
 * FUNCIÓN DE PRUEBA: Simula lo que Charly verá mañana en la mañana
 * Ejecútala manualmente desde el editor de Apps Script para probar
 */
function testGetPendingReview() {
  const result = getPendingReviewMovements();
  Logger.log('Respuesta de getPendingReview:');
  Logger.log(result.getContent());
}
