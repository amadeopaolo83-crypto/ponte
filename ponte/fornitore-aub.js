// Traduttore per AUB Racing (la piattaforma "racedata" della squadra).
//
// A differenza di FICR qui non si legge un sito di live timing: Aub ha gia' le sue
// codifiche e offre una API di sola lettura con una chiave della squadra. Il ponte
// la chiama con la chiave e traduce la risposta nel formato comune.
//
// Si configura SOLO con variabili d'ambiente del ponte (mai nell'app, mai in chat):
//   AUB_BASE   indirizzo del servizio, quello che mostra il portale della squadra
//              quando crea la chiave (https://...)
//   AUB_KEY    la chiave (inizia con aubk_)
//   AUB_TZ     facoltativa: fuso orario del circuito per leggere le fasi della gara
//              (predefinito Europe/Rome)
//
// In PitComm, come "indirizzo dell'evento", si scrive https://aub (oppure
// l'indirizzo di AUB_BASE): serve solo a scegliere questo traduttore. La
// destinazione delle chiamate e' sempre AUB_BASE, mai quella digitata da chi usa
// l'app, quindi nessuno puo' far chiamare al ponte un indirizzo a piacere.
//
// Chiamate usate (documento "Connected Apps API", versione 1, ottobre 2026):
//   GET /classifica   classifica live: pos, number, name, category, laps, bestlap,
//                     laptime, gap (dal primo), diff (dall'auto davanti), myself
//   GET /racetime     le fasi della gara (PRACTICE, QUALI, WARMUP, PIT, RACE, PAUSE, END)
//   GET /squadra      nome della gara e servizio usato (le persone e le dirette
//                     non vengono mai lette ne' mostrate)
// Limiti dichiarati da Aub: /classifica al massimo ogni 2 s, /squadra e /racetime
// ogni 30-60 s. Qui si rispettano con una memoria breve.

const FASI_QUALIFICA = new Set(["PRACTICE", "QUALI", "WARMUP"]);
const NOMI_FASE = {
  PRACTICE: "Prove",
  QUALI: "Qualifiche",
  WARMUP: "Warm-up",
  RACE: "Gara",
  PAUSE: "Pausa",
};

const TIMEOUT_MS = 8000;
const CLASSIFICA_MS = 2000;
const FASI_MS = 30 * 1000;
const SQUADRA_MS = 60 * 1000;

class ErroreAub extends Error {
  constructor(code, messaggio) {
    super(messaggio);
    this.code = code;
  }
}

// ---------- configurazione ----------

const locale = (host) => host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

function hostConfigurato() {
  try {
    return new URL(String(process.env.AUB_BASE || "").trim()).hostname.toLowerCase();
  } catch (e) {
    return "";
  }
}

/** { base, chiave } oppure { errore } con il motivo in chiaro. */
function configurazione() {
  const testo = String(process.env.AUB_BASE || "").trim();
  const chiave = String(process.env.AUB_KEY || "").trim();
  if (!testo || !chiave) {
    return { errore: "Aub non e' configurato sul ponte: imposta le variabili AUB_BASE e AUB_KEY su Render" };
  }
  let u;
  try {
    u = new URL(testo);
  } catch (e) {
    return { errore: "AUB_BASE non e' un indirizzo valido" };
  }
  // La chiave e' una password: mai in chiaro su internet (solo per le prove in locale).
  if (u.protocol !== "https:" && !(u.protocol === "http:" && locale(u.hostname))) {
    return { errore: "AUB_BASE deve iniziare con https://" };
  }
  return { base: u.origin + u.pathname.replace(/\/+$/, ""), chiave };
}

function riconosce(url) {
  const host = String(url.hostname || "").toLowerCase();
  if (host === "aub") return true;
  const mio = hostConfigurato();
  return !!mio && mio === host;
}

// ---------- rete ----------

