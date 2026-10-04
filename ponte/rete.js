// Lettura sicura di pagine esterne, per lo strumento "sorgente" del ponte.
//
// Serve a vedere da telefono quello che il browser non fa vedere (il codice di
// una pagina di live timing e le richieste che fa per avere i dati). Per non
// diventare un modo di raggiungere la rete interna del server, rifiuta gli
// indirizzi privati e controlla ogni reindirizzamento.

const dns = require("dns").promises;
const net = require("net");

function ipPrivato(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return true;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return ipPrivato(m[1]);
    return false;
  }
  return true;
}

async function verificaHost(hostname) {
  const nome = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(nome)) {
    if (ipPrivato(nome)) throw new Error("indirizzo non consentito");
    return;
  }
  const indirizzi = await dns.lookup(nome, { all: true });
  if (!indirizzi.length || indirizzi.some((i) => ipPrivato(i.address))) {
    throw new Error("indirizzo non consentito");
  }
}

async function leggiCorpo(res, maxByte) {
  const pezzi = [];
  let totale = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pezzi.push(Buffer.from(value));
    totale += value.length;
    if (totale >= maxByte) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(pezzi).subarray(0, maxByte).toString("utf8");
}

/** Scarica una pagina (max `maxByte`), seguendo fino a 3 reindirizzamenti. */
async function leggiSorgente(urlTesto, { maxByte = 400000, timeoutMs = 10000 } = {}) {
  let url = new URL(urlTesto);
  for (let salto = 0; salto <= 3; salto++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("sono ammessi solo indirizzi http e https");
    await verificaHost(url.hostname);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PitPonte/1.0)", Accept: "*/*" },
    });
    const dove = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && dove) {
      url = new URL(dove, url);
      continue;
    }
    return {
      url: url.href,
      stato: res.status,
      tipo: res.headers.get("content-type") || "",
      testo: await leggiCorpo(res, maxByte),
    };
  }
  throw new Error("troppi reindirizzamenti");
}

/** Il testo di una pagina, con in testa l'elenco di script e righe che parlano di dati. */
function descriviSorgente(r) {
  const script = [];
  const reScript = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = reScript.exec(r.testo)) && script.length < 40) {
    try { script.push(new URL(m[1], r.url).href); } catch (e) { script.push(m[1]); }
  }
  const righe = r.testo.split(/\r?\n/)
    .filter((l) => /ajax|fetch\(|XMLHttpRequest|WebSocket|EventSource|\.php|\.json|socket\.io/i.test(l))
    .map((l) => l.trim().slice(0, 220))
    .slice(0, 40);
  return [
    `== PAGINA: ${r.url} (stato ${r.stato}, ${r.tipo || "tipo sconosciuto"}) ==`,
    "",
    "== FILE SCRIPT ==",
    script.length ? script.join("\n") : "(nessuno)",
    "",
    "== RIGHE CHE PARLANO DI DATI (ajax, fetch, .php, .json, socket) ==",
    righe.length ? righe.join("\n") : "(nessuna)",
    "",
    "== INIZIO CONTENUTO ==",
    r.testo.slice(0, 6000),
  ].join("\n");
}

module.exports = { leggiSorgente, descriviSorgente, ipPrivato };
