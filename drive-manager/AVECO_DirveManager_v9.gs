/** ============================================================
 *  AVECO Drive Manager v8.1
 *  Gestión de Google Drive desde Google Sheets
 *  - Índice Drive v8   (columnas A-R)
 *  - Árbol de Carpetas v8  (columnas A-N)
 *  - Menú separado: ÁRBOL | INDEX DRIVE | GESTIÓN
 *  - Carpeta raíz configurable desde menú (PropertiesService)
 *  - Tags / Descripción con columna Dato + columna Nuevo
 *  - Mover por Est. separado de Renombrar
 *  - Después de mover: refresca Árbol / Índice automáticamente
 * ============================================================
 */

const INDEX_SHEET   = '📂 Índice Drive';
const TREE_SHEET    = '🌲 Árbol Carpetas';
const LOG_SHEET     = '📋 Log de Movimientos';
const PROP_ROOT_KEY = 'ROOT_FOLDER_ID';

/* ============================================================
 * MENÚ PRINCIPAL
 * ============================================================
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🗂️ AVECO Drive Manager')
    .addSubMenu(
      ui.createMenu('⚙️ Configuración')
        .addItem('📂 Definir carpeta raíz (ID)', 'setRootFolderIdFromMenu')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('ÁRBOL DE CARPETAS')
        .addItem('🌲 Sincronizar solo Árbol de Carpetas', 'sincronizarArbol')
        .addItem('✏️ Renombrar carpetas (Árbol)', 'renombrarCarpetasDesdeArbol')
        .addItem('📦 Mover por estructura (Árbol)', 'moverCarpetasDesdeArbolPorEstructura')
        .addItem('🏷️ Aplicar Tags/Desc en Árbol', 'aplicarMetadatosDesdeArbol')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('INDEX DRIVE')
        .addItem('🔄 Indexar Drive completo', 'indexarDrive')
        .addItem('👁️ Preview organización por prefijos', 'previewOrganizacion')
        .addItem('🚀 Organizar desde Índice por Est.', 'organizarDesdeIndicePorEstructura')
        .addItem('✏️ Renombrar desde Índice', 'renombrarDesdeIndice')
        .addItem('🏷️ Aplicar Tags/Desc desde Índice', 'aplicarMetadatosDesdeIndice')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('GESTIÓN')
        .addItem('📁 Crear nueva carpeta', 'crearCarpeta')
        .addItem('🗑️ Eliminar fila seleccionada', 'eliminarItem')
        .addItem('🧹 Eliminar carpetas vacías en lote', 'eliminarCarpetasVacias')
    )
    .addSeparator()
    .addItem('🤖 Generar índice para IA', 'generarIndiceIA')
    .addItem('🔍 Consultar con IA', 'consultarIA')
    .addToUi();
}

/* ============================================================
 * CONFIGURACIÓN — CARPETA RAÍZ (PropertiesService)
 * ============================================================
 */
function getRootFolderId_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_ROOT_KEY);
  if (!id) {
    throw new Error('No hay carpeta raíz configurada. Usa ⚙️ Configuración → Definir carpeta raíz (ID) en el menú.');
  }
  return id;
}

function setRootFolderIdFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '📂 Definir carpeta raíz',
    'Pega el ID de la carpeta raíz de Google Drive que quieres administrar:',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim();
  if (!id) {
    ui.alert('⚠️ ID vacío. No se guardó nada.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_ROOT_KEY, id);
  ui.alert('✅ Carpeta raíz actualizada.\nID: ' + id);
}

/* ============================================================
 * UTILIDADES
 * ============================================================
 */
function extraerPrefijo_(nombre) {
  if (!nombre || typeof nombre !== 'string') return '';
  const t = nombre.trim();
  if (!t) return '';
  return t.split(' ' )[0].toUpperCase();
}

function getExtension_(filename, mimeType) {
  const mimeMap = {
    'application/vnd.google-apps.document':     'GDOC',
    'application/vnd.google-apps.spreadsheet':  'GSHEET',
    'application/vnd.google-apps.presentation': 'GSLIDES',
    'application/vnd.google-apps.folder':       'CARPETA',
    'application/pdf':                          'PDF',
    'image/jpeg':                               'JPG',
    'image/png':                                'PNG',
    'image/gif':                                'GIF',
    'video/mp4':                                'MP4',
    'application/zip':                          'ZIP',
    'text/plain':                               'TXT',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':   'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         'XLSX',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX'
  };
  if (mimeMap[mimeType]) return mimeMap[mimeType];
  const parts = (filename || '').split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : 'SIN_EXT';
}

function contarContenidoCarpeta_(folder) {
  let total = 0;
  const f = folder.getFiles();
  while (f.hasNext()) { f.next(); total++; }
  const s = folder.getFolders();
  while (s.hasNext()) { s.next(); total++; }
  return { total };
}

function prepararLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) sheet = ss.insertSheet(LOG_SHEET);
  sheet.clearContents();
  const hdr = ['Timestamp', 'Tipo', 'Elemento', 'Acción', 'Detalle', 'Estado'];
  sheet.appendRow(hdr);
  sheet.getRange(1,1,1,hdr.length)
    .setFontWeight('bold')
    .setBackground('#e37400')
    .setFontColor('white');
  return sheet;
}

function escribirLog_(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows);
}

/* ============================================================
 * PREPARAR HOJAS v8
 * ============================================================
 */
function prepararIndiceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) sheet = ss.insertSheet(INDEX_SHEET);
  sheet.clearContents();
  sheet.clearFormats();

  const headers = [
    'Est.',          // A
    'Mov-Est.',      // B
    'Len',           // C
    'Extensión',     // D
    'Nom Actual',    // E
    'Nuevo Nom',     // F
    'Tags',          // G
    'Tags Nuevo',    // H
    '📝 Desc',       // I
    '📝 Desc Nuevo', // J
    'Peso (KB)',     // K
    'Fecha Mod.',    // L
    'URL',           // M
    'ID',            // N
    'ID Padre',      // O
    'Lvl',           // P
    'Pfx',           // Q
    'Estado'         // R
  ];

  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length)
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('white');
  sheet.setFrozenRows(1);

  ['B','F','H','J'].forEach(col =>
    sheet.getRange(col + '2:' + col).setBackground('#fff9c4')
  );

  sheet.hideColumns(14); // N
  sheet.hideColumns(15); // O
  sheet.hideColumns(16); // P
  sheet.hideColumns(17); // Q

  return sheet;
}

function prepararArbolSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TREE_SHEET);
  if (!sheet) sheet = ss.insertSheet(TREE_SHEET);
  sheet.clearContents();
  sheet.clearFormats();
  sheet.clearConditionalFormatRules();

  const headers = [
    'Est.',            // A
    'Mov-Est.',        // B
    'Len',             // C
    'Nombre Carpeta',  // D
    'Nuevo Nom',       // E
    'Items',           // F
    'Tags',            // G
    'Tags Nuevo',      // H
    'Desc',            // I
    'Desc Nuevo',      // J
    'URL',             // K
    'Lvl',             // L
    'ID',              // M
    'Estado'           // N
  ];

  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length)
    .setFontWeight('bold')
    .setBackground('#34a853')
    .setFontColor('white');
  sheet.setFrozenRows(1);

  ['B','E','H','J'].forEach(col =>
    sheet.getRange(col + '2:' + col).setBackground('#fff9c4')
  );

  sheet.hideColumns(12); // L
  sheet.hideColumns(13); // M

  return sheet;
}

/* ============================================================
 * INDEXAR DRIVE COMPLETO v8 (con parámetro skipAlert)
 * ============================================================
 */
