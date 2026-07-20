# Architettura

## Obiettivi e invarianti

Cantiere Media e una PWA offline-first senza backend obbligatorio. Le decisioni tecniche devono preservare questi invarianti:

1. all'avvio non vengono letti record dagli store `media`, `mediaBlobs` o `thumbnails`;
2. ogni query di galleria richiede un `siteId` e usa un indice composto;
3. metadati, originali e miniature restano in store separati;
4. nessun file viene considerato salvato finche metadato e blob non sono stati scritti nella stessa transazione;
5. esistenza del cantiere, stato utente e permessi vengono verificati nella stessa transazione che modifica i dati;
6. ogni cancellazione media rimuove anche blob, miniatura e preferiti collegati;
7. una nuova release aggiorna insieme `package.json`, `js/config.js`, `service-worker.js` e `CHANGELOG.md`.
8. caricamenti concorrenti della stessa pagina condividono una sola Promise e non possono creare loop di paginazione.

## Moduli

- `app.js`: composizione dell'applicazione, navigazione, dialoghi amministrativi e coordinamento dei controller.
- `auth.js`: credenziali PIN, accesso, blocco temporaneo e sessione in memoria.
- `db.js`: schema IndexedDB, transazioni, query indicizzate, paginazione e cancellazioni atomiche.
- `filters.js`: stato dei quattro filtri e vincoli delle viste.
- `gallery.js`: paginazione, windowing del DOM, miniature lazy e selezione con pressione prolungata.
- `media.js`: validazione file, metadati, miniature, condivisione, download e quota storage.
- `upload.js`: flusso sequenziale di importazione e avanzamento per file.
- `viewer.js`: visualizzatore foto/video, gesture e controlli video applicativi accessibili.
- `favorites.js`: preferiti personali separati per contesto Archivio/Upload.
- `permissions.js`: regole di autorizzazione pure e testabili.
- `sites.js`: ciclo di vita dei cantieri e cancellazione a lotti riprendibile.
- `users.js`: utenti, ruoli, disattivazione e continuita amministrativa.
- `ui.js`: primitive UI condivise.
- `utils.js`: funzioni generiche senza stato applicativo.

## Schema IndexedDB

### `users`

Chiave: `id`.

Indici: `role`, `nameNormalized`, `createdAt`.

### `sites`

Chiave: `id`.

Indici: `status`, `nameNormalized`, `updatedAt`.

### `media`

Contiene esclusivamente metadati. Chiave: `id`.

Indici semplici: `siteId`, `author`, `mediaType`, `date`, `uploadDate`.

Indici composti usati dal query planner:

- `siteDate`;
- `siteTypeDate`;
- `siteAuthorDate`;
- `siteTypeAuthorDate`.

La data e l'identificatore sono in coda alla chiave composta. Questo consente cursori discendenti, intervallo giornaliero e paginazione stabile senza offset.

### `mediaBlobs`

Chiave: `mediaId`. Contiene soltanto il file originale.

### `thumbnails`

Chiave: `mediaId`. Le miniature vengono create la prima volta che una card entra vicino al viewport.

### `favorites`

Chiave: `id`, formata da utente, contesto e media. Gli indici composti ripetono le combinazioni della galleria includendo `userId` e `context` nel prefisso.

### `settings`

Impostazioni tecniche e stato del throttling PIN.

## Percorso di una query

1. il controller filtri restituisce cantiere, tipo, autore, data e vista;
2. senza cantiere la query non parte;
3. il query planner sceglie l'indice piu selettivo compatibile;
4. IndexedDB apre un cursore `prev` entro il solo prefisso richiesto;
5. vengono letti al massimo 60 metadati;
6. la chiave dell'ultimo record diventa il cursore della pagina successiva;
7. il DOM visualizza soltanto una finestra di righe attorno allo schermo.

Non esiste un percorso `getAll(media) -> filter()`.

## Upload

Ogni file segue una pipeline indipendente:

1. verifica che cantiere e utente esistano ancora;
2. riconoscimento foto/video;
3. controllo dimensione e durata video;
4. lettura EXIF JPEG, poi data file, infine data upload;
5. seconda verifica transazionale di cantiere e utente, poi scrittura atomica di metadato e blob;
6. aggiornamento avanzamento;
7. passaggio al file successivo anche se il precedente non e valido.

Una miniatura non fa parte della transazione di upload: viene prodotta soltanto quando serve e puo sempre essere rigenerata dall'originale.

## Cancellazioni

La cancellazione media usa una singola transazione sugli store `media`, `mediaBlobs`, `thumbnails` e `favorites`.

Per una cancellazione avviata dall'utente, la transazione include anche `users`: il ruolo corrente e la finestra delle 24 ore vengono rivalutati sul record persistito prima di rimuovere qualsiasi file. Le selezioni estese sono lavorate in batch da 100 elementi.

La creazione o rimozione di un preferito include `users`, `media` e `favorites` nella stessa transazione. In questo modo una cancellazione concorrente non puo lasciare un preferito orfano. Anche la scrittura di una miniatura verifica atomicamente che il media esista ancora.

La cancellazione di un cantiere usa batch da 100 elementi. Prima del primo batch il cantiere passa allo stato tecnico `deleting`; se l'app viene chiusa, un amministratore riprende automaticamente il lavoro al successivo accesso.

## Offline e aggiornamenti

Il Service Worker precachea soltanto l'application shell. I file utente non transitano dalla Cache API: rimangono in IndexedDB.

Le navigazioni usano rete con timeout e fallback alla shell locale. Gli asset statici usano cache-first con aggiornamento in background. Il browser verifica il Service Worker con `updateViaCache: none`; una nuova shell completa viene attivata con `skipWaiting`, prende il controllo delle finestre aperte, elimina le cache obsolete e provoca un solo reload. Gli aggiornamenti devono essere avviati quando non sono in corso operazioni lunghe.

## Regole per estendere il progetto

- aggiungere una responsabilita a un modulo esistente soltanto se appartiene allo stesso dominio;
- creare un nuovo store o indice tramite incremento di `DB_VERSION` e migrazione in `configureSchema`;
- non cambiare una chiave composta senza un test del query planner;
- mantenere i controlli di permesso anche nella funzione che modifica i dati;
- evitare blob nello stato UI o negli array della galleria;
- non richiamare `deleteMediaCascade` dall'interfaccia: e riservata alle cancellazioni amministrative gia autorizzate;
- aggiungere test per ogni regola pura e aggiornare il browser smoke test per i flussi critici;
- registrare ogni modifica in `CHANGELOG.md` secondo Semantic Versioning.

## Verifica prima di una release

```bash
npm test
npm run check
npm run smoke
```

Il test smoke richiede Chromium e verifica primo avvio, creazione cantiere, upload, miniatura, viewer, preferiti, cancellazioni a cascata, Service Worker e riapertura offline.
