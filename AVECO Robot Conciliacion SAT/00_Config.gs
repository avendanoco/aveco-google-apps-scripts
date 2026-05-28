/**
 * ============================================================
 * AVECO Robot Financiero — Configuración Central
 * ============================================================
 * Proyecto   : AVECO Robot Financiero (DataLake + Bancos + Charly)
 * Versión    : 3.1.0
 * Cuenta GWS : aveco.bancos@gmail.com
 * Autor      : Antonio Avendaño (antonio.ac@aveco.mx)
 * Repositorio: github.com/avendanoco/aveco-google-apps-scripts
 * Creado     : 2026-05-28
 * Actualizado: 2026-05-28
 *
 * Descripción:
 *   Configuración ÚNICA y compartida por TODOS los archivos del
 *   proyecto. En Apps Script todos los archivos .gs comparten el
 *   mismo espacio global, por eso getConfig() existe UNA sola vez.
 *   Fuente de verdad para: Script Properties, nombres de hojas,
 *   ESQUEMA de columnas de cada hoja (usado por el botón Configuración
 *   y los normalizadores), zona horaria y metadatos.
 *
 * CONFIGURACIÓN INICIAL (Script Properties → Configuración del proyecto):
 *   SPREADSHEET_ID          → ID del Google Sheet DataLake
 *   DRIVE_BANCOS_FOLDER_ID  → Carpeta raíz de bancos (subcarpetas por banco)
 *   DRIVE_SAT_FOLDER_ID     → Carpeta de archivos SAT / CFDI
 *   DRIVE_WALLET_FOLDER_ID  → Carpeta de archivos Wallet
 *   DISCORD_WEBHOOK_URL     → Webhook del canal #finanzas
 *   ANTHROPIC_API_KEY       → API key de Anthropic (sk-ant-...)   [solo Charly]
 *   DISCORD_BOT_TOKEN       → Token del bot de Discord             [solo Charly]
 *   DISCORD_CHANNEL_ID      → ID del canal de Charly               [solo Charly]
 *   ANTHROPIC_MODEL         → opcional (default claude-sonnet-4-6)
 *   ADMIN_EMAIL             → opcional
 *
 *   Estado (lo escribe el sistema, NO configurar a mano):
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
 * Devuelve cadenas vacías para claves ausentes (no arroja error aquí).
 * @returns {Object}
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

    // --- Email opcional (informativo; las alertas reales van a Discord) ---
    ADMIN_EMAIL:            props.getProperty('ADMIN_EMAIL') || '',

    // --- Operativo (fijos del proyecto) ---
    TIMEZONE:      'America/Mexico_City',
    PROJECT_LABEL: 'AVECO Robot Financiero',
    VERSION:       '3.1.0',

    // --- Nombres de hojas del DataLake ---
    HOJAS: {
      CFDI_SAT_RAW:           'CFDI_SAT_RAW',
      CFDI_SAT:               'CFDI_SAT',
      BOARD_CSV_RAW:          'BOARD_CSV_RAW',
      BOARD_NORMALIZADO:      'BOARD_NORMALIZADO',
      BANCARIOS_RAW:          'MOVIMIENTOS_BANCARIOS_RAW',
      BANCARIOS:              'MOVIMIENTOS_BANCARIOS',
      SESIONES_CHARLY:        'Sesiones_Charly',
      REVISION_HUMANA:        'Revision_Humana',
      MOVIMIENTOS_MAESTROS:   'Movimientos_Maestros',
      CATALOGO_CUENTAS:       'Catalogo_Cuentas',
      CATALOGO_OBRAS:         'Catalogo_Obras',
      CATALOGO_ETAPAS:        'Catalogo_Etapas',
      CATALOGO_CATEGORIAS:    'Catalogo_Categorias',
      ESTANDARES_BOARD:       'Estandares_Board',
      HISTORIAL_CONCILIACION: 'Historial_Conciliacion',
      ML_TRAINING:            'ML_Training_Data',
    },
  };
}


// ============================================================
// SECCIÓN 2 — ESQUEMA DE COLUMNAS (fuente de verdad de la estructura)
// ============================================================

/**
 * Esquema canónico: para cada hoja, la lista EXACTA y ORDENADA de
 * encabezados. Esto lo consume:
 *   - configurarDataLake()  (00 → crea hojas/encabezados faltantes)
 *   - los normalizadores     (mapean por NOMBRE de columna, no por índice)
 *
 * Mantener este objeto sincronizado con la realidad del Sheet es lo que
 * evita el bug de "monto en la columna equivocada": las funciones ya no
 * asumen posiciones, preguntan por nombre con colIndex_().
 *
 * @returns {Object<string, string[]>} nombreHoja → array de encabezados.
 */
