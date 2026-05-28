"""
=============================================================================
Project   : AVECO DataLake — Agente Financiero Charly
Version   : 1.0.0
Author    : Antonio Avendaño / AVECO
Email     : aveco.bancos@gmail.com
Repo      : https://github.com/avendanoco/aveco-google-apps-scripts
Created   : 2026-05-28
Updated   : 2026-05-28
Description:
    Agente IA "Charly" para conciliación financiera inteligente.
    Conecta Claude Sonnet (Anthropic) con el DataLake de Google Sheets
    via Apps Script Web App. Ejecuta fuzzy matching entre CFDIs SAT y
    movimientos bancarios, mejorando la cobertura del match exacto.
    Notifica via Discord webhooks con embeds estructurados.
    Compatible con n8n via servidor HTTP (Flask).
Config requerida (.env):
    ANTHROPIC_API_KEY     ->API key de Anthropic
    DISCORD_WEBHOOK_URL   ->Webhook del canal #finanzas en Discord
    APPS_SCRIPT_URL       ->URL del Apps Script Web App (GET-based)
    PORT                  ->Puerto del servidor HTTP (default: 8080)
Seguridad:
    No almacenar secrets en código. Usar variables de entorno (.env).
    El Apps Script URL es público por diseño (GET sin auth).
Uso:
    python charly_agent.py            ->modo conversacional (terminal)
    python charly_agent.py --server   ->servidor HTTP para n8n
    python charly_agent.py --briefing → briefing matutino directo
=============================================================================
"""

import anthropic
import requests
import json
import re
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime, timedelta, timezone
import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

# ─── Configuración ────────────────────────────────────────────────────────────────

APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
MODEL = "claude-sonnet-4-6"
DISCORD_COLOR_OK = 0x2ECC71       # verde
DISCORD_COLOR_WARN = 0xF39C12     # naranja
DISCORD_COLOR_ERROR = 0xE74C3C    # rojo

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ─── Apps Script ──────────────────────────────────────────────────────────────────

def callAppsScript_(action: str, params: dict = None) -> dict:
    """Llama un endpoint GET del Apps Script Web App"""
    if not APPS_SCRIPT_URL:
        return {"success": False, "error": "APPS_SCRIPT_URL no configurado"}
    query = {"action": action}
    if params:
        query.update({k: v for k, v in params.items() if v is not None})
    try:
        resp = requests.get(APPS_SCRIPT_URL, params=query, timeout=30, allow_redirects=True)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        return {"success": False, "error": "Timeout al llamar Apps Script"}
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": str(e)}
    except json.JSONDecodeError:
        return {"success": False, "error": "Respuesta no JSON", "raw": resp.text[:300]}


# ─── Discord ──────────────────────────────────────────────────────────────────────

