// ============================================================
// AVECO Drive Manager — v7c
// + Columna Nivel (Lvl) — profundidad del árbol
// + Columna Est. sin sangría (número limpio)
// + FC por columna B (Nivel): Nivel 0 verde oscuro, Nivel 1 verde medio
// + Resaltar carpetas vacías en rojo (prioridad máxima)
// + Validación anti-movimiento circular
// + Eliminar carpetas vacías en lote
// + Headers abreviados: Est. Lvl Pfx Len Items Nueva Est. Nuevo Pfx
// ============================================================

const ROOT_FOLDER_ID = 'TU_FOLDER_ID_RAIZ'; // ← Cambia esto
const INDEX_SHEET    = '📂 Índice Drive';
const TREE_SHEET     = '🌲 Árbol Carpetas';
const LOG_SHEET      = '📋 Log de Movimientos';
const GEMINI_API_KEY = 'TU_API_KEY_GEMINI';  // ← Opcional

// ══════════════════════════════════════════════════════════════
// MAPA DE COLUMNAS — ÁRBOL CARPETAS v7c
// A=Est.    B=Lvl    C=Pfx(auto)    D=Len(auto)
// E=Items   F=Árbol Visual   G=Nombre Carpeta
// H=✏️Nuevo Nombre(editable)   I=Nueva Est.(editable)
// J=Nuevo Pfx(auto)   K=Len Pfx Nuevo(auto)
// L=Arch.   M=Subs.
// N=ID(oculto)   O=URL   P=Estado
// ══════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🗂️ AVECO Drive Manager')
    .addItem('🔄 Indexar Drive completo', 'indexarDrive')
    .addItem('📁 Sincronizar solo Árbol de Carpetas', 'sincronizarArbol')
    .addSeparator()
    .addItem('👁️ Preview organización por prefijos', 'previewOrganizacion')
    .addItem('🚀 Organizar masivamente por prefijos', 'organizarPorPrefijo')
    .addItem('✏️ Renombrar + Mover por prefijo (Índice)', 'renombrarYMoverPorPrefijo')
    .addSeparator()
    .addItem('🌲 Aplicar cambios del Árbol', 'aplicarCambiosArbol')
    .addItem('🏷️ Aplicar prefijo carpeta a sus archivos', 'mostrarSidebarPrefijo')
    .addSeparator()
    .addItem('📁 Crear nueva carpeta', 'crearCarpeta')
    .addItem('🗑️ Eliminar fila seleccionada', 'eliminarItem')
    .addItem('🧹 Eliminar carpetas vacías en lote', 'eliminarCarpetasVacias')
    .addSeparator()
    .addItem('🤖 Generar índice para IA', 'generarIndiceIA')
    .addItem('🔍 Consultar con IA', 'consultarIA')
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────
function extraerPrefijo(nombre) {
  if (!nombre || typeof nombre !== 'string' || nombre.trim() === '') return '';
  return nombre.split(' ')[0].toUpperCase();
}

function getExtension(filename, mimeType) {
  const mimeMap = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder':       'Carpeta',
    'application/vnd.google-apps.form':         'Google Form',
    'application/pdf':   'PDF',
    'image/jpeg':        'JPG',
    'image/png':         'PNG',
    'image/gif':         'GIF',
    'video/mp4':         'MP4',
    'application/zip':   'ZIP',
    'text/plain':        'TXT',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':   'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         'XLSX',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX'
  };
  if (mimeMap[mimeType]) return mimeMap[mimeType];
  const parts = (filename || '').split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : 'Sin ext.';
}

function prepararLogSheet(ss) {
  const logSheet = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  logSheet.clearContents();
  const hdr = ['Timestamp','Tipo','Elemento','Cambio','Prefijo Ant.','Prefijo Nuevo','Estado'];
  logSheet.appendRow(hdr);
  logSheet.getRange(1,1,1,hdr.length).setFontWeight('bold').setBackground('#e37400').setFontColor('white');
  return logSheet;
}

function escribirLog(logSheet, rows) {
  if (!rows || !rows.length) return;
  logSheet.getRange(logSheet.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
  logSheet.autoResizeColumns(1, rows[0].length);
}

function contarContenidoDirecto(folder) {
  let archivos = 0, carpetas = 0;
  const f = folder.getFiles(); while (f.hasNext()) { f.next(); archivos++; }
  const s = folder.getFolders(); while (s.hasNext()) { s.next(); carpetas++; }
  return { archivos, carpetas, total: archivos + carpetas };
}

function esPadreDeHija(idPadre, idPosibleHija) {
  if (idPadre === idPosibleHija) return true;
  try {
    const folder = DriveApp.getFolderById(idPosibleHija);
    const padres = folder.getParents();
    while (padres.hasNext()) {
      const p = padres.next();
      if (esPadreDeHija(idPadre, p.getId())) return true;
    }
  } catch(e) {}
  return false;
}

// ─────────────────────────────────────────────────────────────
// INDEXAR DRIVE COMPLETO
// ─────────────────────────────────────────────────────────────
function indexarDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INDEX_SHEET) || ss.insertSheet(INDEX_SHEET);
  sheet.clearContents();
  sheet.clearFormats();

  const headers = [
    'ID','Tipo','Nivel','Ruta Completa','Nombre Actual',
    '✏️ Nuevo Nombre','Prefijo','Len Prefijo',
    'Extensión','Peso (KB)','Fecha Creación','Fecha Modificación',
    'URL','ID Carpeta Padre','📁 Mover a ID','Descripción','🏷️ Tags','Estado'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');
  sheet.setFrozenRows(1);

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const rows = [];
  scanFolder(rootFolder, '', 0, rows);

  if (rows.length > 0) {
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
    aplicarFormulasIndice(sheet, rows.length);
    formatearIndice(sheet, rows.length, headers.length);
  }

  buildFolderTree(ss);
  SpreadsheetApp.getUi().alert(`✅ Indexado completo: ${rows.length} elementos encontrados.`);
}

