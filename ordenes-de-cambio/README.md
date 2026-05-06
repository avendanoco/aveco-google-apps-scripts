# Sistema de Ordenes de Cambio

Google Apps Script para la gestion automatizada de Ordenes de Cambio (OC) en Google Sheets.
Desarrollado para **Jungle Habitas / AVECO**.

## Arquitectura

El sistema utiliza un **Spreadsheet maestro** que actua como panel de control y genera archivos individuales por cada orden de cambio en una carpeta de Google Drive.

```
Spreadsheet Maestro
├── Hoja: PLANTILLA    → Formato base (nunca se modifica)
└── Hoja: REGISTRO     → Indice maestro con todas las OC

Carpeta Drive: Ordenes de Cambio
├── OC-001.gsheet
├── OC-002.gsheet
├── OC-003.gsheet
└── ...
```

## Funciones principales

| Funcion | Descripcion |
|---|---|
| `onOpen()` | Crea el menu "Ordenes de Cambio" en la barra del Spreadsheet |
| `crearNuevaOrdenDeCambio()` | Detecta el siguiente numero consecutivo, crea un nuevo GSheet en Drive, escribe numero y fecha automaticamente, y registra en el REGISTRO |
| `actualizarRegistro()` | Lee todos los archivos OC-XXX en la carpeta Drive y sincroniza el REGISTRO con los datos actuales de cada orden |
| `exportarOCcomoPDF()` | Exporta la OC activa como PDF y permite enviarlo por email o guardarlo en Drive |
| `leerDatosOC(hoja)` | Funcion auxiliar que lee todos los campos de una hoja de OC |
| `siguienteNumeroOC()` | Detecta el ultimo numero del REGISTRO y devuelve el siguiente |

## Configuracion

### 1. Variable FOLDER_ID
Cambia el ID de la carpeta de Drive donde se guardaran los archivos OC:
```javascript
const FOLDER_ID = 'TU_FOLDER_ID_AQUI';
```
El ID se obtiene de la URL de la carpeta en Drive:
`https://drive.google.com/drive/folders/**[FOLDER_ID]**`

### 2. Mapa de celdas (CELDAS)
Si tu plantilla tiene un formato diferente, actualiza las referencias de celda:
```javascript
const CELDAS = {
  noOC:        'F4',   // Numero de orden
  fecha:       'H4',   // Fecha
  codProy:     'B7',   // Codigo de proyecto (merged B7:C7)
  nombreProy:  'D7',   // Nombre del proyecto
  impacto:     'H7',   // Impacto
  estatus:     'I7',   // Estatus
  solicito:    'F9',   // Quien solicita
  totalAdit:   'B12',  // Total Aditivo
  totalDeduct: 'D12',  // Total Deductivo
  neto:        'F12',  // Neto del Cambio
  autorizo:    'E55',  // Quien autoriza
};
```

### 3. Causa del cambio
Los checkboxes de causa del cambio se leen de la columna B, filas 24 a 31.
Si tu plantilla tiene diferente posicion, actualiza el loop en `leerDatosOC()`.

## Estructura del REGISTRO (14 columnas)

| Col | Campo | Fuente |
|---|---|---|
| A | No. OC | Automatico (OC-001, OC-002...) |
| B | Fecha | Celda H4 |
| C | Cod. Proyecto | Celda B7 |
| D | Nombre Proyecto | Celda D7 |
| E | Concepto | Manual |
| F | Impacto | Celda H7 |
| G | Estatus | Celda I7 |
| H | Solicito | Celda F9 |
| I | Causa del Cambio | Checkboxes B24:B31 |
| J | Autorizo | Celda E55 |
| K | Total Aditivo | Celda B12 |
| L | Total Deductivo | Celda D12 |
| M | Neto del Cambio | Celda F12 |
| N | Link | URL del archivo GSheet |

## Instalacion

1. Abre el Spreadsheet maestro
2. Ve a **Extensiones > Apps Script**
3. Pega el contenido de `Code.gs`
4. Guarda el proyecto (Ctrl+S)
5. Ejecuta `onOpen` una vez para autorizar permisos
6. Recarga el Spreadsheet — aparecera el menu **"Ordenes de Cambio"**

## Uso

### Crear nueva OC
Menu **Ordenes de Cambio** > **+ Nueva Orden**
- Detecta automaticamente el siguiente numero consecutivo
- Crea un archivo GSheet independiente en la carpeta Drive
- Escribe el numero y la fecha automaticamente
- Registra la OC en el indice REGISTRO

### Editar una OC
Abre el link en la columna **N** del REGISTRO para acceder directamente al archivo.

### Sincronizar cambios al REGISTRO
Menu **Ordenes de Cambio** > **Actualizar Registro**
- Lee todos los archivos OC-XXX en la carpeta Drive
- Actualiza los datos de cada fila en el REGISTRO
- Agrega nuevas OC que no esten registradas
- Ordena el REGISTRO por numero de OC

### Exportar OC como PDF
Desde el archivo individual de la OC:
Menu **Ordenes de Cambio** > **Exportar PDF**
- Opcion de enviar por email al correo del usuario activo
- Opcion de guardar en la carpeta Drive

## Notas

- El campo **Concepto** (columna E del REGISTRO) se llena manualmente, ya que no tiene una celda fija en la plantilla.
- Al usar **Actualizar Registro**, el campo Concepto se sobreescribe con vacio. Se recomienda llenarlo despues de cada sincronizacion.
- Los archivos en la carpeta Drive deben llamarse exactamente `OC-001`, `OC-002`, etc. para ser detectados por el script.
