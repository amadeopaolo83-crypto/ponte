// PitPonte - il ponte tra i siti di live timing e PitComm.
//
// PitComm chiede sempre qui la classifica di un evento, in un formato unico;
// il ponte riconosce il fornitore dall'indirizzo e lo traduce. Se un fornitore
// cambia o ne arriva uno nuovo, si aggiorna solo il ponte: l'app principale
// resta accesa con carburante, gara e stato intatti.
//
//   GET /                         pagina di prova per il telefono
//   GET /api/classifica?evento=   classifica nel formato comune
//   GET /api/grezzo?evento=       risposta originale del sito (per capire i problemi)
//   GET /api/sorgente?url=        codice di una pagina esterna (come "vedi sorgente")
//   GET /api/fornitori            i traduttori disponibili
//   GET /api/salute               risponde sempre: serve a tenerlo sveglio
//
// BRIDGE_TOKEN (variabile d'ambiente): se impostato, le chiamate /api/* (tranne
// salute) richiedono l'intestazione "Authorization: Bearer <token>". Lo strumento
// "sorgente" funziona solo se il token e' impostato.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const registro = require("./registro");
const { leggiSorgente, descriviSorgente } = require("./rete");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BRIDGE_TOKEN || "";
const AVVIO = Date.now();

function rispondi(res, stato, tipo, corpo) {
  const buf = Buffer.from(corpo, "utf8");
  res.writeHead(stato, {
    "Content-Type": tipo,
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
  });
  res.end(buf);
}
const json = (res, stato, obj) => rispondi(res, stato, "application/json; charset=utf-8", JSON.stringify(obj));
const testo = (res, stato, t) => rispondi(res, stato, "text/plain; charset=utf-8", t);

function autorizzato(req) {
  if (!TOKEN) return true;
  const atteso = Buffer.from("Bearer " + TOKEN);
  const ricevuto = Buffer.from(String(req.headers.authorization || ""));
  return ricevuto.length === atteso.length && crypto.timingSafeEqual(ricevuto, atteso);
}

// Piu' richieste per lo stesso evento nello stesso istante (per esempio due
// squadre sulla stessa gara) condividono una sola lettura del sito esterno.
const cache = new Map(); // evento -> { t, promessa }
const CACHE_MS = 1500;

function classifica(evento) {
  const ora = Date.now();
  for (const [k, v] of cache) if (ora - v.t > 30000) cache.delete(k);
  const c = cache.get(evento);
  if (c && ora - c.t < CACHE_MS) return c.promessa;
  const promessa = registro.leggi(evento);
  cache.set(evento, { t: ora, promessa });
  return promessa;
}

const PAGINA = fs.readFileSync(path.join(__dirname, "pagina.html"), "utf8");

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://x");
  } catch (e) {
    return testo(res, 400, "richiesta non valida");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return testo(res, 405, "metodo non consentito");

  if (url.pathname === "/") return rispondi(res, 200, "text/html; charset=utf-8", PAGINA);

  if (url.pathname === "/api/salute") {
    return json(res, 200, { ok: true, attivoDa: Math.round((Date.now() - AVVIO) / 1000) });
  }

  if (!url.pathname.startsWith("/api/")) return testo(res, 404, "non trovato");
  if (!autorizzato(req)) return json(res, 401, { ok: false, code: "non_autorizzato", messaggio: "token mancante o errato" });

  try {
    if (url.pathname === "/api/fornitori") return json(res, 200, { ok: true, fornitori: registro.elenco() });

    if (url.pathname === "/api/classifica") {
      const r = await classifica(url.searchParams.get("evento"));
      return json(res, 200, r);
    }

    if (url.pathname === "/api/grezzo") {
      return rispondi(res, 200, "application/json; charset=utf-8", await registro.grezzo(url.searchParams.get("evento")));
    }

    if (url.pathname === "/api/sorgente") {
      if (!TOKEN) return testo(res, 403, "strumento disattivato: imposta BRIDGE_TOKEN sul ponte per usarlo");
      const pagina = await leggiSorgente(url.searchParams.get("url") || "");
      return testo(res, 200, descriviSorgente(pagina));
    }
  } catch (e) {
    return json(res, 200, { ok: false, code: "errore", messaggio: e.message || String(e) });
  }

  return testo(res, 404, "non trovato");
});

server.listen(PORT, () => console.log(`PitPonte in ascolto sulla porta ${PORT}${TOKEN ? "" : " (ATTENZIONE: nessun BRIDGE_TOKEN impostato)"}`));
