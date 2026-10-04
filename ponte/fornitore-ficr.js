// Traduttore per il live timing FICR (livetiming.ficr.it).
//
// Come funziona il sito (ricavato osservando le richieste della sua pagina):
//   sendUsers.php?u=NOME            elenca gli eventi in corso; per ognuno c'e'
//                                   il nome (`nome_user`) e un `codice`
//   dataSend.php?u=NOME&c=CODICE    classifica completa in JSON (con `c` vuoto
//                                   risponde solo "{}")
//
// La risposta e' una lista: il primo elemento descrive la sessione, il secondo
// e' l'elenco dei concorrenti. Campi usati di ogni concorrente:
//   b numero   c nome   y classe (la scritta gialla sotto il nome)   r posizione
//   j giri   h ultimo giro   m miglior giro   p tempo totale   s distacco
//   t intervallo   u giri di ritardo   q ordine di passaggio
//
// ATTENZIONE alle due posizioni: r e' l'ordine per MIGLIOR GIRO, q e' l'ordine di
// passaggio sul traguardo, cioe' la posizione in gara (verificato su una gara a
// Trapani: la vettura col giro piu' veloce ha r=1 ma e' seconda, q=2, e la pagina
// la mostra seconda). La posizione che la pagina mostra e' quindi:
//   qualifiche e prove -> r (miglior giro)
//   gara               -> q (ordine in gara)
// In gara s e t (distacco e intervallo) seguono q e tornano fra loro.
// Per i doppiati s e t valgono "--" e il sito scrive "N giri": N sta nel campo u
// (giri di ritardo dal primo), verificato su una gara a San Rocco di Piegara.

const BASE = (process.env.FICR_BASE || "https://www.livetiming.ficr.it").replace(/\/+$/, "");
const HOST_AMMESSI = new Set(["www.livetiming.ficr.it", "livetiming.ficr.it"]);

const codici = new Map();     // nome evento -> { codice, t }
const ultimaRicerca = new Map(); // nome evento -> quando abbiamo riletto l'elenco
const CODICE_VALIDO_MS = 5 * 60 * 1000;
const RILEGGI_ELENCO_MS = 60 * 1000;

function riconosce(url) {
  return HOST_AMMESSI.has(url.hostname.toLowerCase());
}