function scanFolder(folder, parentPath, level, rows) {
  const folderName  = folder.getName();
  const currentPath = parentPath ? `${parentPath} / ${folderName}` : folderName;
  const tz          = Session.getScriptTimeZone();

  rows.push([
    folder.getId(), '📁 Carpeta', level, currentPath, folderName,
    '','','','','',
    Utilities.formatDate(folder.getDateCreated(), tz, 'yyyy-MM-dd HH:mm'),
    Utilities.formatDate(folder.getLastUpdated(), tz, 'yyyy-MM-dd HH:mm'),
    folder.getUrl(),
    folder.getParents().hasNext() ? folder.getParents().next().getId() : '',
    '', folder.getDescription() || '', '', ''
  ]);

  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    rows.push([
      file.getId(), '📄 Archivo', level+1,
      `${currentPath} / ${file.getName()}`, file.getName(),
      '','','',
      getExtension(file.getName(), file.getMimeType()),
      Math.round(file.getSize()/1024*10)/10,
      Utilities.formatDate(file.getDateCreated(), tz, 'yyyy-MM-dd HH:mm'),
      Utilities.formatDate(file.getLastUpdated(), tz, 'yyyy-MM-dd HH:mm'),
      file.getUrl(), folder.getId(), '', file.getDescription() || '', '', ''
    ]);
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) scanFolder(subFolders.next(), currentPath, level+1, rows);
}

function aplicarFormulasIndice(sheet, totalRows) {
  for (let i = 2; i <= totalRows+1; i++) {
    sheet.getRange(i,7).setFormula(`=IF(F${i}<>"",LEFT(F${i},FIND(" ",F${i}&" ")-1),LEFT(E${i},FIND(" ",E${i}&" ")-1))`);
    sheet.getRange(i,8).setFormula(`=IF(G${i}<>"",LEN(G${i}),"")`);
  }
}

function formatearIndice(sheet, totalRows, totalCols) {
  sheet.autoResizeColumns(1, totalCols);
  for (let i = 2; i <= totalRows+1; i++) {
    sheet.getRange(i,1,1,totalCols).setBackground(i%2===0 ? '#f8f9fa' : '#ffffff');
  }
  sheet.getRange(2,6,totalRows,1).setBackground('#fff9c4');
  sheet.getRange(2,15,totalRows,1).setBackground('#e8f5e9');
  sheet.getRange(2,17,totalRows,1).setBackground('#fce4ec');
  sheet.getRange(2,7,totalRows,1).setBackground('#f1f3f4');
  sheet.getRange(2,8,totalRows,1).setBackground('#f1f3f4');
  sheet.getRange(1,7,1,2).setBackground('#5f6368').setFontColor('white');
  sheet.hideColumns(1);
  sheet.hideColumns(14);
}

function sincronizarArbol() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  buildFolderTree(ss);
  SpreadsheetApp.getUi().alert('✅ Árbol de carpetas sincronizado.');
}

function construirMapaCarpetas(folderId, mapa = {}) {
  const folder = DriveApp.getFolderById(folderId);
  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    const nombre = sub.getName();
    if (!nombre) continue;
    const prefijo = extraerPrefijo(nombre);
    if (prefijo && !mapa[prefijo]) {
      mapa[prefijo] = { id: sub.getId(), nombre, idPadre: folder.getId() };
    }
    construirMapaCarpetas(sub.getId(), mapa);
  }
  return mapa;
}

// ─────────────────────────────────────────────────────────────
// ORGANIZAR POR PREFIJO
// ─────────────────────────────────────────────────────────────
function previewOrganizacion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  if (!sheet) { SpreadsheetApp.getUi().alert('Primero indexa Drive.'); return; }
  const data = sheet.getDataRange().getValues();
  const mapaCarpetas = construirMapaCarpetas(ROOT_FOLDER_ID);

  for (let i = 1; i < data.length; i++) {
    const [id, tipo,,, nombre,,,,,,,,, idPadre] = data[i];
    if (!nombre || !id || tipo.includes('Carpeta')) continue;
    const prefijo = extraerPrefijo(nombre);
    const destino = mapaCarpetas[prefijo];
    const cell = sheet.getRange(i+1, 18);
    if (!prefijo)                  cell.setValue('⚠️ Sin prefijo').setBackground('#fce4ec');
    else if (!destino)             cell.setValue(`⚠️ Sin carpeta para "${prefijo}"`).setBackground('#fff3e0');
    else if (destino.id===idPadre) cell.setValue('✅ Ya en su lugar').setBackground('#e8f5e9');
    else                           cell.setValue(`📦 Mover → ${destino.nombre}`).setBackground('#e3f2fd');
  }
  SpreadsheetApp.getUi().alert('👁️ Preview listo.');
}

