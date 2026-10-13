# PitPonte

Il **ponte** tra i siti di live timing e PitComm. PitComm chiede sempre qui la
classifica di un evento, in un formato unico; il ponte riconosce il fornitore
dall'indirizzo e lo traduce.

```
telefoni  ⇄  PitComm (app principale)  ⇄  PitPonte  ⇄  siti di live timing
```

Se un fornitore cambia, o ne arriva uno nuovo, si aggiorna **solo il ponte**:
PitComm resta acceso con carburante, gara e stato intatti.

Oggi sa leggere: **FICR** (livetiming.ficr.it) e **Aub** (l'API della squadra, vedi il punto 7).

## I file (tutti nella stessa cartella, senza sottocartelle)

| File | A cosa serve |
|---|---|
| `package.json` | comando di avvio (nessuna libreria da installare) |
| `server.js` | il servizio e le sue chiamate |
| `registro.js` | trova da solo i file `fornitore-*.js` (un file rotto viene saltato e scritto nei log) |
| `fornitore-ficr.js` | il traduttore per FICR |
| `fornitore-aub.js` | il traduttore per Aub (usa la chiave della squadra) |
| `rete.js` | lettura sicura di pagine esterne (strumento "sorgente") |
| `pagina.html` | pagina di prova per il telefono |
| `README.md` | questo file |

## 1. Pubblicare

1. Su GitHub crea un **nuovo repository** (es. `pitponte`, meglio **Private**) e
   carica tutti i file con **Upload files**.
2. Su Render: **New + → Web Service**, scegli il repository. **Runtime** `Node`,
   **Build Command** `npm install`, **Start Command** `npm start`.
3. In **Environment** aggiungi `BRIDGE_TOKEN` con la parola d'ordine dal file
   `chiavi-ponte-NON-CARICARE-SU-GITHUB.txt`.
4. Premi **Create Web Service** e attendi *Live*. L'indirizzo è del tipo
   `https://pitponte.onrender.com`.
5. Sul servizio **PitComm** (app principale) aggiungi in **Environment**:
   - `BRIDGE_URL` = l'indirizzo del ponte (senza barra finale)
   - `BRIDGE_TOKEN` = la **stessa** parola d'ordine del ponte

La parola d'ordine non va mai nel repository.

## 2. Provarlo dal telefono

Apri l'indirizzo del ponte nel browser: compare la pagina di prova.

1. Scrivi il **token** (viene ricordato sul telefono).
2. Incolla l'**indirizzo dell'evento** (per esempio `https://www.livetiming.ficr.it/cronoferrara/`)
   e, se vuoi, il **numero di gara**.
3. **Leggi classifica** mostra cosa vede il ponte: sessione, bandiera e la tua
   vettura con quelle accanto.

Gli altri pulsanti servono a capire i problemi e a prepararmi i dati quando serve
un fornitore nuovo (vedi sotto). **Copia il risultato** lo mette negli appunti, da
incollare nella chat.

## 3. Quando un fornitore è nuovo o cambia

Con una gara in corso, dalla pagina di prova:

1. Incolla l'indirizzo della pagina dell'evento e premi **Leggi classifica**: se dice
   *nessun traduttore per questo sito*, il fornitore non è ancora supportato.
2. Premi **Sorgente pagina**: mostra il codice della pagina, con l'elenco dei suoi
   file script e le righe che parlano di dati (`ajax`, `fetch`, `.php`, `.json`).
   **Copia il risultato** e mandalo nella chat.
3. Con quello si scrive il nuovo traduttore (basta il file `fornitore-NOME.js`: il
   registro lo trova da solo), si carica sul ponte e Render lo ripubblica. L'app principale
   non si tocca: appena il ponte è di nuovo *Live*, la lettura riparte da sola.

Lo strumento *Sorgente pagina* funziona solo con `BRIDGE_TOKEN` impostato e rifiuta
gli indirizzi interni.

## 4. Il formato comune

`GET /api/classifica?evento=INDIRIZZO` risponde, per ogni fornitore, così:

```json
{
  "ok": true,
  "fornitore": "ficr",
  "evento": { "id": "cronoravenna", "codice": "60cba1f9", "nome": "…", "luogo": "…" },
  "sessione": { "tipo": "qualifica", "nome": "Qualifiche", "categoria": "65 DEBUTTANTI", "bandiera": "Finish" },
  "aggiornato": 1791101683562,
  "piloti": [
    { "pos": 4, "numero": "315", "nome": "BRANDO CARENNA", "classe": "65 CADETTI", "giri": 6,
      "ultimoGiro": 155.987, "migliorGiro": 152.642,
      "distacco": 45.259, "distaccoTesto": "", "intervallo": 5.122, "intervalloTesto": "", "ordine": 3 }
  ]
}
```

I tempi sono in secondi. `tipo` è `qualifica` (qualifiche e prove) oppure `gara`.
Gli errori hanno `"ok": false`, un `code` (`non_pubblicato`, `fornitore_sconosciuto`,
`indirizzo_non_valido`, `errore_fornitore`) e un `messaggio`.

Altre chiamate: `/api/grezzo?evento=` (risposta originale del sito),
`/api/fornitori`, `/api/salute` (sempre libera: tiene sveglio il ponte).
Tutte tranne `salute` richiedono `Authorization: Bearer TOKEN`.

## 5. Piano gratuito di Render

Il ponte si spegne dopo ~15 minuti senza richieste, come PitComm. Finché in PitComm
c'è un collegamento *Nostro* attivo, il ponte riceve richieste ogni pochi secondi e
resta sveglio. Alla prima chiamata dopo uno spegnimento può servire fino a un
minuto: PitComm lo sa e aspetta.

## 6. Se qualcosa non va

| Problema | Cosa controllare |
|---|---|
| `401 non autorizzato` | `BRIDGE_TOKEN` diverso fra ponte e PitComm, o non scritto nella pagina di prova. |
| *nessun traduttore per questo sito* | Fornitore non ancora supportato: vedi il punto 3. |
| *evento non ancora pubblicato* | L'evento non è nell'elenco del fornitore: riprova più tardi. |
| Il ponte non risponde | Si sta svegliando (fino a un minuto) o è spento: controlla su Render. |
| Dati strani in gara | Usa **Dati grezzi** e mandameli: il calcolo dei distacchi in gara va riscontrato. |

## 7. Aub (API della squadra)

Aub ha già le sue codifiche: il ponte non legge un sito, chiama la loro API di sola
lettura con la **chiave della squadra** e traduce la risposta nel formato comune.

**Cosa serve da Aub**: l'indirizzo del servizio (quello che il portale mostra quando
crea la chiave) e una chiave con almeno gli ambiti `classifica`, `programma`, `gara`
(`vetture` facoltativo; `persone` e `dirette` non servono e non vengono mai letti).