function indexarDrive(skipAlert) {
  const rootId = getRootFolderId_();
  const root   = DriveApp.getFolderById(rootId);

  const indexSheet = prepararIndiceSheet_();
  const treeSheet  = prepararArbolSheet_();

  const indexRows = [];
  const treeRows  = [];

  scanFolderV8_(root, 0, '1', indexRows, treeRows);

  if (indexRows.length) {
    indexSheet.getRange(2,1,indexRows.length,indexRows[0].length).setValues(indexRows);
    aplicarFormulasIndiceV8_(indexSheet);
  }
  if (treeRows.length) {
    treeSheet.getRange(2,1,treeRows.length,treeRows[0].length).setValues(treeRows);
    aplicarFormulasArbolV8_(treeSheet);
    aplicarFormatoCondicionalArbolV8_(treeSheet);
  }

  SpreadsheetApp.flush();

  if (!skipAlert) {
    SpreadsheetApp.getUi().alert('✅ Indexado completo: ' + indexRows.length + ' elementos.');
  }
}

function scanFolderV8_(folder, lvl, estBase, indexRows, treeRows) {
  const tz            = Session.getScriptTimeZone();
  const nombreCarpeta = folder.getName();
  const id            = folder.getId();
  const padreIter     = folder.getParents();
  const idPadre       = padreIter.hasNext() ? padreIter.next().getId() : '';
  const desc          = (typeof folder.getDescription === 'function') ? (folder.getDescription() || '') : '';
  const tagsMatch     = desc.match(/^\[TAGS:([^\]]+)\]/);
  const tags          = tagsMatch ? tagsMatch[1] : '';
  const descClean     = tags ? desc.replace(/^\[TAGS:[^\]]+\]\s*/, '') : desc;
  const conteo        = contarContenidoCarpeta_(folder);
  const pfx           = extraerPrefijo_(nombreCarpeta);

  // Árbol
  treeRows.push([
    estBase, '', '', nombreCarpeta, '',
    conteo.total, tags, '', descClean, '',
    folder.getUrl(), lvl, id, ''
  ]);

  // Índice (carpeta)
  indexRows.push([
    estBase, '', estBase.length, 'CARPETA', nombreCarpeta, '',
    tags, '', descClean, '', '',
    Utilities.formatDate(folder.getLastUpdated(), tz, 'yyyy-MM-dd HH:mm'),
    folder.getUrl(), id, idPadre, lvl, pfx, ''
  ]);

  // Archivos
  const files = folder.getFiles();
  let fIdx = 1;
  while (files.hasNext()) {
    const file       = files.next();
    const fname      = file.getName();
    const fid        = file.getId();
    const ext        = getExtension_(fname, file.getMimeType());
    const descF      = (typeof file.getDescription === 'function') ? (file.getDescription() || '') : '';
    const tagsMatchF = descF.match(/^\[TAGS:([^\]]+)\]/);
    const tagsF      = tagsMatchF ? tagsMatchF[1] : '';
    const descFClean = tagsF ? descF.replace(/^\[TAGS:[^\]]+\]\s*/, '') : descF;
    const pfxF       = extraerPrefijo_(fname);
    const sizeKB     = (typeof file.getSize === 'function') ? Math.round((file.getSize() || 0) / 1024 * 10) / 10 : '';
    const estFile    = estBase + '.' + fIdx;
    fIdx++;

    indexRows.push([
      estFile, '', estFile.length, ext, fname, '',
      tagsF, '', descFClean, '', sizeKB,
      Utilities.formatDate(file.getLastUpdated(), tz, 'yyyy-MM-dd HH:mm'),
      file.getUrl(), fid, id, lvl + 1, pfxF, ''
    ]);
  }

  // Subcarpetas
  const subs = [];
  const it = folder.getFolders();
  while (it.hasNext()) subs.push(it.next());
  subs.sort((a,b) => a.getName().localeCompare(b.getName()));

  for (let i = 0; i < subs.length; i++) {
    scanFolderV8_(subs[i], lvl + 1, estBase + '.' + (i+1), indexRows, treeRows);
  }
}

/* ============================================================
 * FÓRMULAS Y FORMATO
 * ============================================================
 */
function aplicarFormulasIndiceV8_(sheet) {
  sheet.autoResizeColumns(1, sheet.getLastColumn());
}

