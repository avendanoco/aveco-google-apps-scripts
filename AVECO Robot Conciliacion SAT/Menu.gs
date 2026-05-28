// ============================================
// Script 6: MENÚ PERSONALIZADO + FLUJO COMPLETO
// Custom menu en Google Sheets para ejecutar automatizaciones
// ============================================


/**
 * onOpen - Crea menú personalizado al abrir spreadsheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Robot Finanzas AVECO')
    .addSubMenu(ui.createMenu('🏦 Movimientos Bancarios')
      .addItem('1. Normalizar Movimientos Bancarios', 'menuNormalizarBancos')
      .addItem('2. Auto-categorizar Movimientos', 'menuCategorizarMovimientos'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📄 SAT / CFDI')
      .addItem('Importar CFDI desde Drive', 'importSATFromFolder')
      .addItem('Detectar Duplicados SAT', 'detectAndRemoveDuplicates'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📊 Board Export')
      .addItem('Exportar a Board (Estandares_Board)', 'menuExportarBoard'))
    .addSeparator()
        .addSubMenu(ui.createMenu('⚡ Análisis Avanzado')
      .addItem('1. Detectar Transferencias Internas', 'menuDetectarTransferencias')
      .addItem('2. Entrenar Modelo ML', 'menuEntrenarModelo')
      .addItem('3. Detectar Anomalías', 'menuDetectarAnomalias')
      .addItem('4. Predecir Flujo de Caja (30d)', 'menuPredecirFlujoCaja'))
    .addItem('▶️ EJECUTAR FLUJO COMPLETO', 'menuFlujoCompleto')
    .addSeparator()
    .addItem('⚙️ Configuración y Estado', 'menuEstado')
    .addToUi();
}

/**
 * FLUJO COMPLETO: Normaliza → Categoriza → Exporta a Board
 */
function menuFlujoCompleto() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    'Ejecutar Flujo Completo',
    '¿Deseas ejecutar todo el proceso automatizado?\n\n' +
    '1. Normalizar movimientos bancarios\n' +
    '2. Auto-categorizar movimientos\n' +
    '3. Exportar a Board\n\n' +
    'Esto puede tomar varios minutos.',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    return;
  }
  
  try {
    ui.alert('Iniciando proceso...');
    
    // Paso 1: Normalizar
    const result1 = normalizarMovimientosBancarios();
    Logger.log('Normalización: ' + JSON.stringify(result1));
    
    // Paso 2: Categorizar
    const result2 = categorizarMovimientos();
    Logger.log('Categorización: ' + JSON.stringify(result2));
    
    // Paso 3: Exportar a Board
    const result3 = exportarABoard();
    Logger.log('Exportación: ' + JSON.stringify(result3));
    
    ui.alert(
      'Proceso Completado ✅',
      `Resultados:\n\n` +
      `🏦 Normalización: ${result1.insertados} movimientos insertados (${result1.duplicados} duplicados)\n` +
      `🏷️ Categorización: ${result2.categorizados} movimientos categorizados\n` +
      `📊 Board Export: ${result3.exportados} registros exportados`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    ui.alert('❌ Error', 'Ocurrió un error: ' + error.message, ui.ButtonSet.OK);
    Logger.log('Error en flujo completo: ' + error.message);
  }
}

/**
 * Menú: Normalizar movimientos bancarios
 */
function menuNormalizarBancos() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = normalizarMovimientosBancarios();
    ui.alert(
      'Normalización Completada',
      `Procesados: ${result.procesados}\n` +
      `Insertados: ${result.insertados}\n` +
      `Duplicados: ${result.duplicados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Auto-categorizar movimientos
 */
function menuCategorizarMovimientos() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = categorizarMovimientos();
    ui.alert(
      'Categorización Completada',
      `Procesados: ${result.procesados}\n` +
      `Categorizados: ${result.categorizados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Exportar a Board
 */
function menuExportarBoard() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = exportarABoard();
    ui.alert(
      'Exportación Completada',
      `Procesados: ${result.procesados}\n` +
      `Exportados: ${result.exportados}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Mostrar estado del sistema
 */
function menuEstado() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  try {
    const sheetMaestros = ss.getSheetByName('Movimientos_Maestros');
    const sheetBancos = ss.getSheetByName('MOVIMIENTOS_BANCARIOS');
    const sheetBoard = ss.getSheetByName('Estandares_Board');
    const sheetCategorias = ss.getSheetByName('Catalogo_Categorias');
    
    const countMaestros = sheetMaestros ? sheetMaestros.getLastRow() - 1 : 0;
    const countBancos = sheetBancos ? sheetBancos.getLastRow() - 1 : 0;
    const countBoard = sheetBoard ? sheetBoard.getLastRow() - 1 : 0;
    const countCategorias = sheetCategorias ? sheetCategorias.getLastRow() - 1 : 0;
    
    // Contar categorizados
    let categorizados = 0;
    if (sheetMaestros && sheetMaestros.getLastRow() > 1) {
      const data = sheetMaestros.getRange(2, 13, countMaestros, 1).getValues();
      categorizados = data.filter(row => row[0]).length;
    }
    
    ui.alert(
      'Estado del Sistema',
      `📈 Estadísticas:\n\n` +
      `🏦 Movimientos Bancarios: ${countBancos} registros\n` +
      `📋 Movimientos Maestros: ${countMaestros} registros\n` +
      `🏷️ Categorizados: ${categorizados} / ${countMaestros}\n` +
      `📊 Board Export: ${countBoard} registros\n` +
      `📚 Catálogo Categorías: ${countCategorias} categorías`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

// ============================================
// FUNCIONES DE MENÚ AVANZADAS
// ============================================

/**
 * Menú: Detectar transferencias internas
 */
function menuDetectarTransferencias() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = detectarTransferenciasInternas();
    ui.alert(
      '✅ Transferencias Detectadas',
      `Transferencias detectadas: ${result.detectadas}\n` +
      `Movimientos pareados: ${result.pareadas}`,
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Entrenar modelo ML
 */
function menuEntrenarModelo() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = entrenarModeloCategorizacion();
    ui.alert(
      '🧠 Modelo Entrenado',
      `Patrones aprendidos: ${result.patrones}\n` +
      `Categorías analizadas: ${result.categorias}\n\n` +
      'Los datos se guardaron en "ML_Training_Data"',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Detectar anomalías
 */
function menuDetectarAnomalias() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = detectarAnomalias();
    ui.alert(
      '🔍 Anomalías Detectadas',
      `Movimientos inusuales encontrados: ${result.anomalias}\n\n` +
      (result.anomalias > 0 ? 'Revisa la hoja "Revision_Humana" para más detalles.' : 'No se encontraron anomalías.'),
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menú: Predecir flujo de caja
 */
function menuPredecirFlujoCaja() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const result = predecirFlujoCaja();
    ui.alert(
      '📊 Predicción de Flujo de Caja (30 días)',
      `🟢 Ingresos estimados: $${result.ingresos.toFixed(2)}\n` +
      `🔴 Egresos estimados: $${result.egresos.toFixed(2)}\n` +
      `🟡 Balance neto: $${result.neto.toFixed(2)}\n\n` +
      'Basado en promedio de últimos 90 días',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Error', error.message, ui.ButtonSet.OK);
  }
}