def sendDiscordEmbed_(title: str, description: str, color: int = DISCORD_COLOR_OK,
                      fields: list = None, footer_text: str = "Charly v1.0.0") -> bool:
    """Envía un embed estructurado al webhook de Discord"""
    if not DISCORD_WEBHOOK_URL:
        return False
    embed = {
        "title": title,
        "description": description,
        "color": color,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": footer_text},
    }
    if fields:
        embed["fields"] = fields
    try:
        r = requests.post(
            DISCORD_WEBHOOK_URL,
            json={"embeds": [embed]},
            timeout=10,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


def sendDiscordMessage_(content: str) -> bool:
    """Envía un mensaje de texto plano a Discord (para respuestas largas de Charly)"""
    if not DISCORD_WEBHOOK_URL:
        return False
    # Discord tiene límite de 2000 chars por mensaje
    chunks = [content[i:i+1900] for i in range(0, len(content), 1900)]
    try:
        for chunk in chunks:
            r = requests.post(DISCORD_WEBHOOK_URL, json={"content": chunk}, timeout=10)
            if r.status_code not in (200, 204):
                return False
        return True
    except Exception:
        return False


# ─── Fuzzy Matching ───────────────────────────────────────────────────────────────

_SUFIJOS_EMPRESA = [
    r"\bsa\s*de\s*cv\b", r"\bs\.a\.\s*de\s*c\.v\.\b", r"\bs\.a\.s\.\b",
    r"\bsapi\b", r"\bsrl\b", r"\bsc\b", r"\bsa\b", r"\bde\s*cv\b",
    r"\bmexicana?\b", r"\bmx\b", r"\btulum\b",
]


def normalizarNombre_(nombre: str) -> str:
    """Normaliza nombre de empresa para comparación fuzzy"""
    if not nombre:
        return ""
    texto = unicodedata.normalize("NFD", str(nombre).lower())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    for suf in _SUFIJOS_EMPRESA:
        texto = re.sub(suf, "", texto)
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def calcularSimilitud_(a: str, b: str) -> float:
    na, nb = normalizarNombre_(a), normalizarNombre_(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def montoEnTolerancia_(a: float, b: float, tol: float = 0.05) -> bool:
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    return abs(a - b) / max(abs(a), abs(b)) <= tol


def fechasCercanas_(fa: str, fb: str, dias: int = 7) -> bool:
    try:
        return abs((
            datetime.strptime(str(fa)[:10], "%Y-%m-%d")
            - datetime.strptime(str(fb)[:10], "%Y-%m-%d")
        ).days) <= dias
    except (ValueError, TypeError):
        return False


def ejecutarFuzzyConciliacion(
    desde: str = None,
    hasta: str = None,
    toleranciaMonto: float = 0.05,
    similitudNombre: float = 0.70,
) -> dict:
    """
    Conciliación inteligente SAT vs Bancarios con fuzzy matching.
    Score = similitud_nombre×50 + match_monto×30 + match_fecha×20
    Confirmado ≥ 70 | Posible 30–69 | Sin match < 30
    """
    hoy = datetime.now()
    desde = desde or (hoy - timedelta(days=90)).strftime("%Y-%m-%d")
    hasta = hasta or hoy.strftime("%Y-%m-%d")

    cfdisResp = callAppsScript_("getSATCFDIs", {"desde": desde, "hasta": hasta, "limite": 500})
    bancResp = callAppsScript_("getBancarios", {"desde": desde, "hasta": hasta, "limite": 1000})

    if not cfdisResp.get("success"):
        return {"error": f"CFDIs: {cfdisResp.get('error')}"}
    if not bancResp.get("success"):
        return {"error": f"Bancarios: {bancResp.get('error')}"}

    cfdis = cfdisResp.get("cfdis", cfdisResp.get("data", []))
    bancs = bancResp.get("movimientos", bancResp.get("data", []))

    confirmados, posibles, sinMatch = [], [], []
    usadosBanc = set()

    for cfdi in cfdis:
        nombreCfdi = cfdi.get("nombre_emisor", cfdi.get("razon_social", ""))
        montoCfdi = abs(float(cfdi.get("total", cfdi.get("monto", 0)) or 0))
        fechaCfdi = cfdi.get("fecha", cfdi.get("fecha_emision", ""))
        uuid = cfdi.get("uuid", cfdi.get("id", ""))

        if not montoCfdi:
            continue

        candidatos = []
        for i, b in enumerate(bancs):
            if i in usadosBanc:
                continue
            desc = b.get("descripcion", b.get("descripcion_limpia", b.get("nota", "")))
            montoB = abs(float(b.get("monto", 0) or 0))
            fechaB = b.get("fecha", "")

            sim = calcularSimilitud_(nombreCfdi, desc)
            okMonto = montoEnTolerancia_(montoCfdi, montoB, toleranciaMonto)
            okFecha = fechasCercanas_(fechaCfdi, fechaB)

            if sim < 0.25 and not okMonto:
                continue

            score = sim * 50 + (30 if okMonto else 0) + (20 if okFecha else 0)
            if score >= 30:
                candidatos.append({"idx": i, "b": b, "score": score,
                                    "sim": sim, "okMonto": okMonto, "okFecha": okFecha})

        candidatos.sort(key=lambda x: x["score"], reverse=True)

        if not candidatos:
            sinMatch.append({"uuid": uuid, "nombre_emisor": nombreCfdi,
                              "monto": montoCfdi, "fecha": fechaCfdi})
            continue

        m = candidatos[0]
        entry = {
            "cfdi": {"uuid": uuid, "nombre_emisor": nombreCfdi,
                     "monto": montoCfdi, "fecha": fechaCfdi},
            "match": {
                "descripcion": m["b"].get("descripcion", ""),
                "monto": abs(float(m["b"].get("monto", 0) or 0)),
                "fecha": m["b"].get("fecha", ""),
                "banco": m["b"].get("banco", ""),
                "id_interno": m["b"].get("id_interno", ""),
            },
            "score": round(m["score"], 1),
            "similitud_nombre": round(m["sim"], 2),
            "match_monto": m["okMonto"],
            "match_fecha": m["okFecha"],
        }

        if m["score"] >= 70:
            confirmados.append(entry)
            usadosBanc.add(m["idx"])
        else:
            posibles.append(entry)

    return {
        "periodo": f"{desde} a {hasta}",
        "total_cfdis_analizados": len(cfdis),
        "total_bancarios_analizados": len(bancs),
        "matches_confirmados": confirmados,
        "matches_posibles": posibles,
        "cfdis_sin_match": sinMatch,
        "tolerancias": {
            "monto_pct": f"{toleranciaMonto*100:.0f}%",
            "similitud_min": f"{similitudNombre*100:.0f}%",
        },
        "resumen": {
            "confirmados": len(confirmados),
            "posibles": len(posibles),
            "sin_match": len(sinMatch),
            "cobertura_pct": round(len(confirmados) / max(len(cfdis), 1) * 100, 1),
        },
    }


# ─── Tools (Claude API) ───────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "get_status",
        "description": "Estado del DataLake: filas por hoja, movimientos pendientes de revisión.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_resumen_diario",
        "description": "Resumen diario: conciliación 30 días, transacciones recientes y pendientes.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_sat_cfdis",
        "description": "CFDIs del SAT filtrados. Campos: uuid, nombre_emisor, rfc_emisor, total, fecha.",
        "input_schema": {
            "type": "object",
            "properties": {
                "desde": {"type": "string", "description": "YYYY-MM-DD"},
                "hasta": {"type": "string", "description": "YYYY-MM-DD"},
                "limite": {"type": "integer", "default": 100},
            },
            "required": [],
        },
    },
    {
        "name": "get_bancarios",
        "description": "Movimientos bancarios. Bancos: BBVA, FONDEADORA, TC CLARA, TC KONFIO, DOLAR APP USD, SANTANDER.",
        "input_schema": {
            "type": "object",
            "properties": {
                "desde": {"type": "string"},
                "hasta": {"type": "string"},
                "banco": {"type": "string"},
                "tipo": {"type": "string", "description": "EGRESO o INGRESO"},
                "limite": {"type": "integer", "default": 50},
            },
            "required": [],
        },
    },
    {
        "name": "get_conciliacion",
        "description": "Reporte de conciliación básica (match exacto) SAT vs Board.",
        "input_schema": {
            "type": "object",
            "properties": {
                "desde": {"type": "string"},
                "hasta": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "get_pending_review",
        "description": "Movimientos pendientes de revisión humana con tipo de problema detectado.",
        "input_schema": {
            "type": "object",
            "properties": {"limite": {"type": "integer", "default": 10}},
            "required": [],
        },
    },
    {
        "name": "save_decision",
        "description": "Guarda decisión sobre un movimiento: categoría, obra y estado.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id_interno": {"type": "string"},
                "categoria": {"type": "string"},
                "obra": {"type": "string", "description": "AM07, AM08, AM09, AM10, TULUM"},
                "estado": {"type": "string", "description": "revisado | aprobado | rechazado"},
            },
            "required": ["id_interno", "estado"],
        },
    },
    {
        "name": "fuzzy_conciliar",
        "description": (
            "Conciliación INTELIGENTE con fuzzy matching. "
            "Usa similitud de nombres (normalizada, sin sufijos SA de CV), "
            "tolerancia ±5% en montos y ventana ±7 días en fechas. "
            "Mucho mejor que el match exacto para proveedores como Chakjuha, Construrent, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "desde": {"type": "string", "description": "YYYY-MM-DD (default: últimos 90 días)"},
                "hasta": {"type": "string", "description": "YYYY-MM-DD (default: hoy)"},
                "tolerancia_monto": {"type": "number", "description": "0.0–1.0 (default 0.05)"},
                "similitud_nombre": {"type": "number", "description": "0.0–1.0 (default 0.70)"},
            },
            "required": [],
        },
        "cache_control": {"type": "ephemeral"},
    },
]


