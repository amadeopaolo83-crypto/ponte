// L'elenco dei traduttori. Per aggiungere un fornitore: scrivi un file
// `fornitore-NOME.js` con la stessa forma di fornitore-ficr.js e aggiungilo qui.
//
// Un traduttore espone:
//   nome, descrizione
//   riconosce(url)   vero se l'indirizzo e' di questo fornitore
//   leggi(url)       la classifica nel formato comune (vedi README)
//   grezzo(url)      la risposta originale del sito, per capire i problemi

const FORNITORI = [
  require("./fornitore-ficr"),
];

function trova(url) {
  return FORNITORI.find((f) => f.riconosce(url)) || null;
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
