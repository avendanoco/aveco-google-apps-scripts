# Lineamientos de diseño para Google Apps Script en AVECO

## Propósito
Este documento define el estándar interno para diseñar, documentar, desarrollar y mantener scripts de Google Apps Script en AVECO. El objetivo es que cada nuevo script sea más claro, seguro, mantenible, reutilizable y consistente entre cuentas, proyectos y repositorios.

También establece como práctica por defecto el uso de notificaciones operativas por Discord cuando el script tenga eventos relevantes, errores, cambios de estado o monitoreo de procesos.

---

## Principios base

- Diseñar scripts para operación real, no solo para que "funcionen una vez".
- Priorizar mantenibilidad, trazabilidad y claridad antes que atajos rápidos.
- Separar configuración, lógica de negocio, utilidades y notificaciones.
- Evitar secretos en el código fuente.
- Dejar contexto suficiente para saber a qué cuenta pertenece el script, qué hace y cómo se despliega.
- Diseñar pensando en triggers, errores, reintentos y uso futuro.
- Dejar funciones de prueba controladas para validar el script sin alterar producción.

---

## Estándar de encabezado obligatorio

Todo script nuevo debe iniciar con un bloque descriptivo al principio.

```javascript
/**
 * ============================================================
 * NOMBRE DEL SCRIPT
 * ============================================================
 * Proyecto   : Nombre del proyecto
 * Versión    : 1.0.0
 * Cuenta GWS : correo@cuenta.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : YYYY-MM-DD
 * Actualizado: YYYY-MM-DD
 *
 * Descripción:
 *   Explicación breve de qué hace el script.
 *
 * CONFIGURACIÓN INICIAL:
 *   1. Qué credenciales necesita
 *   2. Qué propiedades hay que crear
 *   3. Qué trigger hay que configurar
 *
 * NOTAS DE SEGURIDAD:
 *   - No guardar secretos en el código
 *   - Usar Script Properties
 * ============================================================
 */
```

### Reglas del encabezado
- Incluir siempre `Proyecto`, `Versión`, `Cuenta GWS`, `Autor` y `Repositorio`.
- `Cuenta GWS` es obligatoria para identificar la cuenta dueña del script cuando existan múltiples correos.
- Mantener `Versión` con semántica simple: `major.minor.patch`.
- Actualizar `Actualizado` cada vez que se cambie lógica, configuración o despliegue.
- Si el script depende de una hoja, carpeta, webhook o API externa, mencionarlo en la descripción o configuración inicial.

---

## Convenciones de arquitectura

### 1. Separar configuración de la lógica
Usar una función `getConfig()` para centralizar parámetros y propiedades.

```javascript
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    folderId: props.getProperty('DRIVE_FOLDER_ID') || 'TU_FOLDER_ID_AQUI',
    webhookUrl: props.getProperty('DISCORD_WEBHOOK_URL') || 'PEGA_AQUI_WEBHOOK',
    folderLabel: props.getProperty('FOLDER_LABEL') || 'Nombre Carpeta'
  };
}
```

### 2. Estructura sugerida por script
Orden recomendado dentro del archivo:

1. Encabezado
2. Configuración (`getConfig`)
3. Función principal
4. Funciones de integración externa
5. Utilidades
6. Funciones de prueba manual

### 3. Una función principal clara
Cada script debe tener una función principal con nombre explícito, por ejemplo:

- `checkFolderAndNotify()`
- `syncSheetWithCRM()`
- `generateWeeklyReport()`
- `sendInvoiceReminders()`

### 4. Utilidades privadas con sufijo `_`
Las funciones internas auxiliares deben terminar con `_` para indicar uso interno.

Ejemplos:
- `sendDiscordEmbed_()`
- `formatBytes_()`
- `buildPayload_()`
- `parseInvoiceRow_()`

---

## Convenciones de nombres

### Constantes
- Usar `UPPER_SNAKE_CASE` solo para constantes realmente fijas.
- Si la configuración puede cambiar por entorno o cuenta, moverla a `Script Properties`.