def executeTool_(name: str, inp: dict) -> str:
    """Ejecuta un tool y retorna el resultado como JSON string"""
    try:
        if name == "get_status":
            result = callAppsScript_("getStatus")
        elif name == "get_resumen_diario":
            result = callAppsScript_("getResumenDiario")
        elif name == "get_sat_cfdis":
            result = callAppsScript_("getSATCFDIs", inp)
        elif name == "get_bancarios":
            result = callAppsScript_("getBancarios", inp)
        elif name == "get_conciliacion":
            result = callAppsScript_("getConciliacion", inp)
        elif name == "get_pending_review":
            result = callAppsScript_("getPendingReview", inp)
        elif name == "save_decision":
            result = callAppsScript_("saveDecision", inp)
        elif name == "fuzzy_conciliar":
            result = ejecutarFuzzyConciliacion(
                desde=inp.get("desde"),
                hasta=inp.get("hasta"),
                toleranciaMonto=float(inp.get("tolerancia_monto", 0.05)),
                similitudNombre=float(inp.get("similitud_nombre", 0.70)),
            )
        else:
            result = {"error": f"Tool desconocido: {name}"}
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── System Prompt ────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres Charly, el agente financiero IA de AVECO Arquitectura Avanzada en Ecología y Construcción.

MISIÓN: Ayudar a Antonio Avendaño (Director General) con conciliación financiera entre:
- CFDIs del SAT (facturas de proveedores)
- Movimientos bancarios (Santander MXN, BBVA, Fondeadora, TC Clara, TC Konfio, TD Dólar USD)
- Board/BudgetBakers (contabilidad interna — API solo lectura)