function aplicarFormulasArbolV8_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  for (let i = 2; i <= lastRow; i++) {
    sheet.getRange(i,3).setFormula(`=IF(A${i}<>"",LEN(A${i}),"")`);
    const url = sheet.getRange(i,11).getValue();
    if (url && typeof url === 'string' && url.startsWith('http')) {
      sheet.getRange(i,11).setFormula(`=HYPERLINK("${url}","🔗 Abrir")`);
    }
  }
  sheet.autoResizeColumns(1, sheet.getLastColumn());
}

function aplicarFormatoCondicionalArbolV8_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn());
  const rules = [];

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$F2=0')
      .setBackground('#FFCDD2').setFontColor('#C62828')
      .setRanges([range]).build()
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$L2=0')
      .setBackground('#1B5E20').setFontColor('#FFFFFF')
      .setRanges([range]).build()
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$L2=1')
      .setBackground('#388E3C').setFontColor('#FFFFFF')
      .setRanges([range]).build()
  );

  sheet.setConditionalFormatRules(rules);
}

/* ============================================================
 * SINCRONIZAR SOLO ÁRBOL (con skipAlert)
 * ============================================================
 */
function sincronizarArbol(skipAlert) {
  const root  = DriveApp.getFolderById(getRootFolderId_());
  const sheet = prepararArbolSheet_();
  const rows  = [];

  scanFolderTreeOnlyV8_(root, 0, '1', rows);

  if (rows.length) {
    sheet.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }
  aplicarFormulasArbolV8_(sheet);
  aplicarFormatoCondicionalArbolV8_(sheet);
  SpreadsheetApp.flush();

  if (!skipAlert) {
    SpreadsheetApp.getUi().alert('✅ Árbol de carpetas sincronizado.');
  }
}

function scanFolderTreeOnlyV8_(folder, lvl, estBase, treeRows) {
  const desc      = (typeof folder.getDescription === 'function') ? (folder.getDescription() || '') : '';
  const tagsMatch = desc.match(/^\[TAGS:([^\]]+)\]/);
  const tags      = tagsMatch ? tagsMatch[1] : '';
  const descClean = tags ? desc.replace(/^\[TAGS:[^\]]+\]\s*/, '') : desc;
  const conteo    = contarContenidoCarpeta_(folder);

  treeRows.push([
    estBase, '', '', folder.getName(), '',
    conteo.total, tags, '', descClean, '',
    folder.getUrl(), lvl, folder.getId(), ''
  ]);

  const subs = [];
  const it = folder.getFolders();
  while (it.hasNext()) subs.push(it.next());
  subs.sort((a,b) => a.getName().localeCompare(b.getName()));

  for (let i = 0; i < subs.length; i++) {
    scanFolderTreeOnlyV8_(subs[i], lvl+1, estBase + '.' + (i+1), treeRows);
  }
}

/* ============================================================
 * ÁRBOL — RENOMBRAR CARPETAS
 * ============================================================
 */
function renombrarCarpetasDesdeArbol() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TREE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No se encontró la hoja Árbol.');
    return;
  }
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const id           = data[i][12];
    const nombreActual = data[i][3];
    const nuevoNom     = (data[i][4] || '').toString().trim();
    if (!id || !nuevoNom || nuevoNom === (nombreActual || '').toString().trim()) continue;

    try {
      DriveApp.getFolderById(id).setName(nuevoNom);
      sheet.getRange(i+1,4).setValue(nuevoNom);
      sheet.getRange(i+1,5).clearContent();
      sheet.getRange(i+1,14).setValue('✅ Renombrada').setBackground('#e8f5e9');
      logRows.push([new Date().toISOString(),'Carpeta',nombreActual,'Renombrar','→ '+nuevoNom,'✅']);
      count++;
    } catch (e) {
      sheet.getRange(i+1,14).setValue('❌ '+e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(),'Carpeta',nombreActual,'Renombrar',e.message,'❌']);
    }
  }
  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✏️ Carpetas renombradas: ' + count);
}