### Funciones y variables
- Usar `camelCase`.
- Evitar nombres genéricos como `data`, `temp`, `test2`, `funcionNueva`.
- Preferir nombres de intención: `lastCheck`, `newFiles`, `webhookUrl`, `invoiceRows`, `projectSheet`.

### Propiedades del script
Usar claves claras, consistentes y en inglés técnico.

Ejemplos:
- `DISCORD_WEBHOOK_URL`
- `DRIVE_FOLDER_ID`
- `FOLDER_LABEL`
- `LAST_SUCCESSFUL_SYNC`
- `ADMIN_EMAIL`
- `SPREADSHEET_ID`

---

## Seguridad y manejo de credenciales

### Reglas obligatorias
- No guardar tokens, API keys, webhooks ni secretos en el código final.
- Guardar credenciales en `PropertiesService.getScriptProperties()`.
- Si se usa fallback hardcodeado para pruebas, debe quedar marcado como temporal.
- Antes de subir a GitHub, reemplazar secretos por placeholders.

### Ejemplo recomendado
```javascript
const props = PropertiesService.getScriptProperties();
const webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');

if (!webhookUrl) {
  throw new Error('Falta configurar DISCORD_WEBHOOK_URL en Script Properties');
}
```

### Nunca hacer
- Commits con tokens reales.
- Webhooks de Discord en texto plano en GitHub.
- IDs sensibles sin contexto.
- Código compartido sin limpiar secretos.

---

## Notificaciones por Discord: estándar por defecto

Todo script operativo nuevo debe evaluar si requiere una notificación a Discord. En AVECO, Discord se considera el canal estándar para alertas y monitoreo ligero.

### Cuándo usar Discord
- Nuevos archivos detectados.
- Errores críticos.
- Procesos terminados.
- Fallos de sincronización.
- Resúmenes diarios o semanales.
- Alertas de validación de datos.
- Cambios de estado relevantes.

### Reglas para notificaciones
- Usar Webhooks, no tokens de bot, salvo que exista una necesidad específica.
- Preferir `embeds` sobre texto plano cuando haya contexto estructurado.
- Incluir nombre del proyecto o proceso.
- Incluir timestamp.
- Incluir conteo, estado y vínculos relevantes cuando aplique.
- Mantener mensajes legibles y accionables.
- Limitar volumen para evitar ruido.

### Estructura recomendada del webhook
```javascript
function sendDiscordEmbed_(title, description, fields) {
  const config = getConfig();
  const payload = JSON.stringify({
    username: 'AVECO Bot',
    embeds: [{
      title: title,
      description: description,
      color: 5793266,
      fields: fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'AVECO • Google Apps Script' }
    }]
  });

  UrlFetchApp.fetch(config.webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  });
}
```

### Buenas prácticas para el contenido del mensaje
- Un título claro: `📁 Nuevos archivos detectados`, `❌ Error de sincronización`, `✅ Reporte generado`.
- Campos cortos y útiles.
- Máximo contexto con mínimo ruido.
- Si hay listas largas, truncar y mostrar resumen.

---

## Manejo de errores

### Principios
- Todo acceso a APIs o servicios externos debe ir en `try/catch`.
- Registrar errores con `Logger.log()` o notificación si el fallo es operativo.
- No dejar errores silenciosos.
- Definir cuándo un error debe detener el flujo y cuándo solo debe registrarse.

### Patrón recomendado
```javascript
try {
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code !== 200 && code !== 204) {
    Logger.log('Respuesta inesperada: ' + code + ' - ' + response.getContentText());
    return false;
  }

  return true;
} catch (e) {
  Logger.log('Error en petición externa: ' + e.message);
  return false;
}
```

### Cuándo notificar error a Discord
- Cuando falle una automatización importante.
- Cuando el trigger siga corriendo pero el proceso no complete.
- Cuando se detecte una inconsistencia crítica.
- Cuando falle la lectura de una carpeta, spreadsheet, API o recurso central.