**Impostare sul ponte (Render → Environment)**, mai nell'app e mai in chat:

| Variabile | Valore |
|---|---|
| `AUB_BASE` | l'indirizzo del servizio, che deve iniziare con `https://` |
| `AUB_KEY` | la chiave (inizia con `aubk_`) |
| `AUB_TZ` | facoltativa: fuso orario del circuito (predefinito `Europe/Rome`) |

**In PitComm** (Timing → Nostro) come indirizzo scrivi semplicemente `https://aub` e
come numero quello della vettura. L'indirizzo serve solo a scegliere il traduttore:
le chiamate vanno sempre a `AUB_BASE`.

**Come viene tradotto**: `/classifica` dà posizione, numero, nome, categoria, giri,
tempi, distacco dal primo (`gap`) e dall'auto davanti (`diff`); `/racetime` dice la
fase in corso (PRACTICE, QUALI e WARMUP = `qualifica`; tutto il resto = `gara`);
`/squadra` dà il nome della gara. Se la chiave non ha `programma` o `gara` la
classifica funziona lo stesso (tipo `gara`, nome "Aub"). Nel risultato la vettura
della squadra ha `"nostro": true` e il suo numero è in `evento.nostroNumero`.
Una gara non aperta risponde `non_pubblicato`; dati non correnti (`stale`) danno un
elenco vuoto. Rispetta i limiti di Aub (classifica ogni 2 s, fasi e squadra ogni
30–60 s).

| Messaggio | Cosa controllare |
|---|---|
| *Aub non è configurato sul ponte* | Mancano `AUB_BASE` o `AUB_KEY` su Render (o `AUB_BASE` non è https). |
| `chiave_non_valida` (401) | Chiave sbagliata o revocata: chiedi alla squadra una chiave nuova. |
| `ambito_mancante` (403) | La chiave non condivide `classifica`: il messaggio dice quali ambiti ha. |
| *nessuna gara aperta* | Normale fuori dalla finestra della gara: l'app riprova da sola. |
| Distacchi strani | **Dati grezzi** con `https://aub` e mandameli (senza persone né chiave). |