/* ============================================================
 * ÁRBOL — MOVER CARPETAS (con resync automático)
 * ============================================================
 */
function moverCarpetasDesdeArbolPorEstructura() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TREE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No se encontró la hoja Árbol.');
    return;
  }
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];

  const mapEst = {};
  for (let i = 1; i < data.length; i++) {
    const est = (data[i][0] || '').toString().trim();
    const id  = data[i][12];
    const nom = data[i][3];
    if (est && id) mapEst[est] = { id, nombre: nom };
  }

  let movidas = 0;
  for (let i = 1; i < data.length; i++) {
    const movEst    = (data[i][1] || '').toString().trim();
    const estActual = (data[i][0] || '').toString().trim();
    const id        = data[i][12];
    const nombre    = data[i][3];
    if (!movEst || !id || movEst === estActual) continue;

    const destInfo = mapEst[movEst];
    if (!destInfo) {
      sheet.getRange(i+1,14)
        .setValue('⚠️ Est. destino no encontrada: ' + movEst)
        .setBackground('#fff3e0');
      continue;
    }
    if (destInfo.id === id) {
      sheet.getRange(i+1,14)
        .setValue('⚠️ Origen = Destino')
        .setBackground('#fff3e0');
      continue;
    }

    try {
      const folder  = DriveApp.getFolderById(id);
      const destino = DriveApp.getFolderById(destInfo.id);
      const padres  = folder.getParents();
      const padre   = padres.hasNext() ? padres.next() : null;
      if (padre && padre.getId() !== destino.getId()) {
        destino.addFolder(folder);
        padre.removeFolder(folder);
      }
      sheet.getRange(i+1,14).setValue('✅ Movida → ' + destInfo.nombre).setBackground('#e8f5e9');
      sheet.getRange(i+1,2).clearContent();
      logRows.push([new Date().toISOString(),'Carpeta',nombre,'Mover','→ '+destInfo.nombre,'✅']);
      movidas++;
    } catch (e) {
      sheet.getRange(i+1,14).setValue('❌ '+e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(),'Carpeta',nombre,'Mover',e.message,'❌']);
    }
  }

  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();

  if (movidas > 0) {
    sincronizarArbol(true); // refresca Árbol sin mostrar alerta adicional
  }

  SpreadsheetApp.getUi()
    .alert('📦 Carpetas movidas: ' + movidas + '\n🌲 Árbol actualizado automáticamente.');
}

/* ============================================================
 * ÁRBOL — APLICAR TAGS / DESC
 * ============================================================
 */
function aplicarMetadatosDesdeArbol() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TREE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No se encontró la hoja Árbol.');
    return;
  }
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const id     = data[i][12];
    const nombre = data[i][3];
    const tagsN  = (data[i][7] || '').toString().trim();
    const descN  = (data[i][9] || '').toString().trim();
    if (!id || (!tagsN && !descN)) continue;

    try {
      const folder     = DriveApp.getFolderById(id);
      const descActual = (folder.getDescription() || '').replace(/^\[TAGS:[^\]]+\]\s*/, '');
      let nuevaDesc = descN || descActual;
      if (tagsN) nuevaDesc = '[TAGS:' + tagsN + '] ' + nuevaDesc;
      folder.setDescription(nuevaDesc);

      sheet.getRange(i+1,7).setValue(tagsN);
      sheet.getRange(i+1,9).setValue(descN);
      sheet.getRange(i+1,8).clearContent();
      sheet.getRange(i+1,10).clearContent();
      sheet.getRange(i+1,14).setValue('✅ Metadatos aplicados').setBackground('#e8f5e9');
      logRows.push([new Date().toISOString(),'Carpeta',nombre,'Metadatos','Tags/Desc','✅']);
      count++;
    } catch (e) {
      sheet.getRange(i+1,14).setValue('❌ '+e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(),'Carpeta',nombre,'Metadatos',e.message,'❌']);
    }
  }
  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('🏷️ Metadatos aplicados en Árbol: ' + count);
}