async function chiama(percorso) {
  const cfg = configurazione();
  if (cfg.errore) throw new ErroreAub("non_configurato", cfg.errore);
  const res = await fetch(cfg.base + percorso, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual", // la chiave non deve seguire un reindirizzamento altrove
    headers: { Authorization: `Bearer ${cfg.chiave}`, Accept: "application/json" },
  });
  let corpo = null;
  try {
    corpo = await res.json();
  } catch (e) {
    corpo = null;
  }
  if (res.status === 401) {
    throw new ErroreAub("chiave_non_valida", "Aub: chiave mancante, errata o revocata (401): chiedi alla squadra una chiave nuova");
  }
  if (res.status === 403) {
    const ambiti = corpo && Array.isArray(corpo.ambiti) ? corpo.ambiti.join(", ") : "";
    throw new ErroreAub("ambito_mancante", `Aub: la chiave non condivide questa parte (403)${ambiti ? `; ha solo: ${ambiti}` : ""}`);
  }
  if (res.status >= 300 && res.status < 400) throw new Error(`Aub ha risposto con un reindirizzamento (${res.status}): controlla AUB_BASE`);
  if (!res.ok) throw new Error(`Aub ha risposto ${res.status}`);
  if (corpo === null) throw new Error("risposta di Aub non leggibile");
  return corpo;
}

// Una breve memoria per rispettare i limiti di Aub. Per le parti accessorie
// (fasi, squadra) un errore non ferma la classifica: si tiene l'ultimo valore buono
// (o niente) fino alla prossima scadenza, senza martellare Aub con richieste fallite.
const memoria = new Map(); // nome -> { t, promessa, ultimo }

function conMemoria(nome, durataMs, fn, tollera) {
  const ora = Date.now();
  const m = memoria.get(nome);
  if (m && ora - m.t < durataMs) return m.promessa;
  const voce = { t: ora, ultimo: m ? m.ultimo : undefined, promessa: null };
  voce.promessa = fn().then(
    (v) => {
      voce.ultimo = v;
      return v;
    },
    (e) => {
      if (tollera) return voce.ultimo !== undefined ? voce.ultimo : null;
      if (memoria.get(nome) === voce) memoria.delete(nome); // la classifica si riprova subito
      throw e;
    }
  );
  memoria.set(nome, voce);
  return voce.promessa;
}

const leggiClassifica = () => conMemoria("classifica", CLASSIFICA_MS, () => chiama("/classifica"), false);
const leggiFasi = () => conMemoria("racetime", FASI_MS, () => chiama("/racetime"), true);
const leggiSquadra = () => conMemoria("squadra", SQUADRA_MS, () => chiama("/squadra"), true);

// ---------- normalizzazione ----------

/** "1:42.318" -> 102.318; "12.4" -> 12.4; "1:02:03.4" -> 3723.4; altro -> null. */
function toSeconds(t) {
  const m = /^(?:(?:(\d+):)?(\d{1,2}):)?(\d{1,3}(?:\.\d+)?)$/.exec(String(t == null ? "" : t).trim().replace(",", "."));
  if (!m) return null;
  const sec = (m[1] ? Number(m[1]) * 3600 : 0) + (m[2] ? Number(m[2]) * 60 : 0) + Number(m[3]);
  return Math.round(sec * 1000) / 1000; // millesimi: niente 102.90100000000001
}

/**
 * Un distacco come lo scrive il servizio: "+12.4", "+1:02.3", "+1 lap", "2 Laps",
 * "1 giro", "" ... Ritorna { sec } (un tempo), { giri, testo } (giri di ritardo),
 * { testo } (qualunque altra scritta) oppure {} (niente).
 */
function leggiDistacco(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || /^[-–—.]+$/.test(s)) return {};
  const g = /^\+?\s*(\d+)\s*(?:l|lap|laps|giro|giri|tour|tours)\b\.?$/i.exec(s);
  if (g) {
    const n = parseInt(g[1], 10);
    return { giri: n, testo: `${n} ${n === 1 ? "giro" : "giri"}` };
  }
  const sec = toSeconds(s.replace(/^\+/, ""));
  if (sec !== null) return { sec };
  return { testo: s };
}

// Nei dati di prova di Aub `gap` e `diff` sono SCAMBIATI rispetto alla documentazione:
// `gap` e' l'intervallo da chi sta davanti e `diff` il distacco cumulativo dal primo.
// Per questo i nomi non bastano: si guarda come si comportano i numeri. Un distacco
// cumulativo e' la somma degli intervalli: per ogni riga, cumulativo(k) - cumulativo(k-1)
// e' uguale all'intervallo(k). La coppia di campi che lo verifica sulle righe e' quella
// giusta. Se i dati non bastano a decidere, si tiene l'ultima scelta sicura, altrimenti
// la lettura della documentazione (gap = dal primo, diff = da chi sta davanti).
// (Stessa logica di PitComm, src/aubclassifica.js: se cambi una, cambia l'altra.)
const TOLLERANZA = 0.0025; // arrotondamenti al millesimo
let ultimaScelta = null; // "documento" | "scambiati"

