/**
 * =============================================================================
 * Project   : AVECO DataLake — Charly Discord Bot con Claude API
 * Version   : 1.0.0
 * GWS Email : aveco.bancos@gmail.com
 * Author    : Antonio Avendaño / AVECO
 * Repo      : https://github.com/avendanoco/aveco-google-apps-scripts
 * Created   : 2026-05-28
 * Updated   : 2026-05-28
 * Description:
 *   Agente financiero "Charly" corriendo 100% en Google Apps Script.
 *   Llama a la API de Anthropic (Claude Sonnet) con tool_use para analizar
 *   el DataLake y responder preguntas en Discord.
 *   Funciona como bot de Discord via polling REST (trigger cada 1 minuto).
 *   Las "tools" de Claude llaman directamente a las funciones de Code.gs
 *   sin necesidad de HTTP — todo corre dentro del mismo Apps Script.
 *
 * Arquitectura del flujo:
 *   [Trigger 1 min] → charlyDiscordPoll()
 *     → Lee mensajes nuevos del canal via Discord REST API
 *     → runCharly_(mensaje, historial)
 *       → Claude API con tool_use
 *       → executeTool_() → getSATCFDIs() / getBancarios() / etc.
 *       → Respuesta final de Claude
 *     → Envía respuesta al canal de Discord
 *   [Trigger 6am]   → charlyBriefingDiario()
 *     → runCharly_() con prompt de briefing completo
 *     → Envía embed formateado a Discord
 *
 * Config requerida (Script Properties → Configuracion del proyecto):
 *   ANTHROPIC_API_KEY   → API key de Anthropic (sk-ant-...)
 *   DISCORD_BOT_TOKEN   → Token del bot de Discord (NO el webhook)
 *   DISCORD_CHANNEL_ID  → ID del canal donde Charly opera
 *   SPREADSHEET_ID      → Ya configurado en Code.gs
 *   DISCORD_WEBHOOK_URL → Ya configurado en Code.gs (para embeds de procesos)
 *
 * Discord Bot — Setup inicial (hacer UNA sola vez):
 *   1. discord.com/developers/applications → New Application → nombrar "Charly AVECO"
 *   2. Sección "Bot" → Add Bot → Reset Token → copiar token
 *      → Script Property: DISCORD_BOT_TOKEN
 *   3. OAuth2 → URL Generator → Scopes: bot → Permissions:
 *      "Send Messages", "Read Messages/View Channels", "Read Message History"
 *      → Copiar URL generada → abrirla en browser → agregar al servidor
 *   4. En Discord: Settings → Advanced → Developer Mode ON
 *      Click derecho en el canal → Copy Channel ID
 *      → Script Property: DISCORD_CHANNEL_ID
 *   5. Desde el editor de Apps Script: ejecutar setupCharly() una sola vez
 *
 * Seguridad:
 *   Secrets exclusivamente en Script Properties, nunca en el código.
 *   El bot solo responde mensajes de usuarios en DISCORD_CHANNEL_ID.
 * =============================================================================
 */

// ─── Constantes ───────────────────────────────────────────────────────────────

const CHARLY_MODEL        = 'claude-sonnet-4-6';
const CHARLY_MAX_TOKENS   = 2048;
const CHARLY_MAX_ITER     = 6;
const CHARLY_HISTORY_KEY  = 'CHARLY_HISTORY';
const CHARLY_LAST_MSG_KEY = 'CHARLY_LAST_MSG_ID';
const DISCORD_API_BASE    = 'https://discord.com/api/v10';
const ANTHROPIC_API_URL   = 'https://api.anthropic.com/v1/messages';

// ─── System Prompt ────────────────────────────────────────────────────────────

