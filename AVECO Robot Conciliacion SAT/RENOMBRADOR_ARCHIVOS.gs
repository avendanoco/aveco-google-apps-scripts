// ============================================================
// Renombrador MOV SAT - v4
// Carpeta: https://drive.google.com/drive/folders/1P7f1TL1bw8WbJwO-3F2VEVVdYQ_mPn3u
// ============================================================

var FOLDER_ID = '1P7f1TL1bw8WbJwO-3F2VEVVdYQ_mPn3u';

function formatYYMMDD(date) {
  var yy = String(date.getFullYear()).slice(-2);
  var mm = String(date.getMonth() + 1).padStart(2, '0');
  var dd = String(date.getDate()).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}

/**
 * Extrae todas las fechas del contenido de texto.
 * Soporta:
 *   DD/MM/YYYY
 *   YYYY-MM-DD
 *   DD-MM-YYYY
 *   DDMMYYYY'  (formato Santander: 8 digitos seguidos de comilla)
 */
function extraerFechasDeContenido(contenido) {
  var fechas = [];
  var m;

  // Patron DD/MM/YYYY
  var re1 = /(\d{2})\/(\d{2})\/(\d{4})/g;
  while ((m = re1.exec(contenido)) !== null) {
    var d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) fechas.push(d);
  }

  // Patron YYYY-MM-DD
  var re2 = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((m = re2.exec(contenido)) !== null) {
    var d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) fechas.push(d);
  }

  // Patron DD-MM-YYYY
  var re3 = /(\d{2})-(\d{2})-(\d{4})/g;
  while ((m = re3.exec(contenido)) !== null) {
    var d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) fechas.push(d);
  }

  // Patron DDMMYYYY' (Santander: 8 digitos + comilla simple)
  var re4 = /(\d{2})(\d{2})(\d{4})'/g;
  while ((m = re4.exec(contenido)) !== null) {
    var dd = parseInt(m[1]);
    var mo = parseInt(m[2]);
    var yy = parseInt(m[3]);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31 && yy > 2000) {
      var d = new Date(yy, mo - 1, dd);
      if (!isNaN(d.getTime())) fechas.push(d);
    }
  }

  return fechas;
}

function obtenerFechasDeArchivo(file, mimeType) {
  try {
    var contenido = '';
    if (mimeType === MimeType.GOOGLE_DOCS) {
      var doc = DocumentApp.openById(file.getId());
      contenido = doc.getBody().getText();
    } else {
      contenido = file.getBlob().getDataAsString();
    }
    return extraerFechasDeContenido(contenido);
  } catch (e) {
    Logger.log('Error leyendo ' + file.getName() + ': ' + e.message);
    return [];
  }
}

function renombrarArchivosMOVSAT() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFiles();
  var resultados = [];

  while (files.hasNext()) {
    var file = files.next();
    var nombreActual = file.getName();
    var mimeType = file.getMimeType();

    try {
      var todasFechas = obtenerFechasDeArchivo(file, mimeType);

      if (todasFechas.length === 0) {
        resultados.push('SIN FECHAS: "' + nombreActual + '"');
        Logger.log('Sin fechas en: ' + nombreActual);
        continue;
      }

      todasFechas.sort(function(a, b) { return a - b; });
      var fechaMasAntigua  = todasFechas[0];
      var fechaMasReciente = todasFechas[todasFechas.length - 1];

      var sufijo = (mimeType === MimeType.GOOGLE_DOCS) ? ' (doc)' : '';
      var nuevoNombre = 'MOV-SAT-' + formatYYMMDD(fechaMasReciente) + '-' + formatYYMMDD(fechaMasAntigua) + sufijo;

      if (nombreActual === nuevoNombre) {
        resultados.push('SIN CAMBIO: "' + nombreActual + '"');
        continue;
      }

      file.setName(nuevoNombre);
      resultados.push('OK: "' + nombreActual + '" -> "' + nuevoNombre + '"');
      Logger.log('Renombrado: ' + nombreActual + ' -> ' + nuevoNombre);

    } catch (e) {
      resultados.push('ERROR: "' + nombreActual + '" - ' + e.message);
      Logger.log('Error: ' + nombreActual + ': ' + e.message);
    }
  }

  Logger.log('\n=== RESUMEN ===');
  resultados.forEach(function(r) { Logger.log(r); });
  Logger.log('Total: ' + resultados.length + ' archivos procesados.');
}

// ============================================================
// Renombrador MOV BANCARIOS - v2
// Carpeta raiz: https://drive.google.com/drive/folders/1F5Z6y1xsnQaa81jtpG-r91sCv-Z8L8fc
// Renombra CSVs de subcarpetas como: NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
// ============================================================

var FOLDER_BANCARIOS_ID = '1F5Z6y1xsnQaa81jtpG-r91sCv-Z8L8fc';

