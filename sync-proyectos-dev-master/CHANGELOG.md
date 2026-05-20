# CHANGELOG — AVECO Sync Proyectos Dev → Master

---

## [3.1.0] — 2026-05-20

### Cambios
- **Modo espejo estricto:** los archivos y carpetas huérfanos (cuyo origen ya no existe en el Drive del desarrollador) se envían directo a la papelera de Drive (`setTrashed(true)`). Sin carpeta intermedia de eliminados.
- Se agrega campo `SRC_ID` en la descripción de cada archivo copiado y `SRC_FOLDER_ID` en carpetas creadas, para poder identificar huérfanos en ejecuciones futuras.
- Columna `Enviados a papelera` en `SyncLogs`.

---

## [3.0.0] — 2026-05-20

### Cambios
- Modo espejo con carpeta `__ELIMINADOS_DESARROLLADOR` como red de seguridad (reemplazado en v3.1.0).

---

## [2.0.0] — 2026-05-20

### Cambios
- Sync recursivo de carpetas y subcarpetas completo (no solo archivos raíz).
- Creación automática de carpeta madre en destino con el mismo nombre del proyecto Dev.
- Mapping por ID con Script Properties para evitar duplicados.

---

## [1.3.0] — 2026-05-20

### Cambios
- Hoja `SyncLogs` creada automáticamente con headers, formato y filtro.
- Log histórico por ejecución (fecha, duración, proyectos, nuevos, actualizados, advertencias, detalles).
- Función `showLastSyncLog()` en menú para ver último log sin abrir la hoja.

---

## [1.2.0] — 2026-05-20

### Cambios
- Webhook de Discord configurado desde menú interactivo (`configureDiscordWebhook()`) usando `ui.prompt()`.
- Se elimina columna de webhook de la hoja `SyncProyectos`.

---

## [1.1.0] — 2026-05-20

### Cambios
- Función `setupSyncSheet()` que crea y formatea automáticamente la hoja `SyncProyectos`.
- Checkboxes automáticos en columna Activo.
- Filtro aplicado a la tabla desde la primera fila.
- Columnas de solo 3 campos editables: Nombre Proyecto, Dev Folder URL, Master Folder URL.

---

## [1.0.0] — 2026-05-20

### Primera versión
- Sincronización unidireccional Dev → Master (sin recursividad).
- Solo archivos de la carpeta raíz.
- Notificaciones Discord (éxito, warning, error).
- Configuración por Script Properties.