const CHARLY_SYSTEM_PROMPT = [
  'Eres Charly, el agente financiero IA de AVECO Arquitectura Avanzada en Ecología y Construcción.',
  '',
  'MISIÓN: Ayudar a Antonio Avendaño (Director General) con:',
  '- Conciliación: CFDIs SAT vs movimientos bancarios vs Board/BudgetBakers',
  '- Análisis de gastos, flujo de caja y anomalías',
  '- Revisión de movimientos pendientes de categorización',
  '',
  'BANCOS: Santander MXN, BBVA, Fondeadora, TC Clara, TC Konfio, TD Dólar USD',
  'OBRAS ACTIVAS: AM07, AM08, AM09, AM10, Tulum (construcción Riviera Maya)',
  '',
  'CÓMO OPERAR:',
  '1. Briefing matutino → get_resumen_diario + fuzzy_conciliar del mes actual',
  '2. Encontrar CFDIs sin match → fuzzy_conciliar (supera el match exacto)',
  '3. Revisar pendientes → get_pending_review; si confianza >80% usa save_decision',
  '4. Consultas puntuales → get_sat_cfdis o get_bancarios con filtros',
  '',
  'FORMATO PARA DISCORD:',
  '- Siempre en español. Texto claro y accionable.',
  '- Usa **negritas** para montos y nombres clave.',
  '- Montos: $1,234,567.89 MXN. Emojis moderados.',
  '- Máximo 7 puntos clave por respuesta.',
  '',
  'REGLA: score fuzzy <70 → marcar como "posible", nunca confirmar sin certeza.',
].join('\n');

// ─── Definición de Tools ──────────────────────────────────────────────────────

const CHARLY_TOOLS = [
  {
    name: 'get_status',
    description: 'Estado del DataLake: filas por hoja y movimientos pendientes de revisión.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_resumen_diario',
    description: 'Resumen diario: conciliación 30 días, bancarios 7 días, pendientes urgentes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_sat_cfdis',
    description: 'CFDIs del SAT filtrados. Retorna uuid, nombre_emisor, total, fecha.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        limite: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'get_bancarios',
    description: 'Movimientos bancarios. Bancos válidos: BBVA, FONDEADORA, TC CLARA, TC KONFIO, DOLAR APP USD, SANTANDER.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string' },
        hasta: { type: 'string' },
        banco: { type: 'string' },
        tipo: { type: 'string', description: 'EGRESO o INGRESO' },
        limite: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'get_conciliacion',
    description: 'Reporte de conciliación básica (match exacto) SAT vs Board para un período.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string' },
        hasta: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'get_pending_review',
    description: 'Movimientos pendientes de revisión humana con tipo de problema detectado.',
    input_schema: {
      type: 'object',
      properties: { limite: { type: 'integer' } },
      required: [],
    },
  },
  {
    name: 'save_decision',
    description: 'Guarda la decisión de Antonio sobre un movimiento: categoría, obra y estado.',
    input_schema: {
      type: 'object',
      properties: {
        id_interno: { type: 'string' },
        categoria: { type: 'string' },
        obra: { type: 'string', description: 'AM07, AM08, AM09, AM10, TULUM' },
        estado: { type: 'string', description: 'revisado | aprobado | rechazado' },
      },
      required: ['id_interno', 'estado'],
    },
  },
  {
    name: 'fuzzy_conciliar',
    description: 'Conciliación INTELIGENTE con fuzzy matching. Normaliza nombres de empresas (quita SA de CV, acentos), tolera ±5% en montos y ±7 días en fechas. Mucho mejor que el match exacto para proveedores como Chakjuha, Construrent, Nohoch, etc.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD (default: últimos 90 días)' },
        hasta: { type: 'string', description: 'YYYY-MM-DD (default: hoy)' },
        tolerancia_monto: { type: 'number', description: '0.0–1.0, default 0.05' },
        similitud_nombre: { type: 'number', description: '0.0–1.0, default 0.70' },
      },
      required: [],
    },
  },
];

// ─── Agente Principal (loop tool_use) ─────────────────────────────────────────

/**
 * Ejecuta el agente Charly con tool_use de Claude.
 * Las tools llaman directamente a las funciones de Code.gs (sin HTTP).
 * @returns {{ text: string, messages: Array }}
 */