/* ============================================================
 * ÍNDICE — PREVIEW ORGANIZACIÓN POR PREFIJOS
 * ============================================================
 */
function previewOrganizacion() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No se encontró el Índice.');
    return;
  }
  const data = sheet.getDataRange().getValues();

  const mapaCarpetas = {};
  for (let i = 1; i < data.length; i++) {
    const ext = data[i][3];
    const nombre = data[i][4];
    const id = data[i][13];
    if (ext === 'CARPETA' && id && nombre) {
      const pfx = extraerPrefijo_(nombre);
      if (pfx) mapaCarpetas[pfx] = { id, nombre };
    }
  }

  for (let i = 1; i < data.length; i++) {
    const ext    = data[i][3];
    const nombre = data[i][4];
    const idPadr = data[i][14];
    const cell   = sheet.getRange(i+1,18);
    if (!nombre || ext === 'CARPETA') continue;

    const pfx     = extraerPrefijo_(nombre);
    const destino = mapaCarpetas[pfx];

    if (!pfx)                       cell.setValue('⚠️ Sin prefijo').setBackground('#fce4ec');
    else if (!destino)              cell.setValue('⚠️ Sin carpeta: ' + pfx).setBackground('#fff3e0');
    else if (destino.id === idPadr) cell.setValue('✅ Ya en su carpeta').setBackground('#e8f5e9');
    else                            cell.setValue('📦 Mover → ' + destino.nombre).setBackground('#e3f2fd');
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('👁️ Preview listo. Revisa la columna Estado (R).');
}

/* ============================================================
 * ÍNDICE — ORGANIZAR POR EST. (col B: Mov-Est.) con reindex
 * ============================================================
 */
function organizarDesdeIndicePorEstructura() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert(
    '🚀 Organizar por Est.',
    '¿Mover todos los elementos con "Mov-Est." rellenado?',
    ui.ButtonSet.YES_NO
  ) !== ui.Button.YES) return;

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) return;
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];

  const mapEst = {};
  for (let i = 1; i < data.length; i++) {
    const est = (data[i][0] || '').toString().trim();
    const id  = data[i][13];
    const nom = data[i][4];
    if (est && id) mapEst[est] = { id, nombre: nom };
  }

  let movidos = 0;
  for (let i = 1; i < data.length; i++) {
    const movEst    = (data[i][1] || '').toString().trim();
    const estActual = (data[i][0] || '').toString().trim();
    const id        = data[i][13];
    const idPadre   = data[i][14];
    const nombre    = data[i][4];
    const ext       = data[i][3];
    if (!movEst || movEst === estActual || !id) continue;

    const destInfo = mapEst[movEst];
    if (!destInfo) {
      sheet.getRange(i+1,18).setValue('⚠️ Est. no encontrada: ' + movEst).setBackground('#fff3e0');
      continue;
    }

    try {
      const destino  = DriveApp.getFolderById(destInfo.id);
      const padreObj = idPadre ? DriveApp.getFolderById(idPadre) : null;

      if (ext === 'CARPETA') {
        const folder = DriveApp.getFolderById(id);
        if (padreObj && padreObj.getId() !== destino.getId()) {
          destino.addFolder(folder);
          padreObj.removeFolder(folder);
        }
      } else {
        const file = DriveApp.getFileById(id);
        // mover archivo directo
        file.moveTo(destino);
      }
      sheet.getRange(i+1,18).setValue('✅ Movido → ' + destInfo.nombre).setBackground('#e8f5e9');
      sheet.getRange(i+1,2).clearContent();
      logRows.push([new Date().toISOString(), ext, nombre, 'Mover', '→ ' + destInfo.nombre, '✅']);
      movidos++;
    } catch (e) {
      sheet.getRange(i+1,18).setValue('❌ ' + e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(), ext, nombre, 'Mover', e.message, '❌']);
    }
  }

  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();

  if (movidos > 0) {
    indexarDrive(true); // reindexa todo sin doble alerta
  }

  ui.alert('📦 Elementos movidos: ' + movidos + '\n📂 Índice actualizado automáticamente.');
}