---

## Estado persistente y trazabilidad

Cuando el script corre por trigger o procesa eventos repetidos, debe guardar estado para evitar duplicados o ambigüedad.

### Opciones recomendadas
- `Script Properties` para timestamps, flags, IDs y estados globales.
- Hojas de control si se requiere auditoría visible o historial amplio.

### Ejemplos de uso
- `lastCheck`
- `LAST_SUCCESSFUL_SYNC`
- `LAST_PROCESSED_ROW`
- `LAST_REPORT_DATE`

### Regla clave
Si el script depende del tiempo o de incrementalidad, guardar y documentar claramente la última ejecución útil.

---

## Triggers y ejecución programada

### Buenas prácticas
- Diseñar el script pensando desde el inicio en ejecución automática.
- Documentar qué trigger necesita.
- Evitar asumir ejecución manual.
- No mezclar funciones de prueba con funciones de producción.

### Recomendación operativa
- Crear una función principal para trigger.
- Crear una función `test...()` para validación manual.
- Documentar frecuencia sugerida: cada 5 min, cada hora, diario, etc.

### Ejemplo
```javascript
function testNotification() {
  // prueba manual controlada
}
```

---

## Diseño de funciones de prueba

Todo script importante debe incluir al menos una función de prueba manual segura.

### Objetivo
- Validar conectividad.
- Probar formato de notificación.
- Confirmar acceso a Drive, Sheets o API.
- Reducir incertidumbre antes de activar triggers.

### Reglas
- No alterar datos reales si no es necesario.
- Usar datos simulados o controlados cuando aplique.
- Nombrarlas claramente: `testNotification()`, `testConnection()`, `testDriveAccess()`.
- Nunca usar la función de prueba como trigger.

---

## Estándar de documentación interna

Cada script debe responder claramente estas preguntas desde el propio archivo:

- ¿Qué hace?
- ¿Para qué proyecto es?
- ¿A qué cuenta de Google pertenece?
- ¿Qué propiedades necesita?
- ¿Qué trigger usa?
- ¿Qué dependencias externas tiene?
- ¿Cómo se prueba?
- ¿A dónde notifica?

Si alguna de esas preguntas no se puede responder rápido leyendo el encabezado, la documentación está incompleta.

---

## Estándar para GitHub

### Reglas del repositorio
- Subir solo versiones limpias, sin secretos.
- Usar nombres de archivo descriptivos.
- Agrupar scripts por dominio o módulo.
- Mantener consistencia de carpetas.

### Estructura de carpetas recomendada
```text
aveco-google-apps-scripts/
  docs/               ← lineamientos y documentación transversal
  drive-manager/
  sheets-automation/
  reporting/
  invoicing/
```

### Convención de nombres de archivo
- `monitor-carpeta-discord.gs`
- `sync-crm-clientes.gs`
- `reporte-semanal-obra.gs`
- `recordatorio-facturas-vencidas.gs`

### Mensajes de commit recomendados
- `feat: agregar monitor de carpeta Drive con notificaciones a Discord`
- `fix: corregir validación de filas vacías en reporte semanal`
- `refactor: mover credenciales a Script Properties`
- `docs: agregar lineamientos de diseño para Google Apps Script`

---

## Calidad de código

### Reglas
- Una función debe tener una responsabilidad principal.
- Evitar bloques excesivamente largos.
- Reutilizar utilidades comunes.
- Preferir claridad sobre complejidad "elegante".
- Comentar solo donde aporte contexto real.
- No saturar el código con comentarios obvios.

### Comentarios que sí valen la pena
- Motivo de una decisión de negocio.
- Restricción de API.
- Riesgo operativo.
- Supuesto importante.
- Dependencia con otra cuenta, carpeta o sistema.

---

## Checklist antes de activar producción

### Seguridad
- [ ] No hay secretos en el archivo.
- [ ] Todo secreto vive en Script Properties.
- [ ] Los placeholders están claros.