function renombrarArchivosBancarios() {
  var rootFolder = DriveApp.getFolderById(FOLDER_BANCARIOS_ID);
  var subFolders = rootFolder.getFolders();
  var totalResultados = [];

  Logger.log('=== INICIO: Renombrador MOV Bancarios ===');
  Logger.log('Carpeta raiz: ' + rootFolder.getName());

  while (subFolders.hasNext()) {
    var subFolder = subFolders.next();
    var nombreCarpeta = subFolder.getName();
    Logger.log('Procesando subcarpeta: ' + nombreCarpeta);

    var files = subFolder.getFiles();

    while (files.hasNext()) {
      var file = files.next();
      var nombreActual = file.getName();
      var mimeType = file.getMimeType();

      var esCSV = nombreActual.toLowerCase().endsWith('.csv') ||
                  mimeType === 'text/csv' ||
                  mimeType === 'text/plain' ||
                  mimeType === 'application/vnd.ms-excel';

      if (!esCSV) {
        Logger.log('  Omitiendo: ' + nombreActual + ' (' + mimeType + ')');
        continue;
      }

      try {
        var contenido = file.getBlob().getDataAsString();
        var todasFechas = extraerFechasDeContenido(contenido);

        if (todasFechas.length === 0) {
          totalResultados.push('[' + nombreCarpeta + '] SIN FECHAS: "' + nombreActual + '"');
          Logger.log('  Sin fechas: ' + nombreActual);
          continue;
        }

        todasFechas.sort(function(a, b) { return a - b; });
        var fechaMasAntigua  = todasFechas[0];
        var fechaMasReciente = todasFechas[todasFechas.length - 1];

        var nuevoNombre = nombreCarpeta + '-' + formatYYMMDD(fechaMasReciente) + '-' + formatYYMMDD(fechaMasAntigua) + '.csv';

        if (nombreActual === nuevoNombre) {
          totalResultados.push('[' + nombreCarpeta + '] SIN CAMBIO: "' + nombreActual + '"');
          Logger.log('  Sin cambio: ' + nombreActual);
          continue;
        }

        file.setName(nuevoNombre);
        totalResultados.push('[' + nombreCarpeta + '] OK: "' + nombreActual + '" -> "' + nuevoNombre + '"');
        Logger.log('  Renombrado: "' + nombreActual + '" -> "' + nuevoNombre + '"');

      } catch (e) {
        totalResultados.push('[' + nombreCarpeta + '] ERROR: "' + nombreActual + '" - ' + e.message);
        Logger.log('  Error en ' + nombreActual + ': ' + e.message);
      }
    }
  }

  Logger.log('\n=== RESUMEN FINAL ===');
  totalResultados.forEach(function(r) { Logger.log(r); });
  Logger.log('Total archivos procesados: ' + totalResultados.length);
}

// ============================================================
// Renombrador MOV WALLET - v1
// Carpeta: https://drive.google.com/drive/folders/11eQQESA7I9VMT4GBxPZrjrQ-688bgzDt
// Archivos CSV directamente en el folder (sin subcarpetas)
// Los renombra como: NOMBRE_CARPETA-YY-MM-DD-YY-MM-DD.csv
// ============================================================

var FOLDER_WALLET_ID = '11eQQESA7I9VMT4GBxPZrjrQ-688bgzDt';

function renombrarArchivosWallet() {
  var folder = DriveApp.getFolderById(FOLDER_WALLET_ID);
  var nombreCarpeta = folder.getName();
  var files = folder.getFiles();
  var resultados = [];

  Logger.log('=== INICIO: Renombrador MOV Wallet ===');
  Logger.log('Carpeta: ' + nombreCarpeta);

  while (files.hasNext()) {
    var file = files.next();
    var nombreActual = file.getName();
    var mimeType = file.getMimeType();

    // Solo procesar CSV o texto plano
    var esCSV = nombreActual.toLowerCase().endsWith('.csv') ||
                mimeType === 'text/csv' ||
                mimeType === 'text/plain' ||
                mimeType === 'application/vnd.ms-excel';

    if (!esCSV) {
      Logger.log('Omitiendo: ' + nombreActual + ' (' + mimeType + ')');
      continue;
    }

    try {
      var contenido = file.getBlob().getDataAsString();

      // Log primeras 3 lineas para debug de formato
      var lineas = contenido.split('\n').slice(0, 3);
      Logger.log('Primeras lineas de "' + nombreActual + '": ' + lineas.join(' | '));

      var todasFechas = extraerFechasDeContenido(contenido);

      if (todasFechas.length === 0) {
        resultados.push('SIN FECHAS: "' + nombreActual + '"');
        Logger.log('Sin fechas: ' + nombreActual);
        continue;
      }

      todasFechas.sort(function(a, b) { return a - b; });
      var fechaMasAntigua  = todasFechas[0];
      var fechaMasReciente = todasFechas[todasFechas.length - 1];

      var nuevoNombre = nombreCarpeta + '-' + formatYYMMDD(fechaMasReciente) + '-' + formatYYMMDD(fechaMasAntigua) + '.csv';

      if (nombreActual === nuevoNombre) {
        resultados.push('SIN CAMBIO: "' + nombreActual + '"');
        Logger.log('Sin cambio: ' + nombreActual);
        continue;
      }

      file.setName(nuevoNombre);
      resultados.push('OK: "' + nombreActual + '" -> "' + nuevoNombre + '"');
      Logger.log('Renombrado: "' + nombreActual + '" -> "' + nuevoNombre + '"');

    } catch (e) {
      resultados.push('ERROR: "' + nombreActual + '" - ' + e.message);
      Logger.log('Error en ' + nombreActual + ': ' + e.message);
    }
  }

  Logger.log('\n=== RESUMEN ===');
  resultados.forEach(function(r) { Logger.log(r); });
  Logger.log('Total: ' + resultados.length + ' archivos procesados.');
}