/* ============================================================
 * ÍNDICE — RENOMBRAR
 * ============================================================
 */
function renombrarDesdeIndice() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) return;
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const id           = data[i][13];
    const ext          = data[i][3];
    const nombreActual = data[i][4];
    const nuevoNom     = (data[i][5] || '').toString().trim();
    if (!id || !nuevoNom || nuevoNom === (nombreActual || '').toString().trim()) continue;

    try {
      if (ext === 'CARPETA') DriveApp.getFolderById(id).setName(nuevoNom);
      else DriveApp.getFileById(id).setName(nuevoNom);

      sheet.getRange(i+1,5).setValue(nuevoNom);
      sheet.getRange(i+1,6).clearContent();
      sheet.getRange(i+1,18).setValue('✅ Renombrado').setBackground('#e8f5e9');
      logRows.push([new Date().toISOString(), ext, nombreActual, 'Renombrar', '→ ' + nuevoNom, '✅']);
      count++;
    } catch (e) {
      sheet.getRange(i+1,18).setValue('❌ ' + e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(), ext, nombreActual, 'Renombrar', e.message, '❌']);
    }
  }
  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✏️ Elementos renombrados: ' + count);
}

/* ============================================================
 * ÍNDICE — APLICAR TAGS / DESC
 * ============================================================
 */
function aplicarMetadatosDesdeIndice() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) return;
  const data     = sheet.getDataRange().getValues();
  const logSheet = prepararLogSheet_();
  const logRows  = [];
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const id     = data[i][13];
    const ext    = data[i][3];
    const nombre = data[i][4];
    const tagsN  = (data[i][7] || '').toString().trim();
    const descN  = (data[i][9] || '').toString().trim();
    if (!id || (!tagsN && !descN)) continue;

    try {
      let target;
      if (ext === 'CARPETA') target = DriveApp.getFolderById(id);
      else target = DriveApp.getFileById(id);

      const descActual = (target.getDescription() || '').replace(/^\[TAGS:[^\]]+\]\s*/, '');
      let nuevaDesc = descN || descActual;
      if (tagsN) nuevaDesc = '[TAGS:' + tagsN + '] ' + nuevaDesc;
      target.setDescription(nuevaDesc);

      sheet.getRange(i+1,7).setValue(tagsN);
      sheet.getRange(i+1,9).setValue(descN);
      sheet.getRange(i+1,8).clearContent();
      sheet.getRange(i+1,10).clearContent();
      sheet.getRange(i+1,18).setValue('✅ Metadatos aplicados').setBackground('#e8f5e9');
      logRows.push([new Date().toISOString(), ext, nombre, 'Metadatos', 'Tags/Desc', '✅']);
      count++;
    } catch (e) {
      sheet.getRange(i+1,18).setValue('❌ ' + e.message).setBackground('#fce4ec');
      logRows.push([new Date().toISOString(), ext, nombre, 'Metadatos', e.message, '❌']);
    }
  }
  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('🏷️ Metadatos aplicados en Índice: ' + count);
}

/* ============================================================
 * GESTIÓN
 * ============================================================
 */
function crearCarpeta() {
  const ui = SpreadsheetApp.getUi();
  const n  = ui.prompt('📁 Nueva carpeta','Nombre de la carpeta:',ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const nombre = n.getResponseText().trim();
  if (!nombre) return;

  const p = ui.prompt('📍 ID Carpeta Padre','Vacío = carpeta raíz configurada:',ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const padreId = p.getResponseText().trim() || getRootFolderId_();

  const nueva = DriveApp.getFolderById(padreId).createFolder(nombre);
  ui.alert('✅ Carpeta creada\nNombre: ' + nueva.getName() + '\nID: ' + nueva.getId());
}

function eliminarItem() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Abre primero el Índice Drive.');
    return;
  }
  const fila = sheet.getActiveRange().getRow();
  if (fila < 2) {
    SpreadsheetApp.getUi().alert('Selecciona una fila de datos.');
    return;
  }
  const row    = sheet.getRange(fila,1,1,sheet.getLastColumn()).getValues()[0];
  const est    = row[0];
  const ext    = row[3];
  const nombre = row[4];
  const id     = row[13];
  if (!id) return;

  const ui = SpreadsheetApp.getUi();
  if (ui.alert(
      '🗑️ Enviar a papelera',
      `¿Eliminar "${nombre}" (${ext})?\nEst.: ${est}`,
      ui.ButtonSet.YES_NO
  ) !== ui.Button.YES) return;

  try {
    if (ext === 'CARPETA') DriveApp.getFolderById(id).setTrashed(true);
    else DriveApp.getFileById(id).setTrashed(true);
    sheet.deleteRow(fila);
    ui.alert('✅ Enviado a la papelera.');
  } catch (e) {
    ui.alert('❌ Error: ' + e.message);
  }
}