function organizarPorPrefijo() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('🚀 Organizar por Prefijos','¿Mover TODOS los archivos según su prefijo?',ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  const data = sheet.getDataRange().getValues();
  const mapaCarpetas = construirMapaCarpetas(ROOT_FOLDER_ID);
  const logSheet = prepararLogSheet(ss);
  let movidos=0, sinCarpeta=0, yaEnSuLugar=0;
  const logRows = [];

  for (let i = 1; i < data.length; i++) {
    const [id, tipo,,, nombre,,,,,,,,, idPadre] = data[i];
    if (!nombre || !id || tipo.includes('Carpeta')) continue;
    const prefijo = extraerPrefijo(nombre);
    const destino = mapaCarpetas[prefijo];
    const ts = new Date().toISOString();
    if (!prefijo) continue;
    if (!destino) { sheet.getRange(i+1,18).setValue('⚠️ Sin carpeta: '+prefijo).setBackground('#fff3e0'); sinCarpeta++; continue; }
    if (destino.id === idPadre) { sheet.getRange(i+1,18).setValue('✅ Ya en su lugar').setBackground('#e8f5e9'); yaEnSuLugar++; continue; }
    try {
      DriveApp.getFileById(id).moveTo(DriveApp.getFolderById(destino.id));
      logRows.push([ts,'Archivo',nombre,`→ ${destino.nombre}`,prefijo,prefijo,'✅ Movido']);
      sheet.getRange(i+1,14).setValue(destino.id);
      sheet.getRange(i+1,18).setValue('✅ Movido → '+destino.nombre).setBackground('#e8f5e9');
      movidos++;
    } catch(e) {
      logRows.push([ts,'Archivo',nombre,'Error',prefijo,'','❌ '+e.message]);
      sheet.getRange(i+1,18).setValue('❌ '+e.message).setBackground('#fce4ec');
    }
  }
  escribirLog(logSheet, logRows);
  ui.alert(`✅ Movidos: ${movidos} | Ya en su lugar: ${yaEnSuLugar} | Sin carpeta: ${sinCarpeta}`);
}

function renombrarYMoverPorPrefijo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INDEX_SHEET);
  const data = sheet.getDataRange().getValues();
  const mapaCarpetas = construirMapaCarpetas(ROOT_FOLDER_ID);
  let procesados = 0;

  for (let i = 1; i < data.length; i++) {
    const [id, tipo,,, nombreActual, nuevoNombre,,,,,,,,idPadre] = data[i];
    if (!nuevoNombre || nuevoNombre === nombreActual || !id) continue;
    try {
      if (tipo.includes('Carpeta')) {
        DriveApp.getFolderById(id).setName(nuevoNombre);
        sheet.getRange(i+1,5).setValue(nuevoNombre);
        sheet.getRange(i+1,6).clearContent();
        sheet.getRange(i+1,18).setValue('✅ Carpeta renombrada').setBackground('#e8f5e9');
        procesados++; continue;
      }
      const file = DriveApp.getFileById(id);
      file.setName(nuevoNombre);
      sheet.getRange(i+1,5).setValue(nuevoNombre);
      sheet.getRange(i+1,6).clearContent();
      const destino = mapaCarpetas[extraerPrefijo(nuevoNombre)];
      if (destino && destino.id !== idPadre) {
        file.moveTo(DriveApp.getFolderById(destino.id));
        sheet.getRange(i+1,14).setValue(destino.id);
        sheet.getRange(i+1,18).setValue(`✅ Renombrado + Movido → ${destino.nombre}`).setBackground('#e8f5e9');
      } else {
        sheet.getRange(i+1,18).setValue('✅ Renombrado').setBackground('#e8f5e9');
      }
      procesados++;
    } catch(e) {
      sheet.getRange(i+1,18).setValue('❌ '+e.message).setBackground('#fce4ec');
    }
  }
  SpreadsheetApp.getUi().alert(`✅ ${procesados} elementos procesados.`);
}

