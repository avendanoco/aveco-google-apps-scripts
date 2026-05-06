// ============================================================
// SISTEMA DE ORDENES DE CAMBIO - Jungle Habitas v2.0
// Arquitectura: Un GSheet por OC en carpeta Drive
// Autor: Antonio Avendano - AVECO
// Repositorio: aveco-google-apps-scripts
//
// ESTRUCTURA DEL SPREADSHEET MAESTRO:
//   - Hoja PLANTILLA : Formato base de la OC (nunca se modifica)
//   - Hoja REGISTRO  : Indice maestro con todas las OC
//
// MAPA DE CELDAS EN CADA OC:
//   F4  = No. de Orden        H4  = Fecha
//   B7  = Cod. Proyecto       D7  = Nombre Proyecto
//   H7  = Impacto             I7  = Estatus
//   F9  = Solicito            B24:B31 = Checkboxes Causa del Cambio
//   B12 = Total Aditivo       D12 = Total Deductivo
//   F12 = Neto del Cambio     E55 = Autorizo
//
// COLUMNAS DEL REGISTRO (14 columnas):
//   A: No. OC          B: Fecha          C: Cod. Proyecto
//   D: Nombre Proyecto E: Concepto       F: Impacto
//   G: Estatus         H: Solicito       I: Causa del Cambio
//   J: Autorizo        K: Total Aditivo  L: Total Deductivo
//   M: Neto del Cambio N: Link
// ============================================================

const FOLDER_ID = '1dEu44njMMnr6uEzmitakdnreVMp0HtOh'; // Carpeta Drive de OC

// Mapa de celdas en la plantilla OC
const CELDAS = {
  noOC:        'F4',
  fecha:       'H4',
  codProy:     'B7',   // Merged B7:C7
  nombreProy:  'D7',
  impacto:     'H7',
  estatus:     'I7',
  solicito:    'F9',
  totalAdit:   'B12',
  totalDeduct: 'D12',
  neto:        'F12',
  autorizo:    'E55',
  // Causa del cambio: checkboxes columna B, filas 24-31
};

// Labels de las causas del cambio (en orden fila 24 a 31)
const LABELS_CAUSA = [
  'Por preconstruccion',
  'Condicion de campo',
  'Solicitud del cliente',
  'Por contratacion',
  'Por ejecucion',
  'Por diseno',
  'Ingenieria de valor',
  'Ingenieria de mercado'
];

// ============================================================
// MENU PRINCIPAL
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ordenes de Cambio')
    .addItem('+ Nueva Orden', 'crearNuevaOrdenDeCambio')
    .addItem('Actualizar Registro', 'actualizarRegistro')
    .addToUi();
}

// ============================================================
// LEER DATOS DE UNA HOJA OC
// Recibe un objeto Sheet y devuelve un objeto con todos los campos
// ============================================================
function leerDatosOC(hoja) {
  const g = (celda) => {
    try { return hoja.getRange(celda).getValue(); } catch(e) { return ''; }
  };

  // Leer checkboxes de Causa del Cambio (columna B, filas 24-31)
  const causas = [];
  for (let i = 0; i < 8; i++) {
    try {
      const checked = hoja.getRange(24 + i, 2).getValue();
      if (checked === true) causas.push(LABELS_CAUSA[i]);
    } catch(e) {}
  }

  return {
    noOC:        String(g(CELDAS.noOC)),
    fecha:       g(CELDAS.fecha),
    codProy:     g(CELDAS.codProy),
    nombreProy:  g(CELDAS.nombreProy),
    concepto:    '', // Sin celda fija - se llena manualmente en REGISTRO
    impacto:     g(CELDAS.impacto),
    estatus:     g(CELDAS.estatus),
    solicito:    g(CELDAS.solicito),
    causa:       causas.join(', '),
    autorizo:    g(CELDAS.autorizo),
    totalAdit:   g(CELDAS.totalAdit),
    totalDeduct: g(CELDAS.totalDeduct),
    neto:        g(CELDAS.neto),
  };
}

