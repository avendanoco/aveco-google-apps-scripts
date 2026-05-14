// ============================================================
// ULTRAHUMAN HEALTH IMPORTER — AVECO Dashboard
// Autor: Antonio Avendaño | AVECO
// Versión: 3.0 | Mayo 2026
// CORRECCIÓN: Mapeo correcto del JSON real de la API
// Estructura: json.data.metrics["YYYY-MM-DD"] = array de {type, object}
// ============================================================

const ULTRAHUMAN_TOKEN = "TU_ULTRAHUMAN_TOKEN_AQUI";  // <-- Pega aquí tu token de Ultrahuman
const BASE_URL = "https://partner.ultrahuman.com/api/v1/partner/daily_metrics";
const TELEGRAM_BOT_TOKEN = "TU_BOT_TOKEN_AQUI";    // <-- Pega aquí el token de @BotFather
const TELEGRAM_CHAT_ID   = "TU_CHAT_ID_AQUI";      // <-- Pega aquí tu Chat ID (ej: 123456789)

// ============================================================
// HELPER: Extrae métrica del array por tipo
// ============================================================
function getMetric(metricsArray, type) {
  const m = metricsArray.find(function(x) { return x.type === type; });
  return m ? m.object : null;
}

// Helper: valor único directo (object.value)
function getVal(metricsArray, type) {
  const obj = getMetric(metricsArray, type);
  return obj ? toNumberSafe(obj.value) : null;
}

// Helper: promedio de serie de tiempo (object.avg)
function getAvg(metricsArray, type) {
  const obj = getMetric(metricsArray, type);
  return obj ? toNumberSafe(obj.avg) : null;
}

// Helper: última lectura de serie (object.last_reading)
function getLastReading(metricsArray, type) {
  const obj = getMetric(metricsArray, type);
  return obj ? toNumberSafe(obj.last_reading) : null;
}

// ============================================================
// FUNCIÓN PRINCIPAL
// ============================================================
function importarSaludHoy() {
  const hoy = getTodayMexicoDate();
  importarFecha(hoy);
}

function importarUltimos30Dias() {
  const fechas = getLastNDates(30);
  fechas.forEach(function(fecha) {
    importarFecha(fecha);
    Utilities.sleep(800);
  });
}

// ============================================================
// IMPORTADOR POR FECHA
// ============================================================
function importarFecha(fecha) {
  Logger.log("📋 Importando: " + fecha);

  const url = BASE_URL + "?date=" + fecha;
  const options = {
    method: "GET",
    headers: { "Authorization": ULTRAHUMAN_TOKEN },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code !== 200) {
    Logger.log("❌ Error API (" + code + "): " + response.getContentText().substring(0, 200));
    return;
  }

  const json = JSON.parse(response.getContentText());
  
  // La estructura real es: json.data.metrics["YYYY-MM-DD"] = array
  const metricsObj = json.data && json.data.metrics;
  if (!metricsObj) {
    Logger.log("⚠️ Sin datos para: " + fecha);
    return;
  }

  // La key del array puede ser la fecha exacta o la primera key disponible
  let metricsArray = metricsObj[fecha];
  if (!metricsArray) {
    const keys = Object.keys(metricsObj);
    if (keys.length === 0) { Logger.log("⚠️ Array vacío para: " + fecha); return; }
    metricsArray = metricsObj[keys[0]];
  }

  if (!metricsArray || metricsArray.length === 0) {
    Logger.log("⚠️ Sin métricas para: " + fecha);
    return;
  }

  Logger.log("✅ " + metricsArray.length + " métricas recibidas para " + fecha);

  guardarSleep(fecha, metricsArray);
  guardarRecovery(fecha, metricsArray);
  guardarMovimiento(fecha, metricsArray);
  guardarBiometricos(fecha, metricsArray);
}