// ─────────────────────────────────────────────────────────────
// BUILD FOLDER TREE v7c
// Columnas: A=Est.  B=Lvl  C=Pfx  D=Len  E=Items
//           F=Árbol Visual  G=Nombre Carpeta
//           H=✏️Nuevo Nombre  I=Nueva Est.
//           J=Nuevo Pfx  K=Len Pfx Nuevo
//           L=Arch.  M=Subs.
//           N=ID(oculto)  O=URL  P=Estado
// FC: =$B2=0 verde oscuro | =$B2=1 verde medio | =$E2=0 rojo (prioridad)
// ─────────────────────────────────────────────────────────────
function buildFolderTree(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  let treeSheet = ss.getSheetByName(TREE_SHEET) || ss.insertSheet(TREE_SHEET);
  treeSheet.clearContents();
  treeSheet.clearFormats();
  treeSheet.clearConditionalFormatRules();

  const headers = [
    'Est.',                // A  Estructura numérica
    'Lvl',                 // B  Nivel de profundidad
    'Pfx',                 // C  Prefijo
    'Len',                 // D  Longitud prefijo
    'Items',               // E  Contenido total
    'Árbol Visual',        // F
    'Nombre Carpeta',      // G
    '✏️ Nuevo Nombre',     // H editable
    'Nueva Est.',          // I editable
    'Nuevo Pfx',           // J auto
    'Len Pfx Nuevo',       // K auto
    'Arch.',               // L Archivos directos
    'Subs.',               // M Subcarpetas directas
    'ID',                  // N (oculto)
    'URL',                 // O
    'Estado'               // P
  ];

  treeSheet.appendRow(headers);

  // Colores de cabecera
  treeSheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#34a853').setFontColor('white');
  treeSheet.getRange(1,1,1,5).setBackground('#5f6368').setFontColor('white');   // A-E: info/auto
  treeSheet.getRange(1,8,1,2).setBackground('#f9a825').setFontColor('white');   // H-I: editables
  treeSheet.getRange(1,10,1,2).setBackground('#5f6368').setFontColor('white');  // J-K: auto
  treeSheet.setFrozenRows(1);
  treeSheet.setFrozenColumns(2);

  const carpetaRows = [];

  function scanCarpetasArbol(folder, parentNum, level) {
    const subFolders = folder.getFolders();
    const hijos = [];
    while (subFolders.hasNext()) hijos.push(subFolders.next());
    hijos.sort((a, b) => a.getName().localeCompare(b.getName()));

    hijos.forEach((sub, idx) => {
      const nombre    = sub.getName();
      const numActual = parentNum ? `${parentNum}.${idx+1}` : `${idx+1}`;
      const indent    = '    '.repeat(level) + (level > 0 ? '└─ ' : '📂 ');
      const conteo    = contarContenidoDirecto(sub);

      carpetaRows.push({
        estructura:  numActual,  // ← SIN sangría
        nivel:       level,
        prefijo:     '',
        lenPrefijo:  '',
        contenido:   conteo.total,
        arbol:       indent + nombre,
        nombre:      nombre,
        nuevoNombre: '',
        nuevaEstructura: '',
        nuevoPrefijo: '',
        lenNuevo:    '',
        archivos:    conteo.archivos,
        subcarpetas: conteo.carpetas,
        id:          sub.getId(),
        url:         sub.getUrl(),
        estado:      ''
      });

      scanCarpetasArbol(sub, numActual, level+1);
    });
  }

  scanCarpetasArbol(DriveApp.getFolderById(ROOT_FOLDER_ID), '', 0);

  if (!carpetaRows.length) return;

  const valores = carpetaRows.map(r => [
    r.estructura, r.nivel, r.prefijo, r.lenPrefijo, r.contenido,
    r.arbol, r.nombre, r.nuevoNombre, r.nuevaEstructura,
    r.nuevoPrefijo, r.lenNuevo, r.archivos, r.subcarpetas,
    r.id, r.url, r.estado
  ]);
  treeSheet.getRange(2,1,carpetaRows.length,headers.length).setValues(valores);

  const totalRows = carpetaRows.length;

  // Fórmulas automáticas
  for (let i = 2; i <= totalRows+1; i++) {
    // C: Pfx — prefijo del nombre de carpeta (col G)
    treeSheet.getRange(i,3).setFormula(`=IF(G${i}<>"",LEFT(G${i},FIND(" ",G${i}&" ")-1),"")`);
    // D: Len — longitud del prefijo
    treeSheet.getRange(i,4).setFormula(`=IF(C${i}<>"",LEN(C${i}),"")`);
    // J: Nuevo Pfx — prefijo del nuevo nombre (col H)
    treeSheet.getRange(i,10).setFormula(`=IF(H${i}<>"",LEFT(H${i},FIND(" ",H${i}&" ")-1),"")`);
    // K: Len Pfx Nuevo
    treeSheet.getRange(i,11).setFormula(`=IF(J${i}<>"",LEN(J${i}),"")`);
    // O: URL hipervínculo
    const url = carpetaRows[i-2].url;
    if (url) treeSheet.getRange(i,15).setFormula(`=HYPERLINK("${url}","🔗 Abrir")`);
  }

  // Franjas alternas base
  for (let i = 2; i <= totalRows+1; i++) {
    treeSheet.getRange(i,1,1,headers.length).setBackground(i%2===0 ? '#f8f9fa' : '#ffffff');
  }

  // Colores de columnas
  treeSheet.getRange(2,1,totalRows,5).setBackground('#f1f3f4');   // A-E info
  treeSheet.getRange(2,8,totalRows,2).setBackground('#fff9c4');   // H-I editables
  treeSheet.getRange(2,10,totalRows,2).setBackground('#f1f3f4');  // J-K auto
  treeSheet.getRange(2,15,totalRows,1).setBackground('#e8f0fe');  // O URL

  // Ocultar columna N (ID)
  treeSheet.hideColumns(14);

  // ── FORMATO CONDICIONAL v7c ────────────────────────────────
  // Basado en columna B (Lvl):
  //   =$B2=0  → Nivel raíz    → Verde oscuro  #1B5E20 / texto blanco
  //   =$B2=1  → Nivel 1       → Verde medio   #388E3C / texto blanco
  // Carpeta vacía (prioridad MÁXIMA, va primero en el array):
  //   =$E2=0  → Items = 0     → Rojo claro    #FFCDD2 / texto rojo
  // ──────────────────────────────────────────────────────────
  const rangeFmt = treeSheet.getRange(`A2:P${totalRows+1}`);
  const reglas   = [];

  // 1. Carpeta vacía — PRIORIDAD MÁXIMA
  const reglaVacia = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2=0')
    .setBackground('#FFCDD2')
    .setFontColor('#C62828')
    .setRanges([rangeFmt])
    .build();
  reglas.push(reglaVacia);

  // 2. Nivel 0 — verde oscuro
  const reglaLvl0 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2=0')
    .setBackground('#1B5E20')
    .setFontColor('#FFFFFF')
    .setRanges([rangeFmt])
    .build();
  reglas.push(reglaLvl0);

  // 3. Nivel 1 — verde medio
  const reglaLvl1 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2=1')
    .setBackground('#388E3C')
    .setFontColor('#FFFFFF')
    .setRanges([rangeFmt])
    .build();
  reglas.push(reglaLvl1);

  treeSheet.setConditionalFormatRules(reglas);
  treeSheet.autoResizeColumns(1, headers.length);
}