/** Nome evento e codice (se presente) dall'indirizzo, oppure null. */
function leggiIndirizzo(url) {
  const m = url.pathname.match(/^\/([a-z0-9_-]+)(?:\/(?:dataSend\.php|sendUsers\.php|index\.php)?)?$/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const nomeParam = (url.searchParams.get("u") || "").toLowerCase();
  if (nomeParam && nomeParam !== slug) return null;
  const codice = (url.searchParams.get("c") || "").trim();
  if (codice && !/^[a-z0-9]{4,32}$/i.test(codice)) return null;
  return { slug, codice };
}

async function getJson(indirizzo) {
  const res = await fetch(indirizzo, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json, text/plain, */*" },
  });
  if (!res.ok) throw new Error(`il live timing FICR ha risposto ${res.status}`);
  const testo = await res.text();
  try {
    return JSON.parse(testo);
  } catch (e) {
    throw new Error("risposta del live timing FICR non leggibile");
  }
}

async function trovaCodice(slug) {
  ultimaRicerca.set(slug, Date.now());
  const dati = await getJson(`${BASE}/${slug}/sendUsers.php?u=${slug}&c=&_=${Date.now()}`);
  const lista = Array.isArray(dati && dati.listEvent) ? dati.listEvent : [];
  const ev = lista.find((e) => e && String(e.nome_user || "").toLowerCase() === slug);
  return ev && ev.codice ? String(ev.codice) : null;
}

function vuoto(dati) {
  return !Array.isArray(dati) || !dati.some(Array.isArray) || !dati.find(Array.isArray).length;
}

function leggiDati(slug, codice) {
  return getJson(`${BASE}/${slug}/dataSend.php?u=${slug}&c=${encodeURIComponent(codice)}&_=${Date.now()}`);
}

/** Dati grezzi dell'evento, o { errore }. Rilegge il codice se serve. */
async function scarica(url) {
  const ind = leggiIndirizzo(url);
  if (!ind) return { errore: { code: "indirizzo_non_valido", messaggio: "indirizzo FICR non riconosciuto" } };
  const { slug } = ind;

  let codice = ind.codice;
  if (codice) codici.set(slug, { codice, t: Date.now() });
  const memo = codici.get(slug);
  if (!codice && memo && Date.now() - memo.t < CODICE_VALIDO_MS) codice = memo.codice;
  if (!codice) {
    codice = await trovaCodice(slug);
    if (!codice) return { errore: { code: "non_pubblicato", messaggio: "evento non ancora pubblicato" } };
    codici.set(slug, { codice, t: Date.now() });
  }

  let dati = await leggiDati(slug, codice);
  // Vuoto a lungo puo' voler dire che il codice e' cambiato (nuovo evento con lo
  // stesso nome): si rilegge l'elenco, al massimo una volta al minuto.
  if (vuoto(dati) && Date.now() - (ultimaRicerca.get(slug) || 0) > RILEGGI_ELENCO_MS) {
    const nuovo = await trovaCodice(slug).catch(() => null);
    if (nuovo && nuovo !== codice) {
      codice = nuovo;
      codici.set(slug, { codice, t: Date.now() });
      dati = await leggiDati(slug, codice);
    }
  }
  return { slug, codice, dati };
}

// ---------- normalizzazione ----------

function toSeconds(t) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(String(t == null ? "" : t).trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

function tipoSessione(header) {
  const tipo = String((header && header.a) || "").toLowerCase();
  const nome = String((header && header.c) || "").toLowerCase();
  return tipo.startsWith("qual") || nome.includes("qualific") || nome.includes("prov") ? "qualifica" : "gara";
}

// Il testo da mostrare al posto di un distacco che non e' un tempo: un testo gia'
// pronto dal sito, oppure, in gara e per i doppiati, "N giri" (campo u).
function testoGap(t, giriIndietro, inGara) {
  const s = String(t == null ? "" : t).trim();
  if (s && s !== "--") return toSeconds(s) !== null ? "" : s;
  if (!inGara) return "";
  const giri = parseInt(giriIndietro, 10);
  return Number.isFinite(giri) && giri > 0 ? `${giri} ${giri === 1 ? "giro" : "giri"}` : "";
}

function normalizza(slug, codice, dati) {
  const header = dati.find((x) => x && !Array.isArray(x) && typeof x === "object") || {};
  const righe = dati.find(Array.isArray) || [];
  const tipo = tipoSessione(header);
  // La posizione e' quella che mostra la pagina: in gara l'ordine di passaggio (q),
  // in qualifica il miglior giro (r). Se manca q in gara si ripiega su r.
  const posizione = (r) => {
    const q = parseInt(r.q, 10);
    const miglior = parseInt(r.r, 10);
    return tipo === "gara" && Number.isFinite(q) ? q : miglior;
  };
  const piloti = righe
    .filter((r) => r && typeof r === "object" && Number.isFinite(posizione(r)))
    .map((r) => ({
      pos: posizione(r),
      posMigliorGiro: Number.isFinite(parseInt(r.r, 10)) ? parseInt(r.r, 10) : null,
      numero: String(r.b == null ? "" : r.b).trim(),
      nome: String(r.c || "").trim(),
      classe: String(r.y || "").trim(),
      giri: Number.isFinite(parseInt(r.j, 10)) ? parseInt(r.j, 10) : null,
      ultimoGiro: toSeconds(r.h),
      tempoTotale: toSeconds(r.p),
      migliorGiro: toSeconds(r.m),
      distacco: toSeconds(r.s),
      distaccoTesto: testoGap(r.s, r.u, tipo === "gara"),
      intervallo: toSeconds(r.t),
      intervalloTesto: testoGap(r.t, r.u, tipo === "gara"),
      ordine: Number.isFinite(parseInt(r.q, 10)) ? parseInt(r.q, 10) : null,
    }))
    .sort((a, b) => a.pos - b.pos);
  return {
    ok: true,
    fornitore: "ficr",
    evento: {
      id: slug,
      codice,
      nome: String(header.q || "").trim(),
      luogo: String(header.r || "").trim(),
    },
    sessione: {
      tipo,
      nome: String(header.c || "").trim(),
      categoria: String(header.d || "").trim(),
      bandiera: String(header.m || "").trim(),
    },
    aggiornato: Date.now(),
    piloti,
  };
}

async function leggi(url) {
  const r = await scarica(url);
  if (r.errore) return { ok: false, ...r.errore };
  if (vuoto(r.dati)) {
    return {
      ok: true,
      fornitore: "ficr",
      evento: { id: r.slug, codice: r.codice, nome: "", luogo: "" },
      sessione: { tipo: "gara", nome: "", categoria: "", bandiera: "" },
      aggiornato: Date.now(),
      piloti: [],
    };
  }
  return normalizza(r.slug, r.codice, r.dati);
}

/** Risposta originale del sito, per capire cosa succede quando qualcosa non torna. */
async function grezzo(url) {
  const r = await scarica(url);
  if (r.errore) return JSON.stringify({ errore: r.errore });
  return JSON.stringify({ evento: r.slug, codice: r.codice, risposta: r.dati });
}

module.exports = {
  nome: "ficr",
  descrizione: "Live timing FICR (livetiming.ficr.it)",
  riconosce,
  leggi,
  grezzo,
  _test: { leggiIndirizzo, normalizza, toSeconds, tipoSessione, vuoto, testoGap },
};