function runCharly_(userMessage, history) {
  const messages = [...(history || []), { role: 'user', content: userMessage }];

  for (let iter = 0; iter < CHARLY_MAX_ITER; iter++) {
    const response = callClaudeAPI_(messages);

    if (response.stop_reason === 'end_turn') {
      const text = (response.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      messages.push({ role: 'assistant', content: response.content });
      return { text, messages };
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = (response.content || [])
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: executeTool_(b.name, b.input),
        }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  return { text: 'Alcancé el límite de iteraciones. Por favor reformula tu pregunta.', messages };
}

/**
 * Despacha un tool al llamando directamente la función de Code.gs.
 * Sin HTTP — todo corre dentro del mismo Apps Script.
 */
function executeTool_(name, input) {
  try {
    let result;
    switch (name) {
      case 'get_status':          result = getStatus();              break;
      case 'get_resumen_diario':  result = getResumenDiario();       break;
      case 'get_sat_cfdis':       result = getSATCFDIs(input);       break;
      case 'get_bancarios':       result = getBancarios(input);      break;
      case 'get_conciliacion':    result = getConciliacion(input);   break;
      case 'get_pending_review':  result = getPendingReview(input);  break;
      case 'save_decision':       result = saveDecision(input);      break;
      case 'fuzzy_conciliar':     result = ejecutarFuzzyConciliacion_(input); break;
      default: result = { error: 'Tool desconocido: ' + name };
    }
    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// ─── Fuzzy Matching (implementación nativa Apps Script) ───────────────────────

/**
 * Conciliación inteligente SAT vs Bancarios usando similitud de Jaccard.
 * Score = similitud×50 + match_monto×30 + match_fecha×20
 * Confirmado ≥70 | Posible 30–69 | Sin match <30
 */
function ejecutarFuzzyConciliacion_(params) {
  const desde    = (params && params.desde)             || getHaceNDias_(90);
  const hasta    = (params && params.hasta)             || hoy_();
  const tolMonto = parseFloat((params && params.tolerancia_monto) || 0.05);

  const cfdisResp = getSATCFDIs({ desde, hasta, limite: 500 });
  const bancResp  = getBancarios({ desde, hasta, limite: 1000 });

  if (!cfdisResp.success) return { error: 'CFDIs: ' + cfdisResp.error };
  if (!bancResp.success)  return { error: 'Bancarios: ' + bancResp.error };

  const cfdis = cfdisResp.cfdis   || [];
  const bancs = bancResp.movimientos || [];
  const confirmados = [], posibles = [], sinMatch = [];
  const usados = new Set();

  cfdis.forEach(cfdi => {
    const nomCfdi  = String(cfdi.nombre_emisor || cfdi.razon_social || '');
    const monCfdi  = Math.abs(parseFloat(cfdi.total || cfdi.monto || 0));
    const fechCfdi = String(cfdi.fecha || cfdi.fecha_emision || '').substring(0, 10);
    const uuid     = String(cfdi.uuid || cfdi.id || '');
    if (!monCfdi) return;

    const candidatos = [];
    bancs.forEach((b, i) => {
      if (usados.has(i)) return;
      const desc  = String(b.descripcion || b.descripcion_limpia || b.nota || '');
      const monB  = Math.abs(parseFloat(b.monto || 0));
      const fechB = String(b.fecha || b.fecha_movimiento || '').substring(0, 10);
      const sim   = similitudJaccard_(nomCfdi, desc);
      const okM   = monCfdi > 0 && monB > 0
        && Math.abs(monCfdi - monB) / Math.max(monCfdi, monB) <= tolMonto;
      const okF   = Math.abs(diasEntre_(fechCfdi, fechB)) <= 7;
      if (sim < 0.25 && !okM) return;
      const score = sim * 50 + (okM ? 30 : 0) + (okF ? 20 : 0);
      if (score >= 30) candidatos.push({ i, b, score, sim, okM, okF });
    });

    candidatos.sort((a, b) => b.score - a.score);

    if (!candidatos.length) {
      sinMatch.push({ uuid, nombre_emisor: nomCfdi, monto: monCfdi, fecha: fechCfdi });
      return;
    }

    const m = candidatos[0];
    const entry = {
      cfdi:  { uuid, nombre_emisor: nomCfdi, monto: monCfdi, fecha: fechCfdi },
      match: {
        descripcion: m.b.descripcion || '',
        monto:       Math.abs(parseFloat(m.b.monto || 0)),
        fecha:       m.b.fecha || '',
        banco:       m.b.banco || '',
        id_interno:  m.b.id_interno || '',
      },
      score:            Math.round(m.score * 10) / 10,
      similitud_nombre: Math.round(m.sim * 100) / 100,
      match_monto:      m.okM,
      match_fecha:      m.okF,
    };

    if (m.score >= 70) { confirmados.push(entry); usados.add(m.i); }
    else posibles.push(entry);
  });

  return {
    periodo:                  desde + ' a ' + hasta,
    total_cfdis_analizados:   cfdis.length,
    total_bancarios_analizados: bancs.length,
    matches_confirmados:      confirmados,
    matches_posibles:         posibles.slice(0, 10),
    cfdis_sin_match:          sinMatch.slice(0, 20),
    resumen: {
      confirmados:    confirmados.length,
      posibles:       posibles.length,
      sin_match:      sinMatch.length,
      cobertura_pct:  cfdis.length > 0
        ? Math.round(confirmados.length / cfdis.length * 1000) / 10
        : 0,
    },
  };
}

/** Similitud de Jaccard sobre conjuntos de palabras normalizadas. */
function similitudJaccard_(a, b) {
  const wa = new Set(normalizarNombreGAS_(a).split(' ').filter(w => w.length > 2));
  const wb = new Set(normalizarNombreGAS_(b).split(' ').filter(w => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  const intersect = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? intersect / union : 0;
}

/** Normaliza nombre de empresa: quita acentos, sufijos legales, caracteres especiales. */
function normalizarNombreGAS_(str) {
  if (!str) return '';
  return String(str).toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
    .replace(/\b(sa\s*de\s*cv|s\.a\.\s*de\s*c\.v\.|sapi|s\.a\.s\.|srl|sa|de\s*cv|tulum|mexico|mx|construcciones|corporativo)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Diferencia en días entre dos fechas YYYY-MM-DD. */
function diasEntre_(f1, f2) {
  try {
    return Math.round((new Date(f1) - new Date(f2)) / 86400000);
  } catch (e) { return 999; }
}

// ─── Anthropic API ────────────────────────────────────────────────────────────

/**
 * Llama a la API de Anthropic y retorna el response body completo.
 * Incluye CHARLY_TOOLS por defecto para habilitar tool_use.
 */
function callClaudeAPI_(messages) {
  const cfg = getConfig();
  if (!cfg.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurado en Script Properties');
  }

  const resp = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         cfg.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model:      CHARLY_MODEL,
      max_tokens: CHARLY_MAX_TOKENS,
      system:     CHARLY_SYSTEM_PROMPT,
      tools:      CHARLY_TOOLS,
      messages:   messages,
    }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());

  if (code !== 200) {
    throw new Error('Anthropic API ' + code + ': ' + (body.error && body.error.message ? body.error.message : JSON.stringify(body)));
  }
  return body;
}

// ─── Discord API ──────────────────────────────────────────────────────────────

/**
 * Lee los mensajes nuevos del canal de Discord (después de lastMsgId).
 * Usa el Bot Token — lee mensajes del canal como un usuario normal.
 */
function fetchDiscordMessages_(lastMsgId) {
  const cfg = getConfig();
  if (!cfg.DISCORD_BOT_TOKEN || !cfg.DISCORD_CHANNEL_ID) {
    Logger.log('fetchDiscordMessages_: DISCORD_BOT_TOKEN o DISCORD_CHANNEL_ID no configurado');
    return [];
  }

  let url = DISCORD_API_BASE + '/channels/' + cfg.DISCORD_CHANNEL_ID + '/messages?limit=10';
  if (lastMsgId) url += '&after=' + lastMsgId;

  const resp = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bot ' + cfg.DISCORD_BOT_TOKEN },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    Logger.log('Discord API error: ' + resp.getContentText());
    return [];
  }

  const messages = JSON.parse(resp.getContentText());
  // Ordenar de más antiguo a más nuevo (Discord los devuelve en orden inverso)
  return messages.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Envía un mensaje de texto al canal de Discord.
 * Divide automáticamente si supera los 1900 caracteres (límite Discord: 2000).
 * Si replyToMsgId está presente, responde en hilo al mensaje original.
 */
function sendDiscordMessageToChannel_(content, replyToMsgId) {
  const cfg = getConfig();
  if (!cfg.DISCORD_BOT_TOKEN || !cfg.DISCORD_CHANNEL_ID) {
    Logger.log('sendDiscordMessageToChannel_: credenciales no configuradas');
    return false;
  }

  // Dividir en chunks de 1900 chars
  const chunks = [];
  for (let i = 0; i < content.length; i += 1900) {
    chunks.push(content.substring(i, i + 1900));
  }

  chunks.forEach((chunk, idx) => {
    const payload = { content: chunk };
    if (idx === 0 && replyToMsgId) {
      payload.message_reference = { message_id: replyToMsgId };
    }
    UrlFetchApp.fetch(
      DISCORD_API_BASE + '/channels/' + cfg.DISCORD_CHANNEL_ID + '/messages',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bot ' + cfg.DISCORD_BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
  });
  return true;
}

/**
 * Envía un embed estructurado al canal de Discord usando el Bot Token.
 * Usa el Bot Token (no el webhook) para mantener consistencia en el canal.
 */
function sendDiscordEmbedCharly_(title, description, color, fields) {
  const cfg = getConfig();

  const embed = {
    title:       (title || '').substring(0, 256),
    description: (description || '').substring(0, 4096),
    color:       color || 0x5865F2,
    timestamp:   new Date().toISOString(),
    footer:      { text: 'Charly · AVECO DataLake v2.0.0 · Apps Script' },
  };
  if (fields && fields.length) embed.fields = fields.slice(0, 25);

  // Intentar con Bot Token primero (preserva historial del canal)
  if (cfg.DISCORD_BOT_TOKEN && cfg.DISCORD_CHANNEL_ID) {
    UrlFetchApp.fetch(
      DISCORD_API_BASE + '/channels/' + cfg.DISCORD_CHANNEL_ID + '/messages',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bot ' + cfg.DISCORD_BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        payload: JSON.stringify({ embeds: [embed] }),
        muteHttpExceptions: true,
      }
    );
    return;
  }

  // Fallback al webhook existente
  sendDiscordNotification_(title, description, color);
}

// ─── Historial de Conversación ────────────────────────────────────────────────

/**
 * Retorna el historial simplificado guardado en Script Properties.
 * Solo contiene mensajes de texto (sin bloques tool_use ni tool_result).
 */
function getHistory_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(CHARLY_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Guarda el historial simplificado (últimas 8 entradas, solo texto).
 * Excluye bloques tool_use para mantener el tamaño dentro de 9KB.
 */
function saveHistory_(messages) {
  const simplified = (messages || [])
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content)
          ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
          : ''),
    }))
    .filter(m => m.content && m.content.length > 0)
    .slice(-8);  // Últimas 8 entradas = 4 intercambios

  PropertiesService.getScriptProperties()
    .setProperty(CHARLY_HISTORY_KEY, JSON.stringify(simplified));
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

/**
 * Procesa mensajes nuevos de Discord y responde con Charly.
 * Llamado por un trigger time-based cada 1 minuto.
 */
function charlyDiscordPoll() {
  // Mutex: evitar ejecuciones solapadas
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('charlyDiscordPoll: otra instancia en ejecucion, saliendo.');
    return;
  }

  try {
    const props     = PropertiesService.getScriptProperties();
    const lastMsgId = props.getProperty(CHARLY_LAST_MSG_KEY) || '';
    const messages  = fetchDiscordMessages_(lastMsgId);

    if (!messages || !messages.length) return;

    const history = getHistory_();
    let newLastId = lastMsgId;

    messages.forEach(msg => {
      // Ignorar bots (incluyendo a Charly mismo)
      if (msg.author && msg.author.bot) return;
      const texto = (msg.content || '').trim();
      if (!texto) return;

      Logger.log('Mensaje de ' + (msg.author && msg.author.username) + ': ' + texto.substring(0, 80));

      try {
        const { text, messages: newHistory } = runCharly_(texto, history);
        sendDiscordMessageToChannel_(text, msg.id);
        saveHistory_(newHistory);
        logSesionCharly({ tipo: 'discord_chat', resumen: texto.substring(0, 100), estado: 'ok' });
      } catch (e) {
        Logger.log('Error en runCharly_: ' + e.toString());
        sendDiscordMessageToChannel_(
          'Lo siento, tuve un problema al procesar tu mensaje. Intenta de nuevo.',
          msg.id
        );
      }

      newLastId = msg.id;
    });

    props.setProperty(CHARLY_LAST_MSG_KEY, newLastId);

  } finally {
    lock.releaseLock();
  }
}

/**
 * Genera y envía el briefing financiero matutino a Discord.
 * Llamado por un trigger time-based a las 6:00 AM (America/Mexico_City).
 */
function charlyBriefingDiario() {
  const fecha = Utilities.formatDate(new Date(), 'America/Mexico_City', "d 'de' MMMM 'de' yyyy");
  const prompt = [
    'Buenos días Antonio. Es ' + fecha + '.',
    'Genera el briefing financiero matutino completo:',
    '1) Estado del DataLake (hojas con datos, hojas vacías)',
    '2) Conciliación fuzzy del mes en curso con cobertura porcentual',
    '3) Top 3 pendientes más urgentes con montos',
    '4) Alerta si hay algún banco sin movimientos recientes',
  ].join(' ');

  try {
    const { text } = runCharly_(prompt, []);

    sendDiscordEmbedCharly_(
      '☀️ Briefing Matutino AVECO — ' + fecha,
      text,
      0x2ECC71,
      [
        { name: 'Modelo IA', value: CHARLY_MODEL, inline: true },
        { name: 'Modo',      value: 'Automático', inline: true },
      ]
    );

    logSesionCharly({ tipo: 'briefing_matutino', resumen: 'Briefing enviado a Discord', estado: 'ok' });

  } catch (e) {
    Logger.log('Error en charlyBriefingDiario: ' + e.toString());
    sendDiscordEmbedCharly_('❌ Error Briefing Matutino', e.toString(), 0xE74C3C);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Configura los triggers de tiempo de Charly.
 * Ejecutar UNA SOLA VEZ desde el editor de Apps Script (▶ Run).
 * Requiere autorización de la cuenta de Google para crear triggers.
 */
function setupCharly() {
  // Eliminar triggers anteriores de Charly
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'charlyDiscordPoll' || fn === 'charlyBriefingDiario') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Trigger eliminado: ' + fn);
    }
  });

  // Polling minutal (installable trigger — NO tiene el límite de 30 seg)
  ScriptApp.newTrigger('charlyDiscordPoll')
    .timeBased()
    .everyMinutes(1)
    .create();

  // Briefing diario a las 6 AM hora México
  ScriptApp.newTrigger('charlyBriefingDiario')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone('America/Mexico_City')
    .create();

  Logger.log('Triggers creados: charlyDiscordPoll (cada 1 min) + charlyBriefingDiario (6am)');

  // Anunciar en Discord
  sendDiscordEmbedCharly_(
    '🤖 Charly Online — AVECO DataLake',
    'El agente financiero está activo y escuchando en este canal.\n\n' +
    'Puedes escribirme cualquier pregunta sobre las finanzas de AVECO:\n' +
    '- *"dame el briefing de hoy"*\n' +
    '- *"¿cuántos CFDIs tengo sin conciliar?"*\n' +
    '- *"muéstrame los pendientes"*\n' +
    '- *"conciliar mayo 2026"*',
    0x5865F2
  );
}