// ─────────────────────────────────────────────────────────────
// APLICAR CAMBIOS DEL ÁRBOL v7c
// ─────────────────────────────────────────────────────────────
function aplicarCambiosArbol() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const treeSheet = ss.getSheetByName(TREE_SHEET);
  const indexSheet = ss.getSheetByName(INDEX_SHEET);
  if (!treeSheet) { ui.alert('Necesitas la hoja Árbol generada.'); return; }

  const treeData  = treeSheet.getDataRange().getValues();
  const logSheet  = prepararLogSheet(ss);
  const logRows   = [];
  let cambios     = 0;
  const indexData = indexSheet ? indexSheet.getDataRange().getValues() : [];

  // Mapa estructura → { id, nombre, row }
  const estructuraMap = {};
  for (let i = 1; i < treeData.length; i++) {
    const estructuraRaw = (treeData[i][0] || '').toString().trim();
    const idCarpeta = treeData[i][13];
    if (estructuraRaw && idCarpeta) {
      estructuraMap[estructuraRaw] = { id: idCarpeta, nombre: treeData[i][6], row: i+1 };
    }
  }

  for (let i = 1; i < treeData.length; i++) {
    const estructuraActual = (treeData[i][0] || '').toString().trim();
    const prefijoActual    = (treeData[i][2] || '').toString().toUpperCase().trim();
    const nombreActual     = treeData[i][6];
    const nuevoNombre      = treeData[i][7];
    const nuevaEstructura  = (treeData[i][8] || '').toString().trim();
    const nuevoPrefijo     = (treeData[i][9] || '').toString().toUpperCase().trim();
    const idCarpeta        = treeData[i][13];

    const hayCambioNombre     = !!(nuevoNombre && nuevoNombre.toString().trim() !== nombreActual.toString().trim());
    const hayCambioEstructura = !!(nuevaEstructura && nuevaEstructura !== estructuraActual);

    if (!idCarpeta || (!hayCambioNombre && !hayCambioEstructura)) continue;

    const ts = new Date().toISOString();

    try {
      const folder = DriveApp.getFolderById(idCarpeta);
      let nombreFinal = nombreActual;

      // 1. Renombrar
      if (hayCambioNombre) {
        folder.setName(nuevoNombre.toString().trim());
        nombreFinal = nuevoNombre.toString().trim();
        logRows.push([ts,'Carpeta',nombreActual,`→ ${nombreFinal}`,prefijoActual,nuevoPrefijo,'✅ Renombrada']);
      }

      let movida = false;
      let destinoNombre = '';

      // 2. Mover por Nueva Est.
      if (hayCambioEstructura) {
        const partes = nuevaEstructura.split('.');
        if (partes.length === 1) {
          const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
          const padreActual = folder.getParents().hasNext() ? folder.getParents().next() : null;
          if (padreActual && padreActual.getId() !== ROOT_FOLDER_ID) {
            rootFolder.addFolder(folder);
            padreActual.removeFolder(folder);
            movida = true;
            destinoNombre = 'Raíz';
            logRows.push([ts,'Carpeta',nombreFinal,'Movida → Raíz',prefijoActual,nuevoPrefijo,'✅ Movida']);
          }
        } else {
          const estructuraPadre = partes.slice(0, -1).join('.');
          const padreDestInfo   = estructuraMap[estructuraPadre];
          if (!padreDestInfo) throw new Error(`No existe estructura padre: ${estructuraPadre}`);
          if (padreDestInfo.id === idCarpeta) throw new Error('No puedes mover una carpeta dentro de sí misma');
          if (esPadreDeHija(idCarpeta, padreDestInfo.id)) throw new Error(`Movimiento circular detectado`);
          const carpetaDestino = DriveApp.getFolderById(padreDestInfo.id);
          const padreActual = folder.getParents().hasNext() ? folder.getParents().next() : null;
          if (!padreActual) throw new Error('No se encontró carpeta padre actual');
          if (padreActual.getId() !== carpetaDestino.getId()) {
            carpetaDestino.addFolder(folder);
            padreActual.removeFolder(folder);
            movida = true;
            destinoNombre = padreDestInfo.nombre;
            logRows.push([ts,'Carpeta',nombreFinal,`Movida → ${destinoNombre}`,prefijoActual,nuevoPrefijo,'✅ Movida']);
          }
        }
      } else if (hayCambioNombre && nuevoPrefijo && prefijoActual && nuevoPrefijo !== prefijoActual) {
        const mapaNuevo = construirMapaCarpetas(ROOT_FOLDER_ID);
        const padreDestino = mapaNuevo[nuevoPrefijo];
        if (padreDestino && padreDestino.id !== idCarpeta && !esPadreDeHija(idCarpeta, padreDestino.id)) {
          const carpetaDestino = DriveApp.getFolderById(padreDestino.id);
          const padreActual = folder.getParents().hasNext() ? folder.getParents().next() : null;
          if (padreActual && padreActual.getId() !== carpetaDestino.getId()) {
            carpetaDestino.addFolder(folder);
            padreActual.removeFolder(folder);
            movida = true;
            destinoNombre = padreDestino.nombre;
            logRows.push([ts,'Carpeta',nombreFinal,`Movida → ${destinoNombre}`,prefijoActual,nuevoPrefijo,'✅ Movida por prefijo']);
          }
        }
      }

      // 3. Actualizar archivos si cambió el prefijo
      let actualizados = 0;
      if (hayCambioNombre && indexData.length && nuevoPrefijo && prefijoActual && nuevoPrefijo !== prefijoActual) {
        for (let j = 1; j < indexData.length; j++) {
          const [fileId, tipoItem,,, nombreArchivo] = indexData[j];
          if (!nombreArchivo || !fileId) continue;
          if (extraerPrefijo(nombreArchivo) !== prefijoActual) continue;
          const nuevoNombreItem = nombreArchivo.replace(new RegExp('^'+prefijoActual,'i'), nuevoPrefijo);
          try {
            if (tipoItem.includes('Archivo')) DriveApp.getFileById(fileId).setName(nuevoNombreItem);
            else if (tipoItem.includes('Carpeta') && fileId !== idCarpeta) DriveApp.getFolderById(fileId).setName(nuevoNombreItem);
            if (indexSheet) indexSheet.getRange(j+1,5).setValue(nuevoNombreItem);
            logRows.push([ts,tipoItem,nombreArchivo,`→ ${nuevoNombreItem}`,prefijoActual,nuevoPrefijo,'✅ Actualizado']);
            actualizados++;
          } catch(e2) {
            logRows.push([ts,tipoItem,nombreArchivo,'Error',prefijoActual,nuevoPrefijo,'❌ '+e2.message]);
          }
        }
      }

      let estadoFinal = '✅';
      if (hayCambioNombre) estadoFinal += ' Renombrada';
      if (movida) estadoFinal += ` + Movida → ${destinoNombre}`;
      if (actualizados > 0) estadoFinal += ` + ${actualizados} archivos actualizados`;
      if (estadoFinal === '✅') estadoFinal = '✅ Sin cambios mayores';

      treeSheet.getRange(i+1,16).setValue(estadoFinal).setBackground('#e8f5e9');
      treeSheet.getRange(i+1,8).clearContent();
      treeSheet.getRange(i+1,9).clearContent();
      cambios++;
    } catch(e) {
      logRows.push([ts,'Carpeta',nombreActual,nuevoNombre||nombreActual,prefijoActual,nuevoPrefijo||'?','❌ '+e.message]);
      treeSheet.getRange(i+1,16).setValue('❌ '+e.message).setBackground('#fce4ec');
    }
  }

  escribirLog(logSheet, logRows);
  if (cambios > 0) buildFolderTree(ss);

  ui.alert(cambios > 0
    ? `✅ ${cambios} carpeta(s) procesada(s). Revisa "${LOG_SHEET}".`
    : '⚠️ No se encontraron cambios. Usa columnas H (Nuevo Nombre) o I (Nueva Est.).');
}