// ============================================================
// DETECTAR SIGUIENTE NUMERO CONSECUTIVO DE OC
// Lee la ultima fila del REGISTRO y suma 1
// ============================================================
function siguienteNumeroOC() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registro = ss.getSheetByName('REGISTRO');
  const ultimaFila = registro.getLastRow();
  if (ultimaFila < 2) return 1;
  const ultimoVal = registro.getRange(ultimaFila, 1).getValue();
  const match = String(ultimoVal).match(/(\d+)$/);
  return match ? parseInt(match[1]) + 1 : 1;
}

// ============================================================
// CREAR NUEVA ORDEN DE CAMBIO
// - Detecta el siguiente numero consecutivo
// - Copia el Spreadsheet maestro como nuevo archivo en Drive
// - Conserva solo la hoja PLANTILLA y la renombra a OC-XXX
// - Escribe numero y fecha automaticamente
// - Registra la nueva OC en la hoja REGISTRO
// ============================================================
function crearNuevaOrdenDeCambio() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registro = ss.getSheetByName('REGISTRO');
  const plantilla = ss.getSheetByName('PLANTILLA');

  if (!plantilla) { SpreadsheetApp.getUi().alert('Error: No se encontro la hoja PLANTILLA.'); return; }
  if (!registro)  { SpreadsheetApp.getUi().alert('Error: No se encontro la hoja REGISTRO.');  return; }

  const num    = siguienteNumeroOC();
  const numFmt = String(num).padStart(3, '0'); // 001, 002, 003...
  const nombreOC = 'OC-' + numFmt;
  const fechaHoy = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');

  // Verificar que no exista ya un archivo con ese nombre en Drive
  const carpeta = DriveApp.getFolderById(FOLDER_ID);
  const existentes = carpeta.getFilesByName(nombreOC);
  if (existentes.hasNext()) {
    SpreadsheetApp.getUi().alert('Ya existe un archivo llamado ' + nombreOC + ' en la carpeta.');
    return;
  }

  // Copiar el Spreadsheet maestro como nuevo archivo en la carpeta
  const ssFile   = DriveApp.getFileById(ss.getId());
  const nuevoFile = ssFile.makeCopy(nombreOC, carpeta);
  const nuevoSS   = SpreadsheetApp.openById(nuevoFile.getId());

  // Renombrar la hoja PLANTILLA a OC-XXX y eliminar todas las demas
  let hojaOC = null;
  nuevoSS.getSheets().forEach(h => {
    if (h.getName() === 'PLANTILLA') {
      h.setName(nombreOC);
      hojaOC = h;
    }
  });

  if (hojaOC) nuevoSS.setActiveSheet(hojaOC);
  nuevoSS.getSheets().forEach(h => {
    if (h.getName() !== nombreOC) {
      try { nuevoSS.deleteSheet(h); } catch(e) {}
    }
  });

  // Escribir numero de orden y fecha en las celdas correspondientes
  hojaOC = nuevoSS.getSheetByName(nombreOC);
  hojaOC.getRange(CELDAS.noOC).setValue(numFmt);
  hojaOC.getRange(CELDAS.fecha).setValue(fechaHoy);

  // Leer datos iniciales y registrar en el REGISTRO maestro
  const linkNuevo = 'https://docs.google.com/spreadsheets/d/' + nuevoFile.getId();
  const datos = leerDatosOC(hojaOC);

  registro.appendRow([
    nombreOC,          // A: No. OC
    fechaHoy,          // B: Fecha
    datos.codProy,     // C: Cod. Proyecto
    datos.nombreProy,  // D: Nombre Proyecto
    datos.concepto,    // E: Concepto (llenar manualmente)
    datos.impacto,     // F: Impacto
    datos.estatus,     // G: Estatus
    datos.solicito,    // H: Solicito
    datos.causa,       // I: Causa del Cambio
    datos.autorizo,    // J: Autorizo
    datos.totalAdit,   // K: Total Aditivo
    datos.totalDeduct, // L: Total Deductivo
    datos.neto,        // M: Neto del Cambio
    linkNuevo          // N: Link al archivo
  ]);

  SpreadsheetApp.getUi().alert(
    'Orden ' + nombreOC + ' creada exitosamente!\n\n' +
    'Guardada en la carpeta de ordenes de cambio.\n' +
    'Registrada en el indice REGISTRO.\n\n' +
    'Abre el link en la columna N del REGISTRO para editarla.'
  );
}