function getSchema_() {
  return {
    CFDI_SAT_RAW: ['uuid_cfdi', 'rfc_emisor', 'nombre_emisor', 'fecha_emision', 'subtotal', 'iva', 'total', 'moneda_cfdi', 'uso_cfdi', 'tipo_comprobante', 'estatus_sat'],

    CFDI_SAT: ['uuid_cfdi', 'rfc_emisor', 'nombre_emisor', 'fecha_emision', 'subtotal', 'iva', 'total', 'moneda_cfdi', 'uso_cfdi', 'tipo_comprobante', 'estatus_sat', 'link_archivo'],

    // Export de Wallet/BudgetBakers (CSV). Fuente real del Board.
    BOARD_CSV_RAW: ['account', 'category', 'currency', 'amount', 'ref_currency_amount', 'type', 'payment_type', 'note', 'date', 'transfer', 'payee', 'labels'],

    BOARD_NORMALIZADO: ['id_interno', 'banco', 'cuenta_bancaria', 'fecha_movimiento', 'monto', 'moneda', 'tipo_movimiento', 'descripcion_original', 'descripcion_limpia', 'referencia', 'folio_banco', 'categoria_board', 'labels_board', 'payee_board', 'id_board'],

    // RAW bancario: ya lo escriben los parsers POR BANCO (02_Importador.gs),
    // por eso lleva monto firmado + montos por moneda + contraparte ya extraídos.
    // 'monto' está en MXN (moneda base del DataLake); 'monto_usd' solo aplica a
    // cuentas en dólares (resto queda vacío).
    MOVIMIENTOS_BANCARIOS_RAW: ['banco', 'fecha', 'descripcion', 'referencia', 'monto', 'moneda', 'monto_usd', 'tipo_cambio', 'contraparte', 'categoria', 'obra', 'link_cfdi', 'archivo_origen'],

    // Normalizado de bancos. Incluye columnas USD para la cuenta en dólares:
    // 'monto' = MXN (base), 'monto_usd' y 'tipo_cambio' se llenan solo cuando aplica.
    MOVIMIENTOS_BANCARIOS: ['id_interno', 'banco', 'cuenta_bancaria', 'fecha_movimiento', 'monto', 'moneda', 'monto_usd', 'tipo_cambio', 'tipo_movimiento', 'descripcion_original', 'descripcion_limpia', 'contraparte', 'referencia', 'folio_banco', 'categoria', 'obra', 'link_cfdi', 'estado_revision'],

    MOVIMIENTOS_MAESTROS: ['id_interno', 'banco', 'cuenta_bancaria', 'fecha_movimiento', 'monto', 'moneda', 'tipo_movimiento', 'descripcion_original', 'descripcion_limpia', 'referencia', 'folio_banco', 'contraparte_nombre', 'uuid_cfdi', 'rfc_emisor', 'nombre_proveedor', 'total_cfdi', 'fecha_cfdi', 'link_cfdi_xml', 'centro_costo_id_obra', 'centro_costo_etapa', 'categoria_robot', 'confianza_categoria', 'categoria_board', 'categoria_board_id', 'labels_board', 'payee_board', 'note_board', 'account_board', 'type_board', 'payment_type_board', 'transfer_board', 'monto_vs_cfdi_diff', 'estatus_conciliacion_sat', 'estado_conciliacion', 'estado_revision', 'notas_revision'],

    ESTANDARES_BOARD: ['account', 'category', 'currency', 'amount', 'ref_currency_amount', 'type', 'payment_type', 'note', 'date', 'transfer', 'payee', 'labels'],

    Catalogo_Cuentas:    ['banco', 'cuenta_bancaria_alias', 'account_board'],
    Catalogo_Obras:      ['id_obra', 'nombre_obra', 'cliente', 'estatus'],
    Catalogo_Etapas:     ['etapa_codigo', 'etapa_nombre'],
    Catalogo_Categorias: ['categoria_nivel1', 'categoria_nivel2', 'categoria_board_id', 'categoria_board_nombre'],

    Historial_Conciliacion: ['id_interno', 'fecha_procesamiento', 'banco', 'cuenta_bancaria', 'monto', 'estado', 'id_board', 'notas'],

    Revision_Humana: ['id_interno', 'fecha_movimiento', 'banco', 'monto', 'descripcion', 'categoria_sugerida', 'confianza', 'obra_sugerida', 'etapa_sugerida', 'uuid_cfdi', 'categoria_final', 'obra_final', 'estado_revision', 'revisor'],

    Sesiones_Charly:  ['fecha', 'sesion_json', 'estado', 'mensaje', 'fecha_respuesta'],
    ML_Training_Data: ['keyword', 'categoria', 'frecuencia', 'confidence'],
  };
}


// ============================================================
// SECCIÓN 3 — VALIDACIÓN Y UTILIDADES DE CONFIGURACIÓN
// ============================================================

/**
 * Valida que existan las claves requeridas; arroja error claro si falta alguna.
 * @param {string[]} requiredKeys
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

/**
 * Devuelve un mapa { nombre_columna: índice0based } leyendo la fila 1 real
 * de la hoja. Permite que los normalizadores trabajen por NOMBRE y no por
 * posición, evitando descuadres cuando cambian las columnas.
 * @param {Sheet} sheet
 * @returns {Object<string, number>}
 */
function colIndex_(sheet) {
  const map = {};
  if (!sheet || sheet.getLastColumn() < 1) return map;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach((h, i) => {
    const key = (h === null || h === undefined) ? '' : h.toString().trim();
    if (key) map[key] = i;
  });
  return map;
}
