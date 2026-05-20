# 🔁 AVECO Sync Proyectos Dev → Master

> **Versión:** 3.1.0  
> **Cuenta GWS:** antonio.ac@aveco.mx  
> **Repositorio:** [aveco-google-apps-scripts](https://github.com/avendanoco/aveco-google-apps-scripts)  
> **Carpeta:** `sync-proyectos-dev-master/`

---

## ¿Qué hace este script?

Este script de Google Apps Script sincroniza automáticamente carpetas de Google Drive de múltiples **desarrolladores/constructores** hacia una **carpeta maestra AVECO**, controlado desde una hoja de Google Sheets.

El modo es **ESPEJO ESTRICTO**:

| Evento en carpeta del Desarrollador | Resultado en carpeta Master AVECO |
|--------------------------------------|-----------------------------------|
| Archivo nuevo | Se copia automáticamente |
| Archivo modificado (fecha/tamaño) | Se reemplaza la copia destino |
| Archivo borrado o movido fuera | La copia destino se envía a la **papelera de Drive** |
| Carpeta nueva (subcarpetas incluidas) | Se replica la estructura completa |
| Carpeta borrada o movida fuera | La carpeta destino se envía a la **papelera de Drive** |

> ⚠️ **Sin red de seguridad.** Si el desarrollador borra algo, también desaparece de tu master en el siguiente sync. Recupera desde la papelera de Drive si fue por error.

---

## Estructura de archivos

```
sync-proyectos-dev-master/
├── AVECO_SyncProyectos_v3.1.0.gs   # Script principal (Apps Script)
├── README.md                        # Esta documentación
└── CHANGELOG.md                     # Historial de versiones
```

---

## Hojas generadas en Google Sheets

### SyncProyectos

Tabla de configuración por proyecto. Se crea automáticamente.

| Col | Header | Tipo | Descripción |
|-----|--------|------|-------------|
| A | Activo | Checkbox | Si está marcado, se sincroniza esa fila |
| B | Nombre Proyecto | Editable | Nombre del proyecto |
| C | Dev Folder URL | Editable | URL de la carpeta del desarrollador (origen) |
| D | Dev Folder ID | Auto | ID extraído o rellenado automáticamente |
| E | Master Folder URL | Editable | URL de la carpeta destino (maestra AVECO) |
| F | Master Folder ID | Auto | ID extraído o rellenado automáticamente |
| G | Última Sync | Auto | Timestamp de la última ejecución |
| H | Nota / Log | Auto | Resultado de la última sync por proyecto |

> **Columnas editables obligatorias:** B (Nombre Proyecto), C (Dev Folder URL), E (Master Folder URL).

### SyncLogs

Histórico de ejecuciones. Se crea automáticamente.

| Col | Header | Descripción |
|-----|--------|-------------|
| A | Fecha Hora | Timestamp de ejecución |
| B | Duración (s) | Segundos que tardó el sync |
| C | Proyectos procesados | Número de filas activas procesadas |
| D | Archivos nuevos | Total de archivos copiados |
| E | Archivos actualizados | Total de archivos reemplazados |
| F | Enviados a papelera | Total de archivos/carpetas borrados del espejo |
| G | Advertencias | Mensajes de error por fila |
| H | Detalles | Resumen por proyecto |

---

## Menú en Google Sheets

```
🔁 AVECO Sync
├── Configurar hoja SyncProyectos
├── Configurar Discord Webhook
├── ─────────────────────────────
├── Ejecutar sync Dev → Master (Espejo estricto)
├── Ver último log de ejecución
├── ─────────────────────────────
└── Probar notificación
```

---

## Configuración inicial (paso a paso)

### 1. Crear el proyecto en Apps Script

1. Abre el Google Sheet donde quieres instalar el sync.
2. Ve a **Extensiones → Apps Script**.
3. Elimina el código por defecto y pega el contenido completo de `AVECO_SyncProyectos_v3.1.0.gs`.
4. Guarda el proyecto con el nombre `AVECO Sync Proyectos`.
5. Cierra el editor y **recarga la hoja**.

### 2. Configurar la hoja

1. En el menú de la hoja verás **🔁 AVECO Sync**.
2. Ve a **Configurar hoja SyncProyectos**.
3. Se crearán automáticamente las hojas `SyncProyectos` y `SyncLogs` con todas las columnas y formato.

### 3. Agregar proyectos

En la hoja `SyncProyectos`, para cada desarrollador:

1. Marca el checkbox en **Activo** (col A).
2. Escribe el **Nombre Proyecto** (col B).
3. Pega la **URL de la carpeta del desarrollador** en col C.
   - Ejemplo: `https://drive.google.com/drive/folders/XXXXXXXXXXXX`
4. Pega la **URL de tu carpeta maestra** en col E.
   - Esta es la carpeta raíz donde se creará la subcarpeta del proyecto.

> Los campos D (Dev Folder ID) y F (Master Folder ID) se llenan automáticamente en el primer sync.

### 4. Configurar Discord Webhook

1. Ve a **🔁 AVECO Sync → Configurar Discord Webhook**.
2. Pega tu webhook URL.
3. El webhook se guarda en Script Properties de forma segura (no en el código).

Para obtener un webhook en Discord:
- Canal → Editar canal → Integraciones → Webhooks → Crear Webhook → Copiar URL.

### 5. Crear trigger automático

1. En Apps Script ve a **Triggers** (ícono de reloj en el menú izquierdo).
2. Clic en **+ Agregar trigger**.
3. Configuración:
   - **Función:** `runSyncDevToMaster`
   - **Tipo de evento:** Time-driven
   - **Intervalo:** Every 15 minutes o Every 30 minutes
4. Guarda.

---

## Comportamiento del espejo estricto

### Archivos nuevos
Cada archivo copiado recibe en su campo `description` el texto `SRC_ID:<ID_origen>`. Esto permite que el script reconozca el origen del archivo en ejecuciones futuras y sepa si ese origen sigue existiendo.

### Carpetas nuevas
Cada carpeta creada en el destino recibe `SRC_FOLDER_ID:<ID_origen>` en su descripción.

### Limpieza de huérfanos
Después de cada sync, el script recorre el árbol destino del proyecto. Si encuentra un archivo o carpeta con `SRC_ID` o `SRC_FOLDER_ID` cuyo origen ya no apareció en el scan del Dev → lo envía directo a la papelera (`setTrashed(true)`).

> Los archivos en papelera se pueden recuperar desde Google Drive → Papelera, mientras Google no los purgue definitivamente (30 días por defecto).

---

## Script Properties utilizadas

| Clave | Descripción |
|-------|-------------|
| `DISCORD_WEBHOOK_URL` | URL del webhook de Discord para notificaciones |
| `SYNC_SHEET_NAME` | Nombre de la hoja de configuración (default: `SyncProyectos`) |
| `SYNC_LOG_SHEET_NAME` | Nombre de la hoja de logs (default: `SyncLogs`) |
| `SYNC_FOLDER_DEV_MASTER_<ID>` | Mapping ID carpeta origen → ID carpeta destino |
| `SYNC_FILE_DEV_MASTER_<folder_src>-><folder_dst>_<file_src>` | Mapping ID archivo origen → ID archivo destino |

---

## Notificaciones Discord

El script envía un embed a tu canal de Discord al terminar cada ejecución:

- ✅ Verde: sync completado sin errores.
- ⚠️ Amarillo: sync completado con advertencias (alguna fila con error).
- ❌ Rojo: error crítico (no se encontró la hoja de configuración).

Cada embed incluye: proyectos procesados, archivos nuevos, actualizados, enviados a papelera, duración y detalle por proyecto.

---

## Limitaciones y consideraciones

| Limitación | Detalle |
|------------|----------|
| Tiempo de ejecución | Apps Script tiene límite de 6 min por ejecución. Proyectos con miles de archivos pueden excederlo. |
| Permisos de Drive | El script solo puede acceder a carpetas compartidas contigo con permiso de **lector** (para copiar) o **editor** (si el Drive es tuyo). |
| Drives externos | Las carpetas de desarrolladores deben estar **compartidas contigo** en Google Drive (añadidas a "Mi unidad" o "Compartido conmigo"). |
| Limpieza de huérfanos | Solo detecta huérfanos marcados con `SRC_ID` / `SRC_FOLDER_ID` en descripción. Archivos copiados manualmente en la carpeta master NO se tocarán. |
| Papelera | Google Drive vacía la papelera automáticamente a los 30 días. |

---

## Preguntas frecuentes

**¿Qué pasa si el desarrollador renombra una carpeta?**  
El script creará una nueva carpeta con el nuevo nombre y enviará la carpeta antigua a la papelera en el siguiente sync (porque su `SRC_FOLDER_ID` ya no aparece en el scan).

**¿Qué pasa si yo agrego archivos manualmente en la carpeta master?**  
Si no tienen `SRC_ID` en la descripción, el script los ignora y no los borra.

**¿Puedo tener múltiples proyectos de distintos desarrolladores?**  
Sí. Agrega una fila por proyecto en `SyncProyectos`. Cada fila puede tener su propia carpeta Dev y su propia carpeta Master.

**¿Puedo desactivar un proyecto sin borrarlo?**  
Sí. Desactiva el checkbox en la columna A. El script omitirá esa fila.

---

## Contacto

**AVECO Arquitectura Avanzada en Ecología y Construcción**  
antonio.ac@aveco.mx