OBRAS ACTIVAS: AM07, AM08, AM09, AM10, Tulum (construcción en la Riviera Maya)
CATEGORÍAS: Materiales de construcción, Mano de obra, Equipo y maquinaria, Gastos operativos, Nómina

CÓMO OPERAR:
1. Briefing matutino → `get_resumen_diario` + `fuzzy_conciliar` mes actual
2. Encontrar CFDIs sin match → `fuzzy_conciliar` (mejora el match exacto)
3. Revisar pendientes → `get_pending_review`, si confianza >80% usa `save_decision`
4. Consultas específicas → `get_sat_cfdis` o `get_bancarios` con filtros

FORMATO (Discord):
- Español siempre
- Texto claro y accionable, emojis moderados
- Montos: $1,234,567.89 MXN o USD
- Máximo 5–7 puntos clave por respuesta
- Para reportes usa listas simples (guiones)

REGLA DE ORO: Score <70 → marca como "posible", no confirmes sin certeza."""


# ─── Agente ───────────────────────────────────────────────────────────────────────

def runCharly(
    userMessage: str,
    conversationHistory: list = None,
    maxIterations: int = 12,
) -> tuple:
    """
    Ejecuta el agente Charly con tool use.
    Retorna (respuesta_final_str, historial_actualizado).
    """
    if conversationHistory is None:
        conversationHistory = []

    messages = conversationHistory + [{"role": "user", "content": userMessage}]

    for _ in range(maxIterations):
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=[{"type": "text", "text": SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            finalText = "".join(b.text for b in response.content if hasattr(b, "text"))
            messages.append({"role": "assistant", "content": response.content})
            return finalText, messages

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            toolResults = [
                {
                    "type": "tool_result",
                    "tool_use_id": b.id,
                    "content": executeTool_(b.name, b.input),
                }
                for b in response.content
                if b.type == "tool_use"
            ]
            messages.append({"role": "user", "content": toolResults})
            continue

        break

    return "Límite de iteraciones alcanzado. Por favor reformula la pregunta.", messages


# ─── Flask Server para n8n ─────────────────────────────────────────────────────────

flaskApp = Flask(__name__)


@flaskApp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "agente": "Charly AVECO", "modelo": MODEL})


@flaskApp.route("/charly", methods=["POST"])
def charlyEndpoint():
    """Endpoint principal — n8n hace POST {"mensaje": "..."}"""
    data = request.get_json(force=True) or {}
    mensaje = data.get("mensaje", data.get("message", data.get("text", "")))
    historial = data.get("historial", [])

    if not mensaje:
        return jsonify({"error": "Campo 'mensaje' requerido"}), 400

    respuesta, historialNuevo = runCharly(mensaje, historial)

    if DISCORD_WEBHOOK_URL:
        sendDiscordMessage_(f"**Consulta:** {mensaje}\n\n**Charly:** {respuesta}")

    return jsonify({
        "respuesta": respuesta,
        "historial": historialNuevo[-20:],
        "timestamp": datetime.now().isoformat(),
    })


@flaskApp.route("/briefing", methods=["GET", "POST"])
def briefingMatutino():
    """Briefing matutino — llamado por n8n cron a las 6am"""
    fecha = datetime.now().strftime("%d de %B de %Y")
    mensaje = (
        f"Buenos días Antonio. Es {fecha}. "
        "Genera el briefing financiero matutino: "
        "1) resumen diario del DataLake, "
        "2) conciliación fuzzy del mes actual, "
        "3) top 3 pendientes urgentes."
    )
    respuesta, _ = runCharly(mensaje)

    sendDiscordEmbed_(
        title=f"☀️ Briefing Matutino AVECO — {fecha}",
        description=respuesta,
        color=DISCORD_COLOR_OK,
        fields=[{"name": "Generado por", "value": "Charly IA", "inline": True},
                {"name": "Modelo", "value": MODEL, "inline": True}],
    )

    return jsonify({"respuesta": respuesta, "timestamp": datetime.now().isoformat()})


@flaskApp.route("/conciliar", methods=["POST"])
def conciliar():
    """Conciliación inteligente para un período"""
    data = request.get_json(force=True) or {}
    desde = data.get("desde", (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d"))
    hasta = data.get("hasta", datetime.now().strftime("%Y-%m-%d"))

    mensaje = (
        f"Ejecuta conciliación fuzzy del {desde} al {hasta}. "
        "Muestra cuántos CFDIs nuevos puedes conciliar vs el sistema básico, "
        "y lista los 5 matches más importantes."
    )
    respuesta, _ = runCharly(mensaje)

    sendDiscordEmbed_(
        title=f"🔍 Conciliación Inteligente {desde} → {hasta}",
        description=respuesta,
        color=DISCORD_COLOR_WARN,
    )

    return jsonify({"respuesta": respuesta, "timestamp": datetime.now().isoformat()})


# ─── Test Functions ───────────────────────────────────────────────────────────────

def testConectividad():
    """Verifica conexión con Apps Script y Discord sin modificar datos"""
    print("=== Test de conectividad ===")

    print("\n1. Apps Script ping...")
    r = callAppsScript_("ping")
    print(f"   ->{r}")

    print("\n2. Discord webhook...")
    ok = sendDiscordEmbed_(
        title="✅ Charly Test — AVECO",
        description="Conectividad verificada correctamente.",
        color=DISCORD_COLOR_OK,
        footer_text="Test — no es un reporte real",
    )
    print(f"   ->{'OK' if ok else 'FALLO (verificar DISCORD_WEBHOOK_URL)'}")

    print("\n3. Apps Script status...")
    r2 = callAppsScript_("getStatus")
    print(f"   ->success={r2.get('success')} | error={r2.get('error','ninguno')}")
    print("=== Fin del test ===")


def testFuzzyMatching():
    """Prueba fuzzy matching con un rango de 30 días sin escribir al DataLake"""
    print("=== Test fuzzy matching (30 días) ===")
    desde = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    hasta = datetime.now().strftime("%Y-%m-%d")
    resultado = ejecutarFuzzyConciliacion(desde=desde, hasta=hasta)
    print(json.dumps(resultado.get("resumen", resultado), indent=2, ensure_ascii=False))


# ─── Entry Point ──────────────────────────────────────────────────────────────────

def _modoInteractivo():
    print("🤖 Charly — Agente Financiero AVECO  (escribe 'salir' para terminar)\n")
    historial = []
    while True:
        try:
            entrada = input("Antonio: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nHasta luego.")
            break
        if entrada.lower() in ("salir", "exit", "quit"):
            print("Hasta luego.")
            break
        if not entrada:
            continue
        print("Charly: pensando...", flush=True)
        respuesta, historial = runCharly(entrada, historial)
        print(f"\nCharly: {respuesta}\n")


if __name__ == "__main__":
    import sys

    if "--server" in sys.argv:
        port = int(os.getenv("PORT", 8080))
        print(f"🚀 Charly server en http://localhost:{port}")
        flaskApp.run(host="0.0.0.0", port=port, debug=False)
    elif "--briefing" in sys.argv:
        fecha = datetime.now().strftime("%d de %B de %Y")
        msg = f"Genera el briefing matutino completo de {fecha} con resumen diario y conciliación fuzzy del mes actual."
        respuesta, _ = runCharly(msg)
        print(respuesta)
        sendDiscordEmbed_(f"☀️ Briefing {fecha}", respuesta, DISCORD_COLOR_OK)
    elif "--test" in sys.argv:
        testConectividad()
    else:
        _modoInteractivo()