// ============================================================
// MÓDULO: SLEEP
// El tipo "sleep" contiene TODOS los campos directamente en object
// ============================================================
function guardarSleep(fecha, metricsArray) {
  const sheet = getOrCreateSheet("🌙 Sleep");
  const headers = [
    "Fecha", "Sleep Score", "Total Sleep (min)", "Deep Sleep (min)",
    "Light Sleep (min)", "REM Sleep (min)", "Time in Bed (min)",
    "Sleep Efficiency (%)", "Sleep RHR", "Avg Sleep HRV",
    "Morning Alertness", "Full Sleep Cycles", "Tosses & Turns",
    "HR Drop", "Restorative Sleep", "Movements", "Avg Body Temp"
  ];
  ensureHeaders(sheet, headers);
  if (fechaExiste(sheet, fecha)) { Logger.log("⏭ Sleep ya existe: " + fecha); return; }

  const sleep = getMetric(metricsArray, "sleep");
  const avgSleepHrv = getVal(metricsArray, "avg_sleep_hrv");
  const sleepRhr = getVal(metricsArray, "sleep_rhr");

  const row = [
    fecha,
    sleep ? toNumberSafe(sleep.sleep_score) : null,
    sleep ? toNumberSafe(sleep.total_sleep) : null,
    sleep ? toNumberSafe(sleep.deep_sleep) : null,
    sleep ? toNumberSafe(sleep.light_sleep) : null,
    sleep ? toNumberSafe(sleep.rem_sleep) : null,
    sleep ? toNumberSafe(sleep.time_in_bed) : null,
    sleep ? toNumberSafe(sleep.sleep_efficiency) : null,
    sleepRhr,
    avgSleepHrv,
    sleep ? toNumberSafe(sleep.morning_alertness) : null,
    sleep ? toNumberSafe(sleep.full_sleep_cycles) : null,
    sleep ? toNumberSafe(sleep.tosses_and_turns) : null,
    sleep ? toNumberSafe(sleep.hr_drop) : null,
    sleep ? toNumberSafe(sleep.restorative_sleep) : null,
    sleep ? toNumberSafe(sleep.movements) : null,
    sleep ? toNumberSafe(sleep.average_body_temperature) : null
  ];

  sheet.appendRow(row);
  Logger.log("✅ Sleep guardado: " + fecha);
}

// ============================================================
// MÓDULO: RECOVERY
// ============================================================
function guardarRecovery(fecha, metricsArray) {
  const sheet = getOrCreateSheet("💚 Recovery");
  const headers = [
    "Fecha", "Night RHR", "HRV (avg)", "SPO2 (avg)",
    "Temp Prom (°C)", "Sleep (hrs)", "Avg Sleep HRV"
  ];
  ensureHeaders(sheet, headers);
  if (fechaExiste(sheet, fecha)) { Logger.log("⏭ Recovery ya existe: " + fecha); return; }

  const sleep = getMetric(metricsArray, "sleep");

  const row = [
    fecha,
    getAvg(metricsArray, "night_rhr"),           // avg de noche
    getAvg(metricsArray, "hrv"),                  // avg HRV
    getAvg(metricsArray, "spo2"),                 // avg SPO2
    getAvg(metricsArray, "temp"),                 // avg temperatura
    sleep && sleep.total_sleep ? (toNumberSafe(sleep.total_sleep) / 60).toFixed(2) : null,
    getVal(metricsArray, "avg_sleep_hrv")
  ];

  sheet.appendRow(row);
  Logger.log("✅ Recovery guardado: " + fecha);
}

// ============================================================
// MÓDULO: MOVIMIENTO
// ============================================================
function guardarMovimiento(fecha, metricsArray) {
  const sheet = getOrCreateSheet("🏃 Movimiento");
  const headers = [
    "Fecha", "Steps (total)", "Steps (avg)", "Inactive Time (min)",
    "Weekly Active Min", "VO2 Max"
  ];
  ensureHeaders(sheet, headers);
  if (fechaExiste(sheet, fecha)) { Logger.log("⏭ Movimiento ya existe: " + fecha); return; }

  // steps tiene un objeto con "total" y "avg" dentro del array de values
  const stepsObj = getMetric(metricsArray, "steps");
  const stepsTotal = stepsObj ? toNumberSafe(stepsObj.total) : null;
  const stepsAvg = stepsObj ? toNumberSafe(stepsObj.avg) : null;

  const row = [
    fecha,
    stepsTotal,
    stepsAvg,
    getVal(metricsArray, "inactive_time"),
    getVal(metricsArray, "weekly_active_minutes"),
    getVal(metricsArray, "vo2_max")
  ];

  sheet.appendRow(row);
  Logger.log("✅ Movimiento guardado: " + fecha);
}

// ============================================================
// MÓDULO: BIOMETRICOS
// ============================================================
function guardarBiometricos(fecha, metricsArray) {
  const sheet = getOrCreateSheet("❤️ Biometricos");
  const headers = [
    "Fecha", "HR Prom (BPM)", "HR Última", "Temp Prom (°C)",
    "HRV Prom", "SPO2 Prom (%)", "Night RHR"
  ];
  ensureHeaders(sheet, headers);
  if (fechaExiste(sheet, fecha)) { Logger.log("⏭ Biometricos ya existe: " + fecha); return; }

  const row = [
    fecha,
    getAvg(metricsArray, "hr"),
    getLastReading(metricsArray, "hr"),
    getAvg(metricsArray, "temp"),
    getAvg(metricsArray, "hrv"),
    getAvg(metricsArray, "spo2"),
    getAvg(metricsArray, "night_rhr")
  ];

  sheet.appendRow(row);
  Logger.log("✅ Biometricos guardado: " + fecha);
}