### Operación
- [ ] La función principal corre sin errores.
- [ ] Existe función de prueba manual.
- [ ] El trigger correcto está documentado.
- [ ] El script registra logs útiles.

### Notificaciones
- [ ] El Webhook de Discord está configurado.
- [ ] El mensaje es claro y accionable.
- [ ] El volumen de alertas no generará ruido.

### Documentación
- [ ] El encabezado está completo.
- [ ] La cuenta GWS está indicada.
- [ ] El repositorio está indicado.
- [ ] La versión fue actualizada.

### GitHub
- [ ] El archivo tiene nombre descriptivo.
- [ ] El commit message es claro.
- [ ] No se subieron datos sensibles.

---

## Plantilla base recomendada

```javascript
/**
 * ============================================================
 * NOMBRE DEL SCRIPT
 * ============================================================
 * Proyecto   : Nombre del proyecto
 * Versión    : 1.0.0
 * Cuenta GWS : correo@cuenta.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : YYYY-MM-DD
 * Actualizado: YYYY-MM-DD
 *
 * Descripción:
 *   Qué hace el script.
 * ============================================================
 */

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    discordWebhookUrl: props.getProperty('DISCORD_WEBHOOK_URL') || 'PEGA_AQUI_WEBHOOK'
  };
}

function mainProcess() {
  const config = getConfig();

  try {
    // lógica principal
    notifyDiscordSuccess_('Proceso completado', 'El script terminó correctamente');
  } catch (e) {
    Logger.log('Error: ' + e.message);
    notifyDiscordError_('Error de ejecución', e.message);
  }
}

function notifyDiscordSuccess_(title, description) {
  sendDiscordEmbed_(title, description, 5793266); // Verde
}

function notifyDiscordError_(title, description) {
  sendDiscordEmbed_(title, description, 15548997); // Rojo
}

function sendDiscordEmbed_(title, description, color) {
  const config = getConfig();
  const payload = JSON.stringify({
    username: 'AVECO Bot',
    embeds: [{
      title: title,
      description: description,
      color: color,
      timestamp: new Date().toISOString(),
      footer: { text: 'AVECO • Google Apps Script' }
    }]
  });

  UrlFetchApp.fetch(config.discordWebhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  });
}

function testMainProcess() {
  mainProcess();
}
```

---

## Prompt base sugerido para futuros scripts

Usar este prompt como arranque para nuevos desarrollos con AI:

```text
Crea un Google Apps Script siguiendo los lineamientos de diseño de AVECO.
Instruye al AI con: github.com/avendanoco/aveco-google-apps-scripts/blob/main/docs/LINEAMIENTOS.md

Incluye:
- Encabezado completo con Proyecto, Versión, Cuenta GWS, Autor y Repositorio
- Configuración centralizada con getConfig()
- Uso de Script Properties para secretos
- Manejo de errores con try/catch
- Función principal clara
- Función de prueba manual
- Notificación por Discord (éxito y error) como estándar operativo
- Código listo para subir a GitHub sin secretos reales
```

---

## Mejora continua

Este documento debe actualizarse cada vez que se detecte una nueva buena práctica, patrón reutilizable, error recurrente o necesidad operativa.

### Tipos de mejoras que vale la pena agregar
- Nuevos patrones de notificación.
- Estándares de integración con Sheets, Drive, Gmail o APIs externas.
- Estructuras por tipo de script.
- Templates especializados por caso de uso.
- Reglas de auditoría, logs y observabilidad.

### Regla práctica
Si durante un proyecto aparece una decisión que "deberíamos repetir siempre", se agrega a este documento.

---

## Estado del estándar

| Campo | Valor |
|---|---|
| Versión | 1.0.0 |
| Fecha | 2026-05-18 |
| Propietario | Antonio Avendaño / AVECO |
| Repositorio | [aveco-google-apps-scripts](https://github.com/avendanoco/aveco-google-apps-scripts) |
| Uso previsto | Diseño, generación, revisión y mantenimiento de Google Apps Scripts en múltiples cuentas GWS |