// ─────────────────────────────────────────────────────────────
// ELIMINAR CARPETAS VACÍAS EN LOTE
// ─────────────────────────────────────────────────────────────
function eliminarCarpetasVacias() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const treeSheet = ss.getSheetByName(TREE_SHEET);
  if (!treeSheet) { ui.alert('Primero sincroniza el árbol.'); return; }

  const data = treeSheet.getDataRange().getValues();
  const vacias = [];

  for (let i = 1; i < data.length; i++) {
    const contenido = data[i][4];  // E = Items
    const nombre    = data[i][6];  // G = Nombre
    const idCarpeta = data[i][13]; // N = ID
    if (contenido === 0 && idCarpeta) {
      vacias.push({ nombre, id: idCarpeta, fila: i+1 });
    }
  }

  if (!vacias.length) { ui.alert('✅ No hay carpetas vacías en el árbol.'); return; }

  const lista = vacias.map((v, idx) => `${idx+1}. ${v.nombre}`).join('\n');
  const confirm = ui.alert(
    `🧹 ${vacias.length} carpeta(s) vacías encontradas`,
    `¿Enviar a la papelera?\n\n${lista.substring(0,800)}${lista.length>800?'\n...':''}\n\n⚠️ Esta acción no se puede deshacer fácilmente.`,
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  let eliminadas = 0, errores = 0;
  const logSheet = prepararLogSheet(ss);
  const logRows  = [];

  vacias.forEach(v => {
    try {
      DriveApp.getFolderById(v.id).setTrashed(true);
      treeSheet.getRange(v.fila,16).setValue('🗑️ Eliminada (papelera)').setBackground('#f3e5f5');
      logRows.push([new Date().toISOString(),'Carpeta',v.nombre,'→ Papelera','','','🗑️ Eliminada']);
      eliminadas++;
    } catch(e) {
      treeSheet.getRange(v.fila,16).setValue('❌ '+e.message).setBackground('#fce4ec');
      errores++;
    }
  });

  escribirLog(logSheet, logRows);
  buildFolderTree(ss);
  ui.alert(`🗑️ Eliminadas: ${eliminadas} | Errores: ${errores}`);
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR — PREFIJO MASIVO A ARCHIVOS
// ─────────────────────────────────────────────────────────────
function mostrarSidebarPrefijo() {
  const html = HtmlService.createHtmlOutput(`
<!DOCTYPE html><html><head><style>
*{box-sizing:border-box;margin:0;padding:0;font-family:'Google Sans',sans-serif}
body{background:#f8f9fa;padding:16px;font-size:13px;color:#202124}
h2{font-size:15px;font-weight:600;margin-bottom:4px;color:#1a73e8}.sub{font-size:11px;color:#5f6368;margin-bottom:14px}
label{font-size:12px;font-weight:500;display:block;margin-bottom:4px;color:#3c4043}
input{width:100%;padding:8px 10px;border:1px solid #dadce0;border-radius:6px;font-size:13px;margin-bottom:10px;background:#fff}
input:focus{outline:none;border-color:#1a73e8;box-shadow:0 0 0 2px #e8f0fe}
.preview{background:#e8f0fe;border-radius:6px;padding:10px 12px;font-size:12px;margin-bottom:12px;color:#1a73e8;font-family:monospace}
.preview .p{color:#ea4335;font-weight:bold}.preview .s{color:#fbbc04;font-weight:bold}
.btn{width:100%;padding:10px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px}
.btn-primary{background:#1a73e8;color:white}.btn-prev{background:#e8f0fe;color:#1a73e8}
.log{background:#fff;border:1px solid #dadce0;border-radius:6px;padding:10px;font-size:11px;font-family:monospace;max-height:180px;overflow-y:auto;margin-top:10px;line-height:1.8}
.pill{display:inline-block;background:#e8f0fe;color:#1a73e8;border-radius:12px;padding:2px 10px;font-size:11px;margin:2px 2px 6px 0;cursor:pointer;border:1px solid #c5d9fc}
.ok{color:#34a853}.err{color:#ea4335}.warn{color:#fbbc04}
</style></head><body>
<h2>🏷️ Prefijo masivo a archivos</h2>
<p class="sub">Resultado: <b>PREFIJO-CATEGORIA Nombre.ext</b></p>
<label>ID de la carpeta origen</label>
<input type="text" id="folderId" placeholder="ID de carpeta en Drive" oninput="p()"/>
<label>Categoría (opcional)</label>
<input type="text" id="categoria" placeholder="ej: 01, A, CONT" maxlength="10" oninput="p()"/>
<div><span class="pill" onclick="c('01')">01</span><span class="pill" onclick="c('02')">02</span><span class="pill" onclick="c('03')">03</span><span class="pill" onclick="c('A')">A</span><span class="pill" onclick="c('B')">B</span><span class="pill" onclick="c('C')">C</span></div><br>
<label>Filtrar extensión (vacío=todos)</label>
<input type="text" id="filtroExt" placeholder="ej: PDF, DOCX"/>
<div class="preview"><b>Formato:</b><br><span id="pvw"><span class="p">PREFIJO</span><span class="s">-CAT</span> Nombre.ext</span></div>
<button class="btn btn-prev" onclick="run(true)">👁️ Preview</button>
<button class="btn btn-primary" onclick="run(false)">🚀 Aplicar</button>
<div class="log" id="log">El resultado aparecerá aquí...</div>
<script>
function c(v){document.getElementById('categoria').value=v;p()}
function p(){var cat=document.getElementById('categoria').value.trim();document.getElementById('pvw').innerHTML='<span class="p">PREFIJO</span><span class="s">'+(cat?'-'+cat:'')+'</span> Nombre.ext';}
function run(prev){
  var fid=document.getElementById('folderId').value.trim();
  if(!fid){document.getElementById('log').innerHTML='<span class="warn">⚠️ Ingresa el ID.</span>';return}
  document.getElementById('log').innerHTML='⏳ Procesando...';
  google.script.run
    .withSuccessHandler(function(r){document.getElementById('log').innerHTML=r.join('<br>')})
    .withFailureHandler(function(e){document.getElementById('log').innerHTML='<span class="err">❌ '+e.message+'</span>'})
    .aplicarPrefijoCarpetaAArchivos(fid,document.getElementById('categoria').value.trim(),document.getElementById('filtroExt').value.trim(),prev);
}
</script></body></html>`).setTitle('🏷️ Prefijo Masivo').setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

function aplicarPrefijoCarpetaAArchivos(folderId, categoria, filtroExt, soloPreview) {
  const log = [];
  let folder;
  try { folder = DriveApp.getFolderById(folderId); }
  catch(e) { return ['<span class="err">❌ Carpeta no encontrada.</span>']; }

  const prefijoCarpeta = extraerPrefijo(folder.getName());
  if (!prefijoCarpeta) return ['<span class="warn">⚠️ La carpeta no tiene prefijo.</span>'];

  const nuevoP = prefijoCarpeta + (categoria ? `-${categoria.toUpperCase()}` : '');
  const filtExt = filtroExt ? filtroExt.toUpperCase().split(',').map(e => e.trim()) : [];

  log.push(`📁 <b>${folder.getName()}</b>  🏷️ <b>${nuevoP}</b>`);
  log.push(soloPreview ? '👁️ PREVIEW — sin cambios' : '🚀 EJECUTANDO');
  log.push('─────────────────────');

  const files = folder.getFiles();
  let procesados=0, omitidos=0;
  while (files.hasNext()) {
    const file = files.next();
    const nombreOrig = file.getName();
    if (filtExt.length && !filtExt.includes(getExtension(nombreOrig, file.getMimeType()).toUpperCase())) { omitidos++; continue; }
    const prefijoOrig = extraerPrefijo(nombreOrig);
    const cuerpo = (prefijoOrig && nombreOrig.indexOf(' ') > -1) ? nombreOrig.substring(nombreOrig.indexOf(' ')+1) : nombreOrig;
    const nuevo = `${nuevoP} ${cuerpo}`;
    if (!soloPreview) {
      try { file.setName(nuevo); log.push(`<span class="ok">✅ ${nombreOrig} → ${nuevo}</span>`); }
      catch(e) { log.push(`<span class="err">❌ ${nombreOrig}: ${e.message}</span>`); }
    } else {
      log.push(`<span class="ok">👁️ ${nombreOrig} → ${nuevo}</span>`);
    }
    procesados++;
  }
  log.push(`─────────── Procesados: <b>${procesados}</b> | Omitidos: <b>${omitidos}</b>`);
  return log;
}

// ─────────────────────────────────────────────────────────────
// GESTIÓN CARPETAS
// ─────────────────────────────────────────────────────────────
function crearCarpeta() {
  const ui = SpreadsheetApp.getUi();
  const n = ui.prompt('📁 Nueva Carpeta','Nombre con prefijo:',ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const p = ui.prompt('📍 ID Carpeta Padre','Vacío = raíz:',ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const parentId = p.getResponseText().trim() || ROOT_FOLDER_ID;
  const nueva = DriveApp.getFolderById(parentId).createFolder(n.getResponseText().trim());
  ui.alert(`✅ Creada\nNombre: ${nueva.getName()}\nID: ${nueva.getId()}`);
  indexarDrive();
}

function eliminarItem() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INDEX_SHEET);
  if (!sheet) return;
  const fila = sheet.getActiveRange().getRow();
  if (fila < 2) { SpreadsheetApp.getUi().alert('Selecciona una fila de datos.'); return; }
  const [id, tipo,,, nombre] = sheet.getRange(fila,1,1,5).getValues()[0];
  if (SpreadsheetApp.getUi().alert(`⚠️ ¿Eliminar "${nombre}"?`,'→ Papelera',SpreadsheetApp.getUi().ButtonSet.YES_NO) === SpreadsheetApp.getUi().Button.YES) {
    tipo.includes('Carpeta') ? DriveApp.getFolderById(id).setTrashed(true) : DriveApp.getFileById(id).setTrashed(true);
    sheet.deleteRow(fila);
    SpreadsheetApp.getUi().alert('🗑️ Enviado a la papelera.');
  }
}

// ─────────────────────────────────────────────────────────────
// AGENTE IA (GEMINI)
// ─────────────────────────────────────────────────────────────
function generarIndiceIA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = ss.getSheetByName(INDEX_SHEET).getDataRange().getValues().slice(1);
  const ctx = data.filter(r=>r[0]&&r[1]).map(r=>`[${r[1]}] Prefijo:${extraerPrefijo(r[4])} | Ruta:${r[3]} | ID:${r[0]}`).join('\n');
  const sheet = ss.getSheetByName('🤖 Contexto IA') || ss.insertSheet('🤖 Contexto IA');
  sheet.clearContents();
  sheet.getRange(1,1).setValue(ctx);
  SpreadsheetApp.getUi().alert('✅ Índice IA generado.');
}

function consultarIA() {
  const ui = SpreadsheetApp.getUi();
  const q = ui.prompt('🤖 Buscar con IA','¿Qué buscas?',ui.ButtonSet.OK_CANCEL);
  if (q.getSelectedButton() !== ui.Button.OK) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aiSheet = ss.getSheetByName('🤖 Contexto IA');
  if (!aiSheet) { ui.alert('Primero genera el índice IA.'); return; }
  const ctx = aiSheet.getRange(1,1).getValue();
  const payload = { contents:[{ parts:[{ text:`Eres el asistente de archivos de AVECO.\n\nÍndice:\n${ctx}\n\nResponde: ${q.getResponseText()}\n\nDevuelve: nombre, ruta completa e ID de Drive.` }] }] };
  try {
    const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,{ method:'post',contentType:'application/json',payload:JSON.stringify(payload) });
    ui.alert('🤖 Resultado IA', JSON.parse(res.getContentText()).candidates[0].content.parts[0].text, ui.ButtonSet.OK);
  } catch(e) { ui.alert('❌ Error IA: '+e.message); }
}