// ============================================================
// HELPERS: HOJAS
// ============================================================
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
}

function fechaExiste(sheet, fecha) {
  if (sheet.getLastRow() < 2) return false;
  const fechas = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  return fechas.indexOf(fecha) !== -1;
}

// ============================================================
// HELPERS: FECHAS
// ============================================================
function getTodayMexicoDate() {
  return Utilities.formatDate(new Date(), "America/Cancun", "yyyy-MM-dd");
}

function getLastNDates(n) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(Utilities.formatDate(d, "America/Cancun", "yyyy-MM-dd"));
  }
  return dates;
}

function toNumberSafe(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🏥 AVECO Health")
    .addItem("📥 Importar Hoy", "importarSaludHoy")
    .addItem("📅 Importar Últimos 30 Días", "importarUltimos30Dias")
    .addToUi();
}

// ============================================================
// MÓDULO: IMPORTACIÓN HORARIA (para monitoreo en tiempo real)
// Corre cada hora — captura HR, HRV, Temp, SPO2, Steps en vivo
// ============================================================
function importarHorario() {
  const fecha = getTodayMexicoDate();
  Logger.log("⏰ Importación horaria: " + fecha);

  const url = BASE_URL + "?date=" + fecha;
  const options = {
    method: "GET",
    headers: { "Authorization": ULTRAHUMAN_TOKEN },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) { Logger.log("❌ Error horario (" + code + ")"); return; }

  const json = JSON.parse(response.getContentText());
  const metricsObj = json.data && json.data.metrics;
  if (!metricsObj) return;

  let metricsArray = metricsObj[fecha];
  if (!metricsArray) {
    const keys = Object.keys(metricsObj);
    if (!keys.length) return;
    metricsArray = metricsObj[keys[0]];
  }
  if (!metricsArray || !metricsArray.length) return;

  // Guardar en hoja de monitoreo horario
  guardarMonitoreoHorario(metricsArray);

  // Verificar alertas de salud
  verificarAlertas(metricsArray);
}

// ============================================================
// MÓDULO: HOJA DE MONITOREO HORARIO (registro continuo)
// ============================================================
function guardarMonitoreoHorario(metricsArray) {
  const sheet = getOrCreateSheet("📡 Monitoreo");
  const headers = [
    "Timestamp", "Fecha", "Hora (CDMX)",
    "HR Prom (BPM)", "HR Última", "HRV Prom",
    "Temp Prom (°C)", "SPO2 Prom (%)", "Steps Total",
    "Night RHR"
  ];
  ensureHeaders(sheet, headers);

  const tz = "America/Cancun";
  const now = new Date();
  const timestamp = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  const fecha = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const hora = Utilities.formatDate(now, tz, "HH:mm");

  const stepsObj = getMetric(metricsArray, "steps");

  const row = [
    timestamp,
    fecha,
    hora,
    getAvg(metricsArray, "hr"),
    getLastReading(metricsArray, "hr"),
    getAvg(metricsArray, "hrv"),
    getAvg(metricsArray, "temp"),
    getAvg(metricsArray, "spo2"),
    stepsObj ? toNumberSafe(stepsObj.total) : null,
    getAvg(metricsArray, "night_rhr")
  ];

  sheet.appendRow(row);
  Logger.log("✅ Monitoreo horario guardado: " + timestamp);
}