function capireCampi(righe) {
  const sec = (v) => {
    const d = leggiDistacco(v);
    return d.sec != null ? d.sec : null;
  };
  const v = righe
    .map((r) => ({ pos: parseInt(r.pos, 10), g: sec(r.gap), d: sec(r.diff) }))
    .filter((r) => Number.isFinite(r.pos))
    .sort((x, y) => x.pos - y.pos);
  let documento = 0; // gap cumulativo, diff intervallo
  let scambiati = 0; // diff cumulativo, gap intervallo
  let suG = 0, parG = 0, suD = 0, parD = 0;
  for (let k = 1; k < v.length; k++) {
    const p = v[k - 1], r = v[k];
    if (p.g !== null && r.g !== null && r.d !== null && r.d > 0 && Math.abs(r.g - p.g - r.d) <= TOLLERANZA) documento++;
    if (p.d !== null && r.d !== null && r.g !== null && r.g > 0 && Math.abs(r.d - p.d - r.g) <= TOLLERANZA) scambiati++;
    if (p.g !== null && r.g !== null) { parG++; if (r.g >= p.g) suG++; }
    if (p.d !== null && r.d !== null) { parD++; if (r.d >= p.d) suD++; }
  }
  let scelta = null;
  if (documento >= 2 && documento > scambiati) scelta = "documento";
  else if (scambiati >= 2 && scambiati > documento) scelta = "scambiati";
  else if (parG >= 4 && parD >= 4) {
    // Secondo indizio: il campo cumulativo non scende quasi mai, l'intervallo si'.
    const rG = suG / parG, rD = suD / parD;
    if (rD >= 0.7 && rD >= rG + 0.25) scelta = "scambiati";
    else if (rG >= 0.7 && rG >= rD + 0.25) scelta = "documento";
  }
  if (scelta) ultimaScelta = scelta;
  return scelta || ultimaScelta || "documento";
}

// Orario locale del circuito come "2026-10-11T15:26:00" (le fasi di Aub sono
// scritte cosi', senza fuso).
function oraLocale(adesso) {
  let tz = String(process.env.AUB_TZ || "Europe/Rome").trim() || "Europe/Rome";
  const formatta = (zona) => new Intl.DateTimeFormat("sv-SE", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(adesso).replace(" ", "T");
  try {
    return formatta(tz);
  } catch (e) {
    return formatta("Europe/Rome");
  }
}

/** La fase in corso (o l'ultima iniziata) fra { event, start, end }, oppure null. */
function faseCorrente(fasi, adesso = new Date()) {
  const lista = (Array.isArray(fasi && fasi.racesessions) ? fasi.racesessions : [])
    .filter((f) => f && typeof f.start === "string")
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (!lista.length) return null;
  const ora = oraLocale(adesso);
  const inCorso = lista.find((f) => f.start <= ora && (typeof f.end !== "string" || ora < f.end));
  if (inCorso) return inCorso;
  const iniziate = lista.filter((f) => f.start <= ora);
  return iniziate.length ? iniziate[iniziate.length - 1] : null;
}

const intero = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);

