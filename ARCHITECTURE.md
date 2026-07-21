# Architettura

## Obiettivi e invarianti

Cantiere Media e una PWA offline-first senza backend obbligatorio. Le decisioni tecniche devono preservare questi invarianti:

1. la prima vista operativa e il caricamento, non l'Archivio;
2. all'avvio non vengono letti record dagli store `media`, `mediaBlobs` o `thumbnails`;
3. un upload dalla schermata iniziale non interroga l'Archivio mentre questo e nascosto;
4. ogni query di galleria richiede un `siteId` e usa un indice composto;
5. metadati, originali e miniature restano in store separati;
6. nessun file e salvato finche metadato e blob non sono scritti nella stessa transazione;
7. esistenza del cantiere, stato utente e permessi vengono verificati nella stessa transazione che modifica i dati;
8. ogni cancellazione media rimuove anche blob, miniatura e preferiti collegati;
9. una nuova release aggiorna insieme `package.json`, `js/config.js`, `service-worker.js` e `CHANGELOG.md`;
10. caricamenti concorrenti della stessa pagina condividono una sola Promise e non creano loop di paginazione.

## Moduli

- `app.js`: composizione, navigazione tra `Carica` e `Archivio`, dialoghi amministrativi e coordinamento controller.
- `auth.js`: credenziali PIN, accesso, blocco temporaneo e sessione in memoria.
- `db.js`: schema IndexedDB, transazioni, query indicizzate, paginazione e cancellazioni atomiche.
- `filters.js`: stato dei filtri, selezione cantiere condivisa tra caricamento e Archivio e vincoli delle viste.
- `gallery.js`: gruppi per data, layout a righe, pinch della densita, paginazione, virtualizzazione, miniature lazy e selezione prolungata.
- `media.js`: validazione file, metadati, miniature, condivisione, download e quota storage.
- `upload.js`: ingressi diretti foto/video/galleria, pipeline sequenziale e avanzamento per file.
- `viewer.js`: visualizzatore foto/video, gesture e controlli video applicativi.
- `favorites.js`: preferiti personali separati per contesto Archivio/Upload.
- `permissions.js`: regole di autorizzazione pure e testabili.
- `sites.js`: ciclo di vita dei cantieri e cancellazione a lotti riprendibile.
- `users.js`: utenti, ruoli, disattivazione e continuita amministrativa.
- `ui.js`: primitive UI condivise.
- `utils.js`: funzioni generiche senza stato applicativo.

## Schema IndexedDB

### `users`

Chiave: `id`. Indici: `role`, `nameNormalized`, `createdAt`.

### `sites`

Chiave: `id`. Indici: `status`, `nameNormalized`, `updatedAt`.

### `media`

Contiene esclusivamente metadati. Chiave: `id`.

Indici semplici: `siteId`, `author`, `mediaType`, `date`, `uploadDate`.

Indici composti:

- `siteDate`;
- `siteTypeDate`;
- `siteAuthorDate`;
- `siteTypeAuthorDate`.

Data e identificatore sono in coda alla chiave composta, consentendo cursori discendenti, intervallo giornaliero e paginazione stabile senza offset.

### `mediaBlobs`

Chiave: `mediaId`. Contiene il file originale.

### `thumbnails`

Chiave: `mediaId`. La miniatura viene generata quando la card entra vicino al viewport.

### `favorites`

Chiave composta logicamente da utente, contesto e media. Gli indici includono `userId` e `context` nel prefisso.

### `settings`

Impostazioni tecniche e stato del throttling PIN.

## Vista iniziale e caricamento

Dopo il login `currentView` e `UPLOAD`. La schermata espone subito:

1. selettore cantiere;
2. fotocamera foto;
3. fotocamera video;
4. selettore multiplo della galleria.

I tre comandi usano metodi diretti del controller upload. La finestra di avanzamento compare soltanto quando esistono file da elaborare. Se manca il cantiere, il comando non apre la fotocamera: evidenzia e focalizza il selettore.