function eliminarCarpetasVacias() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TREE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Primero sincroniza el Árbol.');
    return;
  }
  const data   = sheet.getDataRange().getValues();
  const vacias = [];
  for (let i = 1; i < data.length; i++) {
    const items = data[i][5];
    const id    = data[i][12];
    const nom   = data[i][3];
    if (items === 0 && id) vacias.push({ fila: i+1, id, nombre: nom });
  }

  if (!vacias.length) {
    SpreadsheetApp.getUi().alert('✅ No hay carpetas vacías.');
    return;
  }

  const ui    = SpreadsheetApp.getUi();
  const lista = vacias.slice(0,20).map((v,idx)=>`${idx+1}. ${v.nombre}`).join('\n');
  if (ui.alert(
      '🧹 ' + vacias.length + ' carpetas vacías encontradas',
      '¿Enviar a la papelera?\n\n' + lista + (vacias.length > 20 ? '\n…y más' : ''),
      ui.ButtonSet.YES_NO
  ) !== ui.Button.YES) return;

  const logSheet = prepararLogSheet_();
  const logRows  = [];
  let eliminadas = 0;

  vacias.forEach(v => {
    try {
      DriveApp.getFolderById(v.id).setTrashed(true);
      sheet.getRange(v.fila,14).setValue('🗑️ Eliminada').setBackground('#f3e5f5');
      logRows.push([new Date().toISOString(),'Carpeta',v.nombre,'Eliminar','→ Papelera','✅']);
      eliminadas++;
    } catch (e) {
      sheet.getRange(v.fila,14).setValue('❌ '+e.message).setBackground('#fce4ec');
    }
  });

  escribirLog_(logSheet, logRows);
  SpreadsheetApp.flush();
  ui.alert('🗑️ Eliminadas: ' + eliminadas + ' de ' + vacias.length);
}

/* ============================================================
 * IA
 * ============================================================
 */
function generarIndiceIA() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const ctx  = [];

  for (let i = 1; i < data.length; i++) {
    const est  = data[i][0];
    const ext  = data[i][3];
    const nom  = data[i][4];
    const tags = data[i][6];
    const desc = data[i][8];
    const id   = data[i][13];
    if (!id || !nom) continue;
    let line = `[${ext}] Est:${est} | ${nom} | ID:${id}`;
    if (tags) line += ` | Tags:${tags}`;
    if (desc) line += ` | Desc:${desc}`;
    ctx.push(line);
  }

  let aiSheet = ss.getSheetByName('🤖 Contexto IA');
  if (!aiSheet) aiSheet = ss.insertSheet('🤖 Contexto IA');
  aiSheet.clearContents();
  aiSheet.getRange(1,1).setValue(ctx.join('\n'));
  SpreadsheetApp.getUi().alert('✅ Índice IA generado: ' + ctx.length + ' elementos.');
}

function consultarIA() {
  SpreadsheetApp.getUi().alert(
    '🔍 Consultar IA',
    'Conecta aquí tu integración con Gemini o OpenAI usando el Índice IA generado.\n\n' +
    'Primero ejecuta "Generar índice para IA" y luego pega el contexto en tu prompt.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
