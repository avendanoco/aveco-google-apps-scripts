# 🏦 AVECO Robot Movimientos Bancarios

**Versión:** 2.1.0  
**Autor:** Antonio Avendaño — [antonio.ac@aveco.mx](mailto:antonio.ac@aveco.mx)  
**Cuenta GWS:** aveco.bancos@aveco.mx  

Robot de Google Apps Script que importa, normaliza y deduplica movimientos bancarios de múltiples bancos desde carpetas de Google Drive hacia un Google Sheets de control.

---

## 📁 Estructura del proyecto

```
robot-movimientos-bancarios/
├── Code.gs           # Router HTTP (n8n), getConfig() centralizado
├── ImportBancos.gs   # Lógica de importación multibanco + notificaciones Discord
├── Deduplication.gs  # Deduplicación de movimientos por clave compuesta
└── README.md         # Este archivo
```

---

## ⚙️ Configuración inicial

### 1. Script Properties

En el editor de Apps Script: **Proyecto → Configuración → Script Properties**

| Propiedad | Descripción | Requerida |
|---|---|---|
| `SPREADSHEET_ID` | ID del Google Sheets de control | ✅ Sí |
| `BANCOS_FOLDER_ID` | ID de la carpeta padre de bancos en Drive | ✅ Sí |
| `DISCORD_WEBHOOK_URL` | Webhook del canal de Discord para notificaciones | ⚠️ Recomendada |

### 2. Hojas requeridas en el Spreadsheet

| Hoja | Uso |
|---|---|
| `MOVIMIENTOS_BANCARIOS_RAW` | Datos crudos importados de bancos |
| `MOVIMIENTOS_BANCARIOS` | Datos limpios y deduplicados |

### 3. Estructura de carpetas en Drive

```
📁 [BANCOS_FOLDER_ID]/
├── 📁 TD FONDEADORA/   → archivos CSV/Sheets de Fondeadora
├── 📁 TC KONFIO/       → archivos CSV/Sheets de Konfio
├── 📁 TC CLARA/        → archivos CSV/Sheets de Clara
├── 📁 TD SANTANDER/    → archivos CSV/Sheets de Santander
├── 📁 TD BBVA/         → archivos TSV de BBVA
└── 📁 TD BASE MXN/     → otros bancos compatibles
```

> Los nombres de carpeta deben coincidir exactamente con las claves en `BANK_CONFIG` (mayúsculas).

---

## 🚀 Uso

### Manual (desde Apps Script)

```javascript
importAllBankMovements()     // Importar todos los bancos
detectAndRemoveDuplicates()  // Deduplicar movimientos
```

### Funciones de prueba

```javascript
testDiscordNotification()         // Validar webhook Discord
testDoPostImportBancos()          // Simular llamada n8n - importar
testDoPostDetectDuplicates()      // Simular llamada n8n - deduplicar
testDetectAndRemoveDuplicates()   // Probar deduplicación directamente
```

### Vía HTTP / n8n

**POST** `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`

```json
{ "action": "importBancos" }
{ "action": "detectDuplicates" }
```

**Respuesta ejemplo:**
```json
{
  "success": true,
  "totalMovimientos": 245,
  "action": "importBancos",
  "durationMs": 3420
}
```

---

## 🏛️ Bancos soportados

| Banco | Tipo | Formato |
|---|---|---|
| TD FONDEADORA | Débito | CSV / Google Sheets |
| TC KONFIO | Crédito | CSV |
| TC CLARA | Crédito | CSV |
| TD SANTANDER | Débito | CSV |
| TD BBVA | Débito | TSV (tabulaciones) |
| TD BASE MXN | Débito | CSV |
| TD BASE USD | Débito | CSV |
| TD DOLAR MXN | Débito | CSV |
| TD DOLAR USD | Débito | CSV |

---

## 🔔 Notificaciones Discord

El robot envía embeds a Discord con color por estado:

- 🟢 **Verde** — Importación exitosa con movimientos
- 🟡 **Amarillo** — Importación sin datos encontrados
- 🔴 **Rojo** — Error en importación, deduplicación o endpoint

---

## 📋 Columnas de salida (MOVIMIENTOS_BANCARIOS_RAW)

| Col | Campo | Descripción |
|---|---|---|
| A | banco | Nombre del banco |
| B | fecha | Fecha del movimiento |
| C | descripcion | Descripción / concepto |
| D | referencia | Referencia o cuenta |
| E | cargo | Monto de cargo |
| F | abono | Monto de abono |
| G | saldo | Saldo resultante |
| H | categoria | Categoría (manual/automática) |
| I | obra | Proyecto asignado |
| J | link_cfdi | Link a CFDI relacionado |
| K | archivo_origen | Nombre del archivo fuente |
