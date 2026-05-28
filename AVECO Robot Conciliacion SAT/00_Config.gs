/**
 * ============================================================
 * AVECO Robot Financiero — Configuración Central
 * ============================================================
 * Proyecto   : AVECO Robot Financiero (DataLake + Bancos + Charly)
 * Versión    : 3.0.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-28
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Configuración ÚNICA y compartida por TODOS los archivos del
 *   proyecto. En Apps Script todos los archivos .gs comparten el
 *   mismo espacio global, por eso getConfig() debe existir UNA sola
 *   vez. Este archivo es la única fuente de verdad para Script
 *   Properties, nombres de hojas, zona horaria y metadatos.
 *
 * CONFIGURACIÓN INICIAL (Script Properties → Configuración del proyecto):
 *   --- Obligatorias según el módulo que uses ---
 *   SPREADSHEET_ID          → ID del Google Sheet DataLake
 *   DRIVE_BANCOS_FOLDER_ID  → Carpeta raíz de bancos (subcarpetas por banco)
 *   DRIVE_SAT_FOLDER_ID     → Carpeta de archivos SAT / CFDI
 *   DRIVE_WALLET_FOLDER_ID  → Carpeta de archivos Wallet
 *   DISCORD_WEBHOOK_URL     → Webhook del canal #finanzas (notificaciones)
 *   --- Solo para Charly (bot IA) ---
 *   ANTHROPIC_API_KEY       → API key de Anthropic (sk-ant-...)
 *   DISCORD_BOT_TOKEN       → Token del bot de Discord (lectura/respuesta)
 *   DISCORD_CHANNEL_ID      → ID del canal donde opera Charly
 *   --- Opcionales ---
 *   ANTHROPIC_MODEL         → Modelo Claude (default: claude-sonnet-4-6)
 *   ADMIN_EMAIL             → Email de respaldo (informativo)
 *
 *   Propiedades de ESTADO (las escribe el sistema, NO configurar a mano):
 *   LAST_SUCCESSFUL_SYNC · CHARLY_HISTORY · CHARLY_LAST_MSG_ID
 *
 * NOTAS DE SEGURIDAD:
 *   - Cero secretos en el código. Todo en Script Properties.
 *   - getConfig() NO arroja error si falta una clave: devuelve ''.
 *     Cada función valida lo que necesita con requireConfig_().
 * ============================================================
 */


// ============================================================
// SECCIÓN 1 — CONFIGURACIÓN CENTRAL (única en todo el proyecto)
// ============================================================

/**
 * Configuración centralizada del proyecto.
 * Lee todos los parámetros desde Script Properties.
 * Devuelve cadenas vacías para claves ausentes (no arroja error aquí).
 * @returns {Object} Objeto de configuración inmutable de solo lectura.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  return {
    // --- Google Sheets ---
    SPREADSHEET_ID:         props.getProperty('SPREADSHEET_ID') || '',

    // --- Carpetas de Drive (claves unificadas DRIVE_*_FOLDER_ID) ---
    DRIVE_BANCOS_FOLDER_ID: props.getProperty('DRIVE_BANCOS_FOLDER_ID') || '',
    DRIVE_SAT_FOLDER_ID:    props.getProperty('DRIVE_SAT_FOLDER_ID') || '',
    DRIVE_WALLET_FOLDER_ID: props.getProperty('DRIVE_WALLET_FOLDER_ID') || '',

    // --- Discord ---
    DISCORD_WEBHOOK_URL:    props.getProperty('DISCORD_WEBHOOK_URL') || '',
    DISCORD_BOT_TOKEN:      props.getProperty('DISCORD_BOT_TOKEN') || '',
    DISCORD_CHANNEL_ID:     props.getProperty('DISCORD_CHANNEL_ID') || '',

    // --- Inteligencia Artificial (Charly) ---
    ANTHROPIC_API_KEY:      props.getProperty('ANTHROPIC_API_KEY') || '',
    ANTHROPIC_MODEL:        props.getProperty('ANTHROPIC_MODEL') || 'claude-sonnet-4-6',

    // --- Email opcional (informativo, las alertas reales van a Discord) ---
    ADMIN_EMAIL:            props.getProperty('ADMIN_EMAIL') || '',

    // --- Operativo (fijos del proyecto) ---
    TIMEZONE:      'America/Mexico_City',
    PROJECT_LABEL: 'AVECO Robot Financiero',
    VERSION:       '3.0.0',

    // --- Nombres de hojas del DataLake ---
    HOJAS: {
      CFDI_SAT_RAW:           'CFDI_SAT_RAW',
      CFDI_SAT:               'CFDI_SAT',
      BOARD_CSV_RAW:          'BOARD_CSV_RAW',
      BOARD_RAW:              'BOARD_RAW',
      BOARD_NORMALIZADO:      'BOARD_NORMALIZADO',
      BANCARIOS_RAW:          'MOVIMIENTOS_BANCARIOS_RAW',  // fuente de datos reales
      BANCARIOS:              'MOVIMIENTOS_BANCARIOS',       // normalizado
      SESIONES_CHARLY:        'Sesiones_Charly',
      REVISION_HUMANA:        'Revision_Humana',
      MOVIMIENTOS_MAESTROS:   'Movimientos_Maestros',
      CATALOGO_CUENTAS:       'Catalogo_Cuentas',
      CATALOGO_OBRAS:         'Catalogo_Obras',
      ESTANDARES_BOARD:       'Estandares_Board',
      HISTORIAL_CONCILIACION: 'Historial_Conciliacion',
      ML_TRAINING:            'ML_Training_Data',
    },
  };
}


// ============================================================
// SECCIÓN 2 — VALIDACIÓN DE CONFIGURACIÓN
// ============================================================

/**
 * Valida que existan las claves requeridas; arroja error claro si falta alguna.
 * Usar al inicio de cada función que dependa de propiedades concretas.
 * @param {string[]} requiredKeys Claves de getConfig() que deben tener valor.
 * @returns {Object} La configuración ya validada.
 * @throws {Error} Si alguna clave requerida está vacía.
 */
function requireConfig_(requiredKeys) {
  const cfg = getConfig();
  const faltantes = (requiredKeys || []).filter(k => !cfg[k]);
  if (faltantes.length) {
    throw new Error(
      'Faltan Script Properties: ' + faltantes.join(', ') +
      '. Configúralas en Configuración del proyecto → Propiedades de la secuencia de comandos.'
    );
  }
  return cfg;
}
