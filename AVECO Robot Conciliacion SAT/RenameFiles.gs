// ========================================
// Script 1: RENOMBRAR ARCHIVOS SAT
// Formato: "mov sat YYMM - nombre_original"
// ========================================


// Webhook endpoint para n8n

// Función principal para renombrar archivos
function renameAllSATFiles() {
  const folder = DriveApp.getFolderById(SAT_FOLDER_ID);
  const files = folder.getFiles();
  
  let filesRenamed = 0;
  let filesSkipped = 0;
  const renamedList = [];
  
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    
    // Solo renombrar si NO empieza con "mov sat" (case insensitive)
    if (!fileName.toLowerCase().startsWith('mov sat')) {
      try {
        // Obtener año y mes de la fecha de creación
        const fileDate = file.getDateCreated();
        const year = fileDate.getFullYear().toString().substr(-2);
        const month = ('0' + (fileDate.getMonth() + 1)).slice(-2);
        const newName = 'mov sat ' + year + month + ' - ' + fileName;
        
        file.setName(newName);
        filesRenamed++;
        renamedList.push({ old: fileName, new: newName });
        
      } catch (error) {
        Logger.log('Error renombrando ' + fileName + ': ' + error);
      }
    } else {
      filesSkipped++;
    }
  }
  
  // Enviar notificación por email
  if (filesRenamed > 0) {
    sendEmailNotification(
      'Archivos SAT Renombrados',
      `Se renombraron ${filesRenamed} archivos.\n` +
      `Archivos omitidos (ya renombrados): ${filesSkipped}\n\n` +
      `Lista de archivos renombrados:\n` +
      renamedList.map(f => `- ${f.old} -> ${f.new}`).join('\n')
    );
  }
  
  return {
    success: true,
    filesRenamed: filesRenamed,
    filesSkipped: filesSkipped,
    message: `Renombrado completado: ${filesRenamed} archivos renombrados, ${filesSkipped} omitidos`
  };
}

// Enviar notificación por email
function sendEmailNotification(subject, body) {
  MailApp.sendEmail({
    to: EMAIL_NOTIFICATION,
    subject: `[AVECO Robot SAT] ${subject}`,
    body: body
  });
}