// ─── Test Functions ───────────────────────────────────────────────────────────

/** Prueba la llamada a Claude API sin enviar a Discord. */
function testClaudeAPI() {
  Logger.log('=== TEST CLAUDE API ===');
  try {
    const resp = callClaudeAPI_([{ role: 'user', content: 'Di "Charly operando OK" y nada más.' }]);
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    Logger.log('Respuesta: ' + text);
    Logger.log('Tokens usados: ' + JSON.stringify(resp.usage));
  } catch (e) {
    Logger.log('ERROR: ' + e.toString());
  }
}

/** Prueba el flujo completo (Claude + tools) sin enviar a Discord. */
function testCharlyCompleto() {
  Logger.log('=== TEST CHARLY COMPLETO ===');
  try {
    const { text } = runCharly_('Dame el estado del DataLake y dime cuántos CFDIs hay en los últimos 30 días.', []);
    Logger.log('Respuesta de Charly:\n' + text);
  } catch (e) {
    Logger.log('ERROR: ' + e.toString());
  }
}

/** Prueba la lectura de mensajes del canal de Discord. */
function testDiscordRead() {
  Logger.log('=== TEST DISCORD READ ===');
  const msgs = fetchDiscordMessages_('');
  Logger.log('Mensajes encontrados: ' + msgs.length);
  msgs.forEach(m => {
    Logger.log('  [' + m.id + '] ' + (m.author && m.author.username) + ': ' + (m.content || '').substring(0, 80));
  });
}

/** Envía un mensaje de prueba al canal de Discord usando el Bot Token. */
function testDiscordSend() {
  Logger.log('=== TEST DISCORD SEND ===');
  sendDiscordEmbedCharly_(
    '🧪 Test Charly — Apps Script',
    'Claude API + Discord Bot funcionando correctamente desde Google Apps Script.\nSin Python. Sin n8n.',
    0x5865F2,
    [{ name: 'Estado', value: '✅ OK', inline: true }]
  );
  Logger.log('Embed enviado.');
}