// ============================================================
// ACTUALIZAR REGISTRO
// Lee todos los archivos GSheet en la carpeta Drive que se
// llamen OC-XXX y sincroniza/actualiza el REGISTRO maestro
// ============================================================
function actualizarRegistro() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registro = ss.getSheetByName('REGISTRO');
  if (!registro) { SpreadsheetApp.getUi().alert('Error: No se encontro la hoja REGISTRO.'); return; }

  const carpeta  = DriveApp.getFolderById(FOLDER_ID);
  const archivos = carpeta.getFiles();

  // Construir mapa de OC ya registradas: nombreOC -> numero de fila
  const totalFilas = registro.getLastRow();
  const mapaRegistro = {};
  if (totalFilas >= 2) {
    const datos = registro.getRange(2, 1, totalFilas - 1, 1).getValues();
    datos.forEach((r, i) => { if (r[0]) mapaRegistro[r[0]] = i + 2; });
  }

  let actualizados = 0;
  let nuevos = 0;

  while (archivos.hasNext()) {
    const archivo = archivos.next();
    const nombre  = archivo.getName();

    // Solo procesar archivos con formato OC-XXX (ej: OC-001, OC-012)
    if (!nombre.match(/^OC-\d+$/)) continue;

    let ocSS;
    try {
      ocSS = SpreadsheetApp.openById(archivo.getId());
    } catch(e) { continue; }

    const hojaOC = ocSS.getSheetByName(nombre);
    if (!hojaOC) continue;

    const d    = leerDatosOC(hojaOC);
    const link = 'https://docs.google.com/spreadsheets/d/' + archivo.getId();

    const fila = [
      nombre, d.fecha, d.codProy, d.nombreProy, d.concepto,
      d.impacto, d.estatus, d.solicito, d.causa, d.autorizo,
      d.totalAdit, d.totalDeduct, d.neto, link
    ];

    if (mapaRegistro[nombre]) {
      // Actualizar fila existente
      registro.getRange(mapaRegistro[nombre], 1, 1, 14).setValues([fila]);
      actualizados++;
    } else {
      // Agregar nueva fila
      registro.appendRow(fila);
      nuevos++;
    }
  }

  // Ordenar REGISTRO por columna A (No. OC) de forma ascendente
  if (registro.getLastRow() > 2) {
    registro.getRange(2, 1, registro.getLastRow() - 1, 14)
      .sort({ column: 1, ascending: true });
  }

  SpreadsheetApp.getUi().alert(
    'Registro actualizado.\n\n' +
    'Actualizados: ' + actualizados + '\n' +
    'Nuevos encontrados: ' + nuevos
  );
}

// ============================================================
// EXPORTAR OC ACTIVA COMO PDF
// Ejecutar desde el archivo individual de la OC
// Permite enviar por email o guardar en la carpeta Drive
// ============================================================
function exportarOCcomoPDF() {
  const ui     = SpreadsheetApp.getUi();
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const hoja   = ss.getActiveSheet();
  const nombre = hoja.getName();

  if (!nombre.match(/^OC-\d+$/)) {
    ui.alert('Abre primero el archivo de la Orden de Cambio (OC-XXX) que quieres exportar.');
    return;
  }

  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
    '/export?format=pdf&gid=' + hoja.getSheetId() +
    '&size=letter&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false';

  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob().setName(nombre + '.pdf');

  const respuesta = ui.alert(
    'Exportar PDF',
    'Enviar ' + nombre + ' por email a tu correo?\n(Cancelar = guardar en carpeta Drive)',
    ui.ButtonSet.OK_CANCEL
  );

  if (respuesta == ui.Button.OK) {
    GmailApp.sendEmail(
      Session.getActiveUser().getEmail(),
      'Orden de Cambio - ' + nombre,
      'Adjunto la orden de cambio ' + nombre + '.',
      { attachments: [blob] }
    );
    ui.alert('PDF enviado a: ' + Session.getActiveUser().getEmail());
  } else {
    DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    ui.alert('PDF guardado en la carpeta de ordenes de cambio.');
  }
}