function normalizza(classifica, fasi, squadra, adesso = new Date()) {
  const fase = faseCorrente(fasi, adesso);
  const nomeFase = fase ? String(fase.event || "").toUpperCase() : "";
  const tipo = FASI_QUALIFICA.has(nomeFase) ? "qualifica" : "gara";

  const righe = Array.isArray(classifica.full_classification_json) ? classifica.full_classification_json : [];
  const valide = righe.filter((r) => r && typeof r === "object" && Number.isFinite(parseInt(r.pos, 10)));
  // Quale campo e' il distacco dal primo e quale l'intervallo da chi sta davanti.
  const scambiati = valide.length > 0 && capireCampi(valide) === "scambiati";
  const campoCumulativo = scambiati ? "diff" : "gap";
  const campoIntervallo = scambiati ? "gap" : "diff";
  const primo = valide.reduce((m, r) => (m === null || parseInt(r.pos, 10) < parseInt(m.pos, 10) ? r : m), null);
  const giriPrimo = primo ? intero(primo.laps) : null;
  let nostroNumero = "";
  const piloti = valide
    .map((r) => {
      const pos = parseInt(r.pos, 10);
      const cum = leggiDistacco(r[campoCumulativo]);
      const inter = leggiDistacco(r[campoIntervallo]);
      const numero = String(r.number == null ? "" : r.number).trim();
      const giri = intero(r.laps);
      if (r.myself === true && !nostroNumero) nostroNumero = numero;
      return {
        pos,
        posMigliorGiro: null,
        numero,
        nome: String(r.name || "").trim(),
        classe: String(r.category || "").trim(),
        giri,
        ultimoGiro: toSeconds(r.laptime),
        tempoTotale: null,
        // Quanti giri ha dal primo, dai giri completati: le scritte dei distacchi per i
        // doppiati non sono coerenti fra i due campi. Senza giri, dalla scritta.
        giriRitardo: giriPrimo !== null && giri !== null ? Math.max(0, giriPrimo - giri)
          : cum.giri != null ? cum.giri : cum.sec != null ? 0 : pos === 1 ? 0 : null,
        migliorGiro: toSeconds(r.bestlap),
        distacco: cum.sec != null ? cum.sec : null,
        distaccoTesto: cum.sec != null ? "" : cum.testo || "",
        intervallo: pos === 1 ? null : inter.sec != null ? inter.sec : null,
        intervalloTesto: inter.sec != null ? "" : inter.testo || "",
        ordine: null,
        nostro: r.myself === true,
      };
    })
    .sort((a, b) => a.pos - b.pos);

  const gara = squadra && squadra.gara && typeof squadra.gara === "object" ? squadra.gara : null;
  const flag = classifica.flag && typeof classifica.flag === "object" ? classifica.flag : null;
  return {
    ok: true,
    fornitore: "aub",
    evento: {
      id: gara && gara.id != null ? String(gara.id) : "aub",
      codice: "",
      nome: gara && gara.nome ? String(gara.nome).trim() : "Aub",
      luogo: "",
      servizio: gara && gara.servizio ? String(gara.servizio) : "",
      nostroNumero,
    },
    sessione: {
      tipo,
      nome: NOMI_FASE[nomeFase] || nomeFase,
      categoria: "",
      bandiera: flag ? String(flag.label || flag.state || "").trim() : "",
    },
    aggiornato: Date.now(),
    piloti,
  };
}

// ---------- interfaccia del traduttore ----------

async function leggi(url) {
  let classifica;
  try {
    classifica = await leggiClassifica();
  } catch (e) {
    if (e instanceof ErroreAub) return { ok: false, code: e.code, messaggio: e.message };
    throw e;
  }
  if (classifica.nessunaGara) {
    return { ok: false, code: "non_pubblicato", messaggio: "Aub: nessuna gara aperta in questo momento per la squadra" };
  }
  // Fasi e nome della gara sono accessori: se mancano (per esempio la chiave non
  // ha quell'ambito) la classifica funziona lo stesso.
  const [fasi, squadra] = await Promise.all([leggiFasi().catch(() => null), leggiSquadra().catch(() => null)]);
  if (classifica.stale === true) {
    // Dati non correnti: Aub manda l'elenco vuoto. Si dice com'e', senza inventare.
    return normalizza({ ...classifica, full_classification_json: [] }, fasi, squadra);
  }
  return normalizza(classifica, fasi, squadra);
}

/** Risposta originale di Aub (senza persone ne' dirette, ne' la chiave). */
async function grezzo(url) {
  const cfg = configurazione();
  if (cfg.errore) return JSON.stringify({ errore: cfg.errore });
  const prova = (p) => p().then((v) => v, (e) => ({ errore: e.message || String(e) }));
  const [classifica, fasi, squadra] = await Promise.all([
    prova(() => chiama("/classifica")),
    prova(() => chiama("/racetime")),
    prova(() => chiama("/squadra")),
  ]);
  if (squadra && typeof squadra === "object") {
    delete squadra.persone;
    delete squadra.dirette;
  }
  if (classifica && Array.isArray(classifica.full_classification_json) && classifica.full_classification_json.length > 60) {
    classifica.righeTotali = classifica.full_classification_json.length;
    classifica.full_classification_json = classifica.full_classification_json.slice(0, 60);
  }
  return JSON.stringify({ fornitore: "aub", base: cfg.base, fasi, squadra, classifica });
}

module.exports = {
  nome: "aub",
  descrizione: "AUB Racing (API della squadra: scrivi https://aub come indirizzo dell'evento)",
  riconosce,
  leggi,
  grezzo,
  _test: { toSeconds, leggiDistacco, capireCampi, _reset: () => { ultimaScelta = null; }, faseCorrente, oraLocale, normalizza, configurazione, riconosce, memoria },
};
