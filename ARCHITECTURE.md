# Architettura

## Obiettivi e invarianti

Cantiere Media e una PWA offline-first collegata a un backend Azure per autenticazione e cantieri condivisi. Le decisioni tecniche devono preservare questi invarianti:

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
- `media-api.js`: richieste autenticate per creare e confermare sessioni di caricamento centrali.
- `media-sync.js`: coda OneDrive, frammentazione, ripresa, retry e deduplicazione tra dispositivi.
- `upload.js`: ingressi diretti foto/video/galleria, pipeline sequenziale e avanzamento per file.
- `viewer.js`: visualizzatore foto/video, doppio tap, pinch, vincoli di trascinamento e controlli video applicativi.
- `site-favorites.js`: preferenze cantieri personali e indipendenti per Caricamento e Archivio, persistite localmente e sincronizzate nel backend.
- `site-api.js`: chiamate autenticate alle API centrali dei cantieri.
- `site-sync.js`: migrazione non distruttiva, coda offline, riconciliazione e cancellazioni remote.
- `site-picker.js`: elenco cantieri con stella, gruppi preferiti/altri e selezione accessibile.
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

### `mediaSync`

Chiave: `mediaId`. Conserva stato, tentativi, prossimo retry, URL temporaneo della sessione, scadenza e offset gia trasferito. Il record viene eliminato atomicamente quando il corrispondente metadato `media` viene marcato `centralSynced`.

### `thumbnails`

Chiave: `mediaId`. La miniatura viene generata quando la card entra vicino al viewport.

### `favorites`

Store storico dei preferiti media, mantenuto nello schema per compatibilita e per la cancellazione a cascata di eventuali record creati da versioni precedenti. La release 1.4.0 non espone piu viste o comandi per i preferiti media.

### `settings`

Impostazioni tecniche, stato del throttling PIN e preferenze cantieri. Le chiavi dei cantieri preferiti includono `userId` e contesto (`archive` oppure `upload`), quindi le due liste sono indipendenti per ogni utente.

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

## Zoom e vincoli nel viewer

Il viewer mantiene separati scala e spostamento. Per ogni aggiornamento di pinch o pan calcola la dimensione `contain` effettiva della fotografia e limita `translateX` e `translateY` allo spazio realmente eccedente lo schermo. In questo modo non possono comparire vuoti causati da un trascinamento oltre i bordi.

Il doppio tap e reversibile: a scala iniziale porta alla scala predefinita di ingrandimento, mentre a qualsiasi scala superiore torna a `1x`. Al termine del pinch, una scala vicina a quella iniziale viene normalizzata esattamente a `1x` con traslazione zero.

## Preferiti cantieri

I cantieri preferiti non modificano lo store `sites`. Vengono salvati come array di identificatori in `settings`, con chiavi del tipo:

```text
site-favorites::<userId>::archive
site-favorites::<userId>::upload
```

Il selettore usa una finestra personalizzata per mostrare la stella su ogni riga. L'ordinamento e stabile: prima i preferiti, poi gli altri cantieri nell'ordine restituito da `listSites`. Il cambio di preferenza in un contesto non modifica l'altro.

## Pipeline upload

Ogni file segue una pipeline indipendente:

1. verifica preliminare di cantiere e utente;
2. riconoscimento foto/video;
3. controllo dimensione e durata video;
4. lettura EXIF JPEG, poi data file, infine data upload;
5. seconda verifica transazionale e scrittura atomica di metadato, blob e record `mediaSync`;
6. aggiornamento avanzamento locale;
7. passaggio al file successivo anche in caso di file non valido;
8. quando esiste rete, richiesta al backend della sessione OneDrive;
9. invio sequenziale di frammenti da 5 MiB e salvataggio dell'offset;
10. verifica finale backend e rimozione atomica dalla coda.

La miniatura non fa parte della transazione di upload: viene generata soltanto quando serve e puo essere ricreata dall'originale.

## Cancellazioni

La cancellazione media usa una singola transazione sugli store `media`, `mediaBlobs`, `thumbnails` e `favorites`. Per le operazioni utente include anche `users`, rivalutando ruolo e finestra delle 24 ore sul dato persistito. Le selezioni estese sono lavorate in batch da 100.

La cancellazione di un cantiere usa batch da 100. Prima del primo batch il cantiere passa allo stato tecnico `deleting`; dopo un'interruzione un amministratore riprende il lavoro al successivo accesso.

## Offline e aggiornamenti

Il Service Worker precachea l'application shell. I media utente restano in IndexedDB e non transitano dalla Cache API. La coda OneDrive e indipendente dal Service Worker: riparte quando la PWA torna visibile o online.

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


## Archivio trasversale a tutti i cantieri

La selezione `Tutti i cantieri` non esegue scansioni complete. La versione 1.4.0 introduce gli indici globali `allDate`, `allTypeDate`, `allAuthorDate` e `allTypeAuthorDate`, scelti dal query planner in base ai filtri attivi.

## Sessione locale persistente

`auth.js` registra nello store `settings` soltanto l'identificativo dell'utente autenticato e la data di autenticazione. All'avvio `restoreSession()` rilegge il record utente e accetta la sessione esclusivamente se l'utente esiste ed e attivo. Il PIN e le credenziali PBKDF2 non vengono copiati nella sessione.

## Deduplicazione dei media

`file-hash.js` calcola SHA-256 sul contenuto binario completo. Lo store `media` usa:

- indice composto univoco `siteContentHash` (`siteId`, `contentHash`), che impedisce atomicamente due salvataggi dello stesso contenuto nello stesso cantiere ma consente lo stesso file in cantieri differenti;
- indice composto `siteTypeSize` (`siteId`, `mediaType`, `size`), usato per individuare soltanto i possibili duplicati storici privi di hash nel cantiere selezionato.

La migrazione elimina gli indici globali `contentHash` e `typeSize` della release 1.4.0 e crea i nuovi indici per cantiere. Non ricalcola tutte le impronte all'avvio. Quando arriva un nuovo file, vengono esaminati solo i record dello stesso cantiere, con stesso tipo e stessa dimensione; le impronte storiche vengono aggiornate progressivamente.

