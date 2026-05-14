# Ultrahuman Health Importer

Importador automático de datos de salud desde la API de Ultrahuman para Google Apps Script.

## Descripción

Este script importa automáticamente métricas diarias de salud desde Ultrahuman y las almacena en Google Sheets. Incluye notificaciones vía Telegram para mantenerte informado sobre el progreso de las importaciones.

## Características

- ✅ Integración completa con la API de Ultrahuman
- 📊 Importación de métricas diarias (últimas 30 días o todas)
- 📱 Notificaciones en tiempo real vía Telegram
- ⏰ Triggers automáticos configurados:
  - Importación diaria a las 9:00 AM (CDMX)
  - Monitoreo horario cada hora
- 📝 Registro detallado de alertas en hojas separadas
- 🔄 Gestión automática de duplicados

## Requisitos

1. Cuenta de Ultrahuman con acceso a la API
2. Bot de Telegram (creado con @BotFather)
3. Google Sheets configurado con las siguientes hojas:
   - `json.data.metrics["YYYY-MM-DD"]` (formato de fecha)

## Configuración

### 1. Obtener token de Ultrahuman

1. Accede a tu cuenta de Ultrahuman
2. Ve a la sección de desarrolladores
3. Genera un nuevo token de API
4. Copia el token generado

### 2. Configurar bot de Telegram

1. Abre Telegram y busca @BotFather
2. Envía el comando `/newbot`
3. Sigue las instrucciones para crear tu bot
4. Copia el token que te proporciona BotFather
5. Para obtener tu Chat ID:
   - Busca @userinfobot en Telegram
   - Envía `/start`
   - Copia tu Chat ID

### 3. Configurar el script

Abre el archivo `Code.gs` y reemplaza los siguientes placeholders:

```javascript
const ULTRAHUMAN_TOKEN = "TU_ULTRAHUMAN_TOKEN_AQUI";  // Token de Ultrahuman
const TELEGRAM_BOT_TOKEN = "TU_BOT_TOKEN_AQUI";      // Token del bot de Telegram
const TELEGRAM_CHAT_ID = "TU_CHAT_ID_AQUI";          // Tu Chat ID de Telegram
```

### 4. Instalar en Google Apps Script

1. Abre tu Google Sheet
2. Ve a **Extensiones** > **Apps Script**
3. Copia y pega el contenido de `Code.gs`
4. Guarda el proyecto
5. Ejecuta la función `configurarTriggers()` para activar la automatización

## Uso

### Funciones principales

- `importarSaludHoy()`: Importa los datos del día actual
- `importarUltimos30Dias()`: Importa los últimos 30 días de datos
- `configurarTriggers()`: Configura los triggers automáticos (ejecutar solo una vez)

### Ejecución manual

Puedes ejecutar cualquier función manualmente desde el editor de Apps Script:

1. Selecciona la función en el menú desplegable
2. Haz clic en el botón ▶️ Ejecutar

## Estructura de datos

Cada fecha importada se almacena en una hoja con el formato `YYYY-MM-DD` y contiene:

- Todas las métricas disponibles de Ultrahuman
- Valores con formato numérico cuando corresponde
- Alertas especiales (valores fuera de rango normal)

## Notificaciones Telegram

Recibirás notificaciones para:

- ✅ Importaciones exitosas
- ⚠️ Alertas de valores en rango normal
- ❌ Errores en la importación
- 📊 Resumen de actividad

## Solución de problemas

### Error de autenticación

- Verifica que el token de Ultrahuman sea válido
- Comprueba que el token no haya expirado

### No llegan las notificaciones de Telegram

- Verifica que el Bot Token sea correcto
- Asegúrate de haber iniciado una conversación con tu bot
- Comprueba que el Chat ID sea el correcto

### Duplicados en las hojas

- El script gestiona automáticamente los duplicados
- Si persiste el problema, revisa los triggers en **Activadores**

## Autor

Antonio Avendaño | AVECO

## Versión

3.0 | Mayo 2026

## Licencia

Este proyecto es de uso privado para AVECO Dashboard.