// ============================================================
// MÓDULO: ALERTAS INTELIGENTES DE SALUD
// Envía email si detecta valores fuera de rango clínicamente relevante
// ============================================================
function verificarAlertas(metricsArray) {
  const alertas = [];
  const tz = "America/Cancun";
  const hora = Utilities.formatDate(new Date(), tz, "HH:mm");

  // Umbrales configurables
  const LIMITES = {
    hr_alto: 100,        // BPM máximo
    hr_bajo: 45,         // BPM mínimo
    spo2_bajo: 94,       // % mínimo (< 94 es preocupante)
    temp_alta: 37.5,     // °C máximo
    temp_baja: 35.5,     // °C mínimo
    hrv_bajo: 20         // ms mínimo (HRV muy bajo = estrés alto)
  };

  const hrProm = getAvg(metricsArray, "hr");
  const hrUltima = getLastReading(metricsArray, "hr");
  const spo2 = getAvg(metricsArray, "spo2");
  const temp = getAvg(metricsArray, "temp");
  const hrv = getAvg(metricsArray, "hrv");

  if (hrProm && hrProm > LIMITES.hr_alto)
    alertas.push("🔴 ALERTA: Frecuencia cardíaca ALTA promedio: " + hrProm.toFixed(0) + " BPM (límite: " + LIMITES.hr_alto + ")");

  if (hrUltima && hrUltima > LIMITES.hr_alto)
    alertas.push("🔴 ALERTA: Última lectura HR ALTA: " + hrUltima + " BPM");

  if (hrProm && hrProm < LIMITES.hr_bajo)
    alertas.push("🔴 ALERTA: Frecuencia cardíaca MUY BAJA: " + hrProm.toFixed(0) + " BPM (límite: " + LIMITES.hr_bajo + ")");

  if (spo2 && spo2 < LIMITES.spo2_bajo)
    alertas.push("🚨 CRÍTICO: SpO2 BAJO: " + spo2.toFixed(1) + "% — considerar atención médica");

  if (temp && temp > LIMITES.temp_alta)
    alertas.push("🌡️ ALERTA: Temperatura ELEVADA: " + temp.toFixed(2) + "°C");

  if (temp && temp < LIMITES.temp_baja)
    alertas.push("🌡️ ALERTA: Temperatura BAJA: " + temp.toFixed(2) + "°C");

  if (hrv && hrv < LIMITES.hrv_bajo)
    alertas.push("⚠️ AVISO: HRV MUY BAJO: " + hrv.toFixed(0) + " ms — posible estrés elevado o fatiga");

  if (alertas.length > 0) {
    // Construir mensaje para Telegram (formato Markdown)
    const texto = [
      "*🚨 AVECO Health ALERTA — " + hora + " CDMX*",
      "",
      alertas.join("\n"),
      "",
      "*📊 Datos actuales:*",
      "• HR promedio: " + (hrProm ? hrProm.toFixed(0) + " BPM" : "N/A"),
      "• HR última: " + (hrUltima || "N/A") + " BPM",
      "• HRV: " + (hrv ? hrv.toFixed(0) + " ms" : "N/A"),
      "• Temp: " + (temp ? temp.toFixed(2) + "°C" : "N/A"),
      "• SpO2: " + (spo2 ? spo2.toFixed(1) + "%" : "N/A"),
      "",
      "\_AVECO Health Dashboard v3\.0\_"
    ].join("\n");

    // Enviar a Telegram via Bot API
    if (TELEGRAM_BOT_TOKEN !== "TU_BOT_TOKEN_AQUI" && TELEGRAM_CHAT_ID !== "TU_CHAT_ID_AQUI") {
      const telegramUrl = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
      UrlFetchApp.fetch(telegramUrl, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: texto,
          parse_mode: "Markdown"
        }),
        muteHttpExceptions: true
      });
      Logger.log("💬 Alerta enviada a Telegram: " + alertas.length + " anomalías detectadas");
    } else {
      Logger.log("⚠️ Telegram no configurado. Agrega TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (líneas 11-12)");
    }
    Logger.log("📨 Total alertas disparadas: " + alertas.length);

    // También registrar alerta en hoja
    const sheetAlertas = getOrCreateSheet("🚨 Alertas");
    if (sheetAlertas.getLastRow() === 0) {
      sheetAlertas.appendRow(["Timestamp", "Hora", "Tipo de Alerta", "Valor"]);
      sheetAlertas.getRange(1,1,1,4).setFontWeight("bold").setBackground("#7f0000").setFontColor("#ffffff");
      sheetAlertas.setFrozenRows(1);
    }
    const tsAlerta = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    alertas.forEach(function(a) {
      sheetAlertas.appendRow([tsAlerta, hora, a, ""]);
    });
  } else {
    Logger.log("✅ Sin alertas — todos los valores en rango normal");
  }
}

// ============================================================
// SETUP AUTOMÁTICO DE TRIGGERS
// Ejecuta esta función UNA VEZ manualmente para instalar los triggers
// ============================================================
function configurarTriggers() {
  // Eliminar triggers existentes para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // TRIGGER 1: Importación diaria a las 9 AM hora CDMX
  ScriptApp.newTrigger("importarSaludHoy")
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone("America/Cancun")
    .create();

  // TRIGGER 2: Monitoreo horario (cada hora)
  ScriptApp.newTrigger("importarHorario")
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log("✅ Triggers configurados:");
  Logger.log("  → Diario: importarSaludHoy a las 9:00 AM CDMX");
  Logger.log("  → Horario: importarHorario cada 1 hora");
  Logger.log("✅ Automatizacion activada: 9AM diario + horario cada 1 hora + alertas por email");
}
