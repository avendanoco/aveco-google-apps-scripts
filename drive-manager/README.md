# 🗂️ AVECO Drive Manager

> **Google Apps Script** para gestión avanzada de Google Drive dentro de Google Sheets.  
> Desarrollado por [AVECO Arquitectura Avanzada en Ecología y Construcción](https://aveco.mx).

---

## ¿Qué es?

AVECO Drive Manager es un sistema de administración de archivos y carpetas de Google Drive operado completamente desde una hoja de cálculo de Google Sheets. Permite indexar, visualizar, renombrar, mover y organizar masivamente el contenido de Drive usando un sistema de **prefijos** como convención de nomenclatura. Está orientado a equipos de arquitectura, construcción y desarrollo inmobiliario que manejan estructuras de carpetas complejas por proyecto.

---

## 📁 Estructura del repositorio

```
aveco-google-apps-scripts/
└── drive-manager/
    ├── AVECO_DriveManager_v7c.gs   ← Script principal (Google Apps Script)
    └── README.md                   ← Este archivo
```

---

## 🚀 Instalación

1. Abre el Google Sheets donde deseas usar el manager.
2. Ve a **Extensiones → Apps Script**.
3. Crea un nuevo archivo `.gs` y pega el contenido de `AVECO_DriveManager_v7c.gs`.
4. Reemplaza las constantes al inicio del script:

```javascript
const ROOT_FOLDER_ID = 'TU_FOLDER_ID_RAIZ'; // ID de la carpeta raíz de tu Drive
const GEMINI_API_KEY = 'TU_API_KEY_GEMINI';  // Opcional: para consultas con IA
```

5. Guarda el proyecto y recarga la hoja. Aparecerá el menú **🗂️ AVECO Drive Manager**.

> **Permisos requeridos:** Drive (lectura/escritura), Spreadsheets, UI. Se solicitarán al ejecutar por primera vez.

---

## 🗺️ Arquitectura

### Hojas generadas automáticamente

| Hoja | Descripción |
|------|-------------|
| `📂 Índice Drive` | Índice completo de todos los archivos y carpetas del Drive |
| `🌲 Árbol Carpetas` | Visualización jerárquica de carpetas con controles de edición |
| `📋 Log de Movimientos` | Registro histórico de todas las operaciones realizadas |
| `🤖 Contexto IA` | Índice comprimido para consultas con Gemini |

### Convención de prefijos

Todo el sistema se basa en que **cada archivo y carpeta lleva un prefijo al inicio del nombre**, separado por un espacio:

```
AVECO-01 Planos arquitectónicos finales.pdf
AVECO-02 Memoria descriptiva v3.docx
PROY Carpeta principal del proyecto
```

El prefijo puede incluir una **categoría** separada por guion:

```
PROY-01 Documento prioritario
PROY-02 Documento secundario
PROY-A  Documento tipo A
```

Este esquema permite:
- Organización automática por carpeta según prefijo
- Renombrado masivo heredando el prefijo de la carpeta padre
- Monitoreo de longitud de prefijo para consistencia

---

## 📊 Mapa de columnas — Árbol de Carpetas (v7c)

| Col | Header | Tipo | Descripción |
|-----|--------|------|-------------|
| A | Est. | Auto | Estructura numérica limpia (`1`, `1.1`, `1.2.3`) |
| B | Lvl | Auto | Nivel de profundidad (`0`=raíz, `1`=sub, etc.) |
| C | Pfx | Fórmula | Prefijo extraído del nombre de carpeta |
| D | Len | Fórmula | Longitud del prefijo |
| E | Items | Auto | Total de archivos + subcarpetas directas |
| F | Árbol Visual | Dato | Representación visual con indentación y `└─` |
| G | Nombre Carpeta | Dato | Nombre sin caracteres de árbol |
| H | ✏️ Nuevo Nombre | **Editable** | Escribe aquí el nuevo nombre para renombrar |
| I | Nueva Est. | **Editable** | Nueva estructura numérica para mover la carpeta |
| J | Nuevo Pfx | Fórmula | Prefijo calculado del nuevo nombre (col H) |
| K | Len Pfx Nuevo | Fórmula | Longitud del nuevo prefijo |
| L | Arch. | Auto | Archivos directos en la carpeta |
| M | Subs. | Auto | Subcarpetas directas |
| N | ID | Oculto | ID técnico de Google Drive |
| O | URL | Fórmula | Hipervínculo directo a la carpeta |
| P | Estado | Resultado | Resultado después de aplicar cambios |

---

## 🎨 Formato condicional automático

El árbol aplica formato condicional basado en la columna **B (Lvl)**:

| Condición | Color de fondo | Texto | Significado |
|-----------|---------------|-------|-------------|
| `=$E2=0` | `#FFCDD2` Rojo claro | Rojo oscuro | ⚠️ Carpeta vacía (prioridad máxima) |
| `=$B2=0` | `#1B5E20` Verde oscuro | Blanco | Carpeta raíz (nivel 0) |
| `=$B2=1` | `#388E3C` Verde medio | Blanco | Carpeta nivel 1 |

> Las reglas se aplican en orden de prioridad: las carpetas vacías tienen precedencia sobre el nivel.

---

## 🛠️ Funciones principales

### `indexarDrive()`
Escanea recursivamente toda la estructura desde `ROOT_FOLDER_ID` y construye el índice completo en la hoja `📂 Índice Drive`. También regenera el árbol de carpetas. Se recomienda ejecutar esta función al inicio y cada vez que se hagan cambios externos al Drive.

### `sincronizarArbol()`
Regenera únicamente la hoja `🌲 Árbol Carpetas` sin re-indexar archivos. Más rápido que `indexarDrive()` cuando solo se necesita actualizar la vista de carpetas.

### `aplicarCambiosArbol()`
Procesa las columnas editables **H** (Nuevo Nombre) e **I** (Nueva Est.) del árbol y ejecuta las operaciones en Drive:

1. **Renombra** la carpeta si H tiene un valor diferente al nombre actual
2. **Mueve por estructura** si I tiene una nueva posición numérica (ej: `2.1`)
3. **Mueve por prefijo** si el nuevo nombre tiene un prefijo diferente y existe una carpeta destino con ese prefijo
4. **Valida movimientos circulares** antes de ejecutar cualquier traslado
5. **Actualiza masivamente** todos los archivos en el índice que tenían el prefijo anterior
6. Registra todas las operaciones en `📋 Log de Movimientos`

> ✏️ Solo se necesita llenar **H** o **I** (o ambas). Las demás columnas son automáticas.

### `organizarPorPrefijo()`
Mueve todos los **archivos** del índice a la carpeta cuyo nombre comienza con su mismo prefijo. Útil para una organización masiva inicial.

### `renombrarYMoverPorPrefijo()`
Opera sobre la columna **✏️ Nuevo Nombre** del índice (`📂 Índice Drive`): renombra cada elemento y lo mueve si el nuevo prefijo corresponde a una carpeta diferente.

### `previewOrganizacion()`
Muestra en la columna Estado del índice cómo quedarían los archivos organizados **sin ejecutar** ningún cambio real. Útil para revisar antes de aplicar.

### `aplicarPrefijoCarpetaAArchivos(folderId, categoria, filtroExt, soloPreview)`
Función del Sidebar. Toma el prefijo de una carpeta y lo aplica a todos sus archivos directos. Formato resultante: `PREFIJO-CATEGORIA NombreArchivo.ext`. Soporta modo preview y filtro por extensión.

### `eliminarCarpetasVacias()`
Detecta todas las carpetas marcadas en rojo (Items = 0) y las envía a la papelera de Drive en lote, previa confirmación.

### `consultarIA()`
Envía una consulta en lenguaje natural a la API de Gemini Flash junto con el índice comprimido del Drive. Devuelve el nombre, ruta e ID de los archivos relevantes encontrados.

---

## 🔄 Flujo de trabajo recomendado

```
1. indexarDrive()
        ↓
2. Revisar árbol en 🌲 Árbol Carpetas
        ↓
3. Identificar carpetas vacías (rojo) → eliminarCarpetasVacias()
        ↓
4. Renombrar carpetas en col H y/o mover con col I
        ↓
5. aplicarCambiosArbol()
        ↓
6. Sidebar: Aplicar prefijo masivo a archivos dentro de cada carpeta
        ↓
7. sincronizarArbol() → verificar resultado
```

---

## ⚙️ Configuración avanzada

### Múltiples raíces
Si necesitas gestionar más de una carpeta raíz, duplica el script en un segundo archivo `.gs` y define un `ROOT_FOLDER_ID` distinto. Cada ejecución generará/sobreescribirá las mismas hojas.

### Rendimiento con Drives grandes
- El escaneo recursivo usa iteradores nativos de Apps Script (`getFiles()`, `getFolders()`).
- Para Drives con más de 5,000 archivos, considera activar un trigger de **tiempo** para ejecutar `indexarDrive()` de noche.
- La función respeta los límites de cuota de Apps Script (6 min/ejecución). Si el Drive es muy grande, usa `sincronizarArbol()` para actualizaciones parciales.

### Integración con n8n / automatización externa
El script puede activarse vía **Google Apps Script Web App** (`doGet`/`doPost`) para integrarse con flujos de n8n, Make, o cualquier herramienta HTTP.

---

## 📋 Convenciones de nomenclatura

```
PREFIJO NOMBRE_DESCRIPTIVO
PREFIJO-CATEGORIA NOMBRE_DESCRIPTIVO
```

**Ejemplos reales:**
```
AVECO Carpeta principal
AVECO-ARCH Planos arquitectónicos
AVECO-CONT-01 Contrato cliente prioridad alta
AVECO-CONT-02 Contrato proveedor secundario
PROY Expediente proyecto Tulum
PROY-A Documentos tipo A
```

**Reglas:**
- El prefijo es siempre la **primera palabra** del nombre (separada por espacio)
- Mayúsculas recomendadas para prefijos
- El guion `-` separa el prefijo base de la categoría
- Los sufijos de categoría (`01`, `02`, `A`, `B`…) indican prioridad o tipo

---

## 🔐 Seguridad y permisos

- El script opera bajo las credenciales del usuario que lo ejecuta.
- Solo accede a los archivos y carpetas **dentro de** `ROOT_FOLDER_ID`.
- No comparte datos con servicios externos salvo cuando se usa `consultarIA()` (requiere API key de Gemini).
- Se recomienda usar una cuenta de servicio o cuenta de organización Google Workspace para equipos.

---

## 🧪 Versiones

| Versión | Descripción |
|---------|-------------|
| v7c | Columna `Lvl`, `Est.` limpia sin sangría, FC por nivel B, headers abreviados, `eliminarCarpetasVacias()` |
| v7b | Sidebar prefijo masivo, categorías por guion, modo preview |
| v7a | Mover carpetas por prefijo + validación anti-circular |
| v6 | Árbol visual, renombrar + mover desde árbol, log de movimientos |
| v5 | Índice Drive completo, organización masiva por prefijo |

---

## 👤 Autor

**Antonio Avendaño** — AVECO Arquitectura Avanzada en Ecología y Construcción SAPI DE CV  
📍 Tulum, Quintana Roo, México  
📧 antonio.ac@aveco.mx  
🌐 [aveco.mx](https://aveco.mx)

---

## 📄 Licencia

Uso interno AVECO. Para uso externo contactar al autor.