Dopo il salvataggio, i contatori e il messaggio della schermata vengono aggiornati. La galleria non viene ricaricata finche l'utente non apre esplicitamente l'Archivio.

## Percorso di una query Archivio

1. l'utente apre l'Archivio;
2. il controller filtri restituisce cantiere, tipo, autore, data e vista;
3. senza cantiere la query non parte;
4. il query planner sceglie l'indice piu selettivo compatibile;
5. IndexedDB apre un cursore `prev` entro il solo prefisso richiesto;
6. vengono letti al massimo 60 metadati;
7. la chiave dell'ultimo record diventa il cursore successivo;
8. i metadati sono trasformati in righe di data e righe di miniature;
9. il DOM mostra soltanto le righe vicine al viewport.

Non esiste un percorso `getAll(media) -> filter()`.

## Raggruppamento per data e pinch della griglia

`gallery.js` usa la data effettiva del media (`takenAt`) per creare gruppi locali di calendario. Ogni gruppo produce:

- una riga intestazione con etichetta e conteggio;
- una o piu righe di miniature in base al numero di colonne.

Il numero di colonne varia da 2 a 6. Su Android vengono usati Pointer Events con due puntatori; su Safari e disponibile il fallback `gesturestart/gesturechange/gestureend`. Un pinch attivo:

- annulla il timer di pressione prolungata;
- sopprime il clic immediatamente successivo;
- conserva approssimativamente il punto visivo di ancoraggio;
- aggiorna offsets e virtualizzazione;
- salva la densita in `localStorage`.

Allargare le dita riduce le colonne e ingrandisce le miniature; avvicinarle aumenta le colonne.

## Pipeline upload

Ogni file segue una pipeline indipendente:

1. verifica preliminare di cantiere e utente;
2. riconoscimento foto/video;
3. controllo dimensione e durata video;
4. lettura EXIF JPEG, poi data file, infine data upload;
5. seconda verifica transazionale e scrittura atomica di metadato e blob;
6. aggiornamento avanzamento;
7. passaggio al file successivo anche in caso di file non valido.

La miniatura non fa parte della transazione di upload: viene generata soltanto quando serve e puo essere ricreata dall'originale.

## Cancellazioni

La cancellazione media usa una singola transazione sugli store `media`, `mediaBlobs`, `thumbnails` e `favorites`. Per le operazioni utente include anche `users`, rivalutando ruolo e finestra delle 24 ore sul dato persistito. Le selezioni estese sono lavorate in batch da 100.

La cancellazione di un cantiere usa batch da 100. Prima del primo batch il cantiere passa allo stato tecnico `deleting`; dopo un'interruzione un amministratore riprende il lavoro al successivo accesso.

## Offline e aggiornamenti

Il Service Worker precachea l'application shell. I media utente restano in IndexedDB e non transitano dalla Cache API.

Le navigazioni usano rete con timeout e fallback locale; gli asset statici usano cache-first con aggiornamento in background. Il browser verifica il worker con `updateViaCache: none`, attiva la nuova shell, elimina le cache obsolete e provoca un solo reload. Gli aggiornamenti devono essere avviati quando non sono in corso operazioni lunghe.

## Regole per estendere il progetto

- preservare la priorita della schermata di caricamento;
- non interrogare media quando l'Archivio e nascosto;
- aggiungere una responsabilita a un modulo soltanto se appartiene allo stesso dominio;
- introdurre store o indici con incremento `DB_VERSION` e migrazione;
- non cambiare chiavi composte senza test del query planner;
- mantenere i controlli di permesso nella funzione che modifica i dati;
- evitare blob nello stato UI o negli array della galleria;
- aggiornare test, browser smoke e `CHANGELOG.md` per ogni flusso critico.

## Verifica prima di una release

```bash
npm test
npm run check
npm run smoke
```
