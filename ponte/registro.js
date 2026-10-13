// L'elenco dei traduttori. Per aggiungere un fornitore basta caricare nella
// cartella un file `fornitore-NOME.js` con la stessa forma di fornitore-ficr.js:
// viene trovato da solo all'avvio, non serve piu' modificare questo file.
//
// Un traduttore espone:
//   nome, descrizione
//   riconosce(url)   vero se l'indirizzo e' di questo fornitore
//   leggi(url)       la classifica nel formato comune (vedi README)
//   grezzo(url)      la risposta originale del sito, per capire i problemi
//
// Un file rotto (errore di sintassi, forma sbagliata) viene saltato e scritto nei
// log: gli altri traduttori continuano a funzionare.

const fs = require("fs");
const path = require("path");

function caricaFornitori() {
  const trovati = [];
  let file = [];
  try {
    file = fs.readdirSync(__dirname).filter((f) => /^fornitore-.+\.js$/.test(f)).sort();
  } catch (e) {
    console.error("registro: cartella illeggibile:", e.message);
  }
  for (const f of file) {
    try {
      const m = require(path.join(__dirname, f));
      const ok = m && typeof m.nome === "string" && m.nome
        && typeof m.riconosce === "function" && typeof m.leggi === "function" && typeof m.grezzo === "function";
      if (!ok) throw new Error("manca nome, riconosce, leggi o grezzo");
      if (trovati.some((x) => x.nome === m.nome)) throw new Error(`nome "${m.nome}" gia' usato da un altro file`);
      trovati.push(m);
    } catch (e) {
      console.error(`registro: ${f} saltato: ${e.message}`);
    }
  }
  return trovati;
}

const FORNITORI = caricaFornitori();

function trova(url) {
  return FORNITORI.find((f) => {
    try {
      return f.riconosce(url);
    } catch (e) {
      return false;
    }
  }) || null;
}

function parseEvento(testo) {
  const t = String(testo || "").trim();
  if (!t || t.length > 600) return null;
  try {
    const url = new URL(t);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch (e) {
    return null;
  }
}

/** La classifica dell'evento, sempre nel formato comune (o { ok:false, code, messaggio }). */
async function leggi(eventoTesto) {
  const url = parseEvento(eventoTesto);
  if (!url) return { ok: false, code: "indirizzo_non_valido", messaggio: "indirizzo non valido" };
  const fornitore = trova(url);
  if (!fornitore) {
    return {
      ok: false,
      code: "fornitore_sconosciuto",
      messaggio: `nessun traduttore per ${url.hostname}`,
    };
  }
  try {
    return await fornitore.leggi(url);
  } catch (e) {
    return { ok: false, code: "errore_fornitore", messaggio: e.message || String(e) };
  }
}

async function grezzo(eventoTesto) {
  const url = parseEvento(eventoTesto);
  if (!url) return JSON.stringify({ errore: "indirizzo non valido" });
  const fornitore = trova(url);
  if (!fornitore) return JSON.stringify({ errore: `nessun traduttore per ${url.hostname}` });
  try {
    return await fornitore.grezzo(url);
  } catch (e) {
    return JSON.stringify({ errore: e.message || String(e) });
  }
}

function elenco() {
  return FORNITORI.map((f) => ({ nome: f.nome, descrizione: f.descrizione }));
}

module.exports = { leggi, grezzo, elenco, trova, parseEvento };
