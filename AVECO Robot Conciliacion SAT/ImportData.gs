// ========================================
// Script 2: IMPORTAR DATOS SAT A SHEETS
// Importa archivos SAT desde carpeta Drive
// ========================================


// Webhook endpoint para n8n


// Importar datos SAT
function importSATFromFolder() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetRaw = ss.getSheetByName('CFDI_SAT_RAW');
  const sheetClean = ss.getSheetByName('CFDI_SAT');
  
  // Limpiar datos - mantener solo encabezados fila 1
  const lastRowRaw = sheetRaw.getLastRow();
  const lastRowClean = sheetClean.getLastRow();
  
  if (lastRowRaw > 1) {
    sheetRaw.deleteRows(2, lastRowRaw - 1);
  }
  if (lastRowClean > 1) {
    sheetClean.deleteRows(2, lastRowClean - 1);
  }
  
  // Leer archivos SAT
  const folder = DriveApp.getFolderById(SAT_FOLDER_ID);
  const files = folder.getFiles();
  
  let totalRecords = 0;
  let filesProcessed = 0;
  
  while (files.hasNext()) {
    const file = files.next();
    const content = file.getBlob().getDataAsString();
    const lines = content.split('\n');
    
    // Saltar primera línea (encabezados)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      
      const fields = line.split('~');
      
      if (fields.length >= 11) {
        const uuid = fields[0];
        const rfcEmisor = fields[1];
        const nombreEmisor = fields[2];
        const fechaEmision = normalizeDate(fields[6]);
        const monto = parseFloat(fields[8].replace(/,/g, ''));
        const estatus = fields[10];
        
        const subtotal = monto / 1.16;
        const iva = monto - subtotal;
        
        sheetRaw.appendRow([
          uuid,
          rfcEmisor,
          nombreEmisor,
          fechaEmision,
          subtotal.toFixed(2),
          iva.toFixed(2),
          monto.toFixed(2),
          'MXN',
          '',
          fields[9] || 'I',
          estatus
        ]);
        
        totalRecords++;
      }
    }
    
    filesProcessed++;
  }
  
  // Copiar a hoja CFDI_SAT
  if (totalRecords > 0) {
    const dataRange = sheetRaw.getRange(2, 1, totalRecords, 11);
    const data = dataRange.getValues();
    
    data.forEach(row => {
      sheetClean.appendRow([...row, '']);
    });
  }
  
  // Eliminar duplicados
  const dupResult = detectAndRemoveDuplicates();
  
  // Notificación
  sendEmailNotificationImport(
    'Importación SAT Completada',
    `Se importaron ${totalRecords} registros de ${filesProcessed} archivos.\n` +
    `Duplicados eliminados: ${dupResult.duplicatesRemoved}`
  );
  
  return {
    success: true,
    totalRecords: totalRecords,
    filesProcessed: filesProcessed,
    duplicatesRemoved: dupResult.duplicatesRemoved,
    message: `Importación completada: ${totalRecords} registros de ${filesProcessed} archivos`
  };
}

// Detectar y eliminar duplicados
function detectAndRemoveDuplicates() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('CFDI_SAT');
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, duplicatesRemoved: 0 };
  
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const seen = {};
  const rowsToDelete = [];
  
  for (let i = 0; i < data.length; i++) {
    const uuid = data[i][0];
    if (seen[uuid]) {
      rowsToDelete.push(i + 2);
    } else {
      seen[uuid] = true;
    }
  }
  
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  return {
    success: true,
    duplicatesRemoved: rowsToDelete.length,
    message: `Se eliminaron ${rowsToDelete.length} duplicados`
  };
}

// Normalizar fecha
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

// Enviar email
function sendEmailNotificationImport(subject, body) {
  MailApp.sendEmail({
    to: EMAIL_NOTIFICATION,
    subject: `[AVECO Robot SAT] ${subject}`,
    body: body
  });
}
