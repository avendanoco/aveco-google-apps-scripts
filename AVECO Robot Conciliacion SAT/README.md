# 🤖 AVECO Robot Conciliacion SAT

> **Versión:** 1.0.0  
> **Autor:** Antonio Avendaño (antonio.ac@aveco.mx)  
> **Cuenta GWS:** aveco.bancos@gmail.com  
> **Repositorio:** aveco-google-apps-scripts / AVECO Robot Conciliacion SAT  
> **Creado:** 2025-01  
> **Actualizado:** 2025-05  

---

## 📋 Descripción

Robot de conciliación contable-fiscal que importa, normaliza, categoriza y consolida CFDIs del SAT y movimientos bancarios en un Google Sheets centralizado (DataLake AVECO). Expone un endpoint HTTP para integración con n8n y ofrece un menú de operaciones desde la hoja de cálculo.

**Proyecto Apps Script ID:** `15jHH5sET-bgE29uwED_YVjumXt3s-4YESfiLfANBuhyq1HFyEIBc820c`  
**Spreadsheet ID:** `1ZRtRjgKAbeYXywV0cbVf73UzjYNgC-n6gmcOg9j3R8c`

---

## 🗂️ Estructura del Proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Router HTTP principal (`doPost`), configuración centralizada `CONFIG` con IDs de hojas y acciones disponibles |
| `RenameFiles.gs` | Renombrado automático de archivos XML/PDF del SAT desde Google Drive siguiendo nomenclatura AVECO |
| `ImportData.gs` | Importación de CFDIs SAT desde carpeta Drive a hoja `CFDI_SAT_RAW`, deduplicación por UUID y normalización de fechas |
| `BancosNormalizacion.gs` | Normalización de movimientos bancarios desde `MOVIMIENTOS_BANCARIOS` hacia `Movimientos_Maestros`, deduplicación por ID interno |
| `Categorizacion.gs` | Categorización automática inteligente de movimientos: keyword matching contra `Catalogo_Categorias` + aprendizaje desde historial `BOARD_NORMALIZADO` |
| `BoardExport.gs` | Exportación de movimientos maestros al board de revisión `BOARD_NORMALIZADO` con formato estandarizado |
| `Menu.gs` | Menú de operaciones en Google Sheets para ejecución manual de todas las funciones del robot |
| `AdvancedFeatures.gs` | Funcionalidades avanzadas: detección de transferencias internas, análisis de patrones y ML mejorado |
| `CharlyEndpoint.gs` | Endpoint extendido para el agente Charly (n8n/IA): sesiones, consultas contextuales y respuestas estructuradas |
| `README.md` | Documentación del proyecto |

---

## ⚙️ Configuración Inicial

### Script Properties requeridas

En Apps Script → Configuración del proyecto → Propiedades del script:

| Propiedad | Descripción | Ejemplo |
|---|---|---|
| `SPREADSHEET_ID` | ID del Google Sheets DataLake | `1ZRtRjgKAbeYXywV0cbVf73UzjYNgC-n6gmcOg9j3R8c` |
| `SAT_FOLDER_ID` | ID carpeta Drive con XMLs SAT | ID de la carpeta en Drive |
| `EMAIL_NOTIFICATION` | Email para notificaciones | `antonio.ac@aveco.mx` |
| `DISCORD_WEBHOOK_URL` | Webhook Discord para alertas | URL del webhook |

> ⚠️ **Seguridad:** Nunca hardcodear tokens o IDs sensibles en el código. Usar siempre `PropertiesService.getScriptProperties()`.

### Hojas requeridas en el Spreadsheet

| Hoja | Propósito |
|---|---|
| `CFDI_SAT` | CFDIs limpios/procesados del SAT |
| `CFDI_SAT_RAW` | CFDIs crudos importados (staging) |
| `BOARD_NORMALIZADO` | Board de revisión y categorización |
| `MOVIMIENTOS_BANCARIOS` | Movimientos bancarios crudos |
| `Movimientos_Maestros` | Movimientos normalizados maestros |
| `Sesiones_Charly` | Sesiones del agente Charly |
| `Revision_Humana` | Cola de revisión manual |
| `Catalogo_Cuentas` | Catálogo de cuentas contables |
| `Catalogo_Obras` | Catálogo de obras/proyectos |
| `Catalogo_Categorias` | Catálogo de categorías con keywords |
| `Estandares_Board` | Estándares y reglas del board |

---

## 🚀 Triggers y Ejecución

Este proyecto **no usa triggers automáticos configurados**. La ejecución ocurre de tres formas:

### 1. Manual — Menú en Sheets

Al abrir el Spreadsheet, aparece el menú **"🤖 AVECO Robot"** con las siguientes opciones:

- Importar CFDIs SAT
- Normalizar Bancos
- Categorizar Movimientos
- Exportar a Board
- Renombrar Archivos SAT
- Funciones Avanzadas

### 2. HTTP / n8n (Web App)

El script se despliega como **Web App** (doPost). Desde n8n u otro orquestador, se envía un POST con:

```json
{
  "action": "<nombre_accion>",
  "params": {}
}
```

**Acciones disponibles:**

| Acción | Función | Descripción |
|---|---|---|
| `importSAT` | `importSATFromFolder()` | Importa CFDIs desde Drive |
| `normalizarBancos` | `normalizarMovimientosBancarios()` | Normaliza movimientos bancarios |
| `categorizarMovimientos` | `categorizarMovimientos()` | Categoriza automáticamente |
| `exportarBoard` | `exportarABoard()` | Exporta al board de revisión |
| `renameFiles` | `renameFilesInFolder()` | Renombra archivos SAT |
| `charly` | `handleCharlyRequest()` | Endpoint agente Charly |

### 3. Prueba manual en Editor

Cada módulo tiene función de prueba directa:
- `testImportSAT()`
- `testNormalizarBancos()`
- `testCategorizarMovimientos()`

---

## 🔧 Instalación

1. Abre [script.google.com](https://script.google.com) → tu proyecto AVECO
2. Copia cada archivo `.gs` en su respectivo archivo del editor
3. Configura las **Script Properties** indicadas arriba
4. Despliega como **Aplicación web:**
   - Tipo: Aplicación web
   - Ejecutar como: Yo (`aveco.bancos@gmail.com`)
   - Acceso: Cualquier usuario (para integración con n8n)
5. Copia la URL del Web App y configúrala en los workflows de n8n

---

## 📬 Notificaciones

- **Discord:** Alertas de errores críticos y resúmenes de ejecución vía webhook embed
- **Email:** Notificaciones de importación exitosa a `EMAIL_NOTIFICATION`
- **Logger:** Logs internos en Execution Log de Apps Script

---

## 🔗 Dependencias

- Google Sheets API (nativa Apps Script)
- Google Drive API (nativa Apps Script)
- MailApp (nativa Apps Script)
- UrlfetchApp para webhooks Discord
- Sin librerías externas adicionales

---

## 📝 Notas de Seguridad

- El `SPREADSHEET_ID` está hardcodeado en `CONFIG` por compatibilidad; se recomienda moverlo a Script Properties en producción
- El endpoint HTTP es público (`Cualquier usuario`) — proteger con token si se expone externamente
- Los XMLs del SAT contienen RFC y datos fiscales sensibles — la carpeta Drive debe tener acceso restringido
