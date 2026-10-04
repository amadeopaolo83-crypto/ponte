# PitPonte

Il **ponte** tra i siti di live timing e PitComm. PitComm chiede sempre qui la
classifica di un evento, in un formato unico; il ponte riconosce il fornitore
dall'indirizzo e lo traduce.

```
telefoni  ⇄  PitComm (app principale)  ⇄  PitPonte  ⇄  siti di live timing
```

Se un fornitore cambia, o ne arriva uno nuovo, si aggiorna **solo il ponte**:
PitComm resta acceso con carburante, gara e stato intatti.

Oggi sa leggere: **FICR** (livetiming.ficr.it).

## I file (tutti nella stessa cartella, senza sottocartelle)

| File | A cosa serve |
|---|---|
| `package.json` | comando di avvio (nessuna libreria da installare) |
| `server.js` | il servizio e le sue chiamate |
| `registro.js` | l'elenco dei traduttori |
| `fornitore-ficr.js` | il traduttore per FICR |
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
3. Con quello si scrive il nuovo traduttore (`fornitore-NOME.js` + una riga in
   `registro.js`), si carica sul ponte e Render lo ripubblica. L'app principale
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
