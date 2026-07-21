# Cantiere Media PWA

Versione 1.1.0.

PWA mobile-first per acquisire, importare e consultare foto e video dei cantieri senza un backend obbligatorio. La priorita operativa e il caricamento: dopo il login l'utente trova immediatamente il cantiere e i tre comandi `Scatta foto`, `Registra video` e `Scegli dalla galleria`.

Il progetto usa HTML, CSS e JavaScript Vanilla. Dopo il primo caricamento dell'application shell, login, dati e media locali funzionano offline.

## Avvio locale

Richiede Node.js 22 o superiore.

```bash
npm start
```

Aprire `http://127.0.0.1:8080`.

Per usare una porta diversa:

```bash
PORT=9000 npm start
```

Non aprire direttamente `index.html` con `file://`: moduli ES, Service Worker, Web Crypto e funzioni PWA richiedono un'origine web. In produzione pubblicare l'intera cartella su un hosting statico HTTPS.

## Primo utilizzo

1. Creare il primo amministratore e scegliere un PIN da 4 a 8 cifre.
2. Aprire il menu Amministrazione e creare almeno un cantiere.
3. Nella schermata `Carica`, selezionare il cantiere.
4. Toccare direttamente `Scatta foto`, `Registra video` oppure `Scegli dalla galleria`.
5. Aprire `Archivio` soltanto quando serve consultare il materiale.

La schermata iniziale non legge foto, video o miniature. Una query dell'Archivio parte soltanto quando l'utente lo apre e ha selezionato un cantiere.

## Galleria

L'Archivio:

- raggruppa i media per data con intestazioni `Oggi`, `Ieri` e data estesa;
- mostra il numero di elementi per ciascun giorno;
- ordina dal piu recente;
- permette di allargare o restringere la griglia con due dita;
- supporta da 2 a 6 colonne e conserva la densita scelta sul dispositivo;
- usa paginazione IndexedDB, miniature lazy e virtualizzazione di righe e intestazioni;
- avvia la selezione multipla con pressione prolungata.

Il gesto sulla griglia modifica la dimensione delle miniature. Il pinch dentro il visualizzatore continua invece a ingrandire la singola fotografia.

## Funzioni incluse

- login PIN multiutente con ruoli Amministratore e Utente;
- schermata iniziale upload-first con tre azioni dirette;
- cantieri attivi o conclusi, con doppia conferma di eliminazione;
- upload foto, video e selezione multipla dalla galleria;
- data foto da EXIF JPEG, poi data file, poi data upload;
- limite video di 60 secondi e 100 MB;
- filtri indicizzati per cantiere, tipo, autore e data;
- galleria per data con pinch zoom della griglia;
- viewer fullscreen con swipe, pinch zoom, doppio tap, trascinamento e controlli video applicativi;
- preferiti personali separati tra Archivio e Upload;
- condivisione Web Share singola e multipla;
- separazione in due invii quando Android/WhatsApp non accetta foto e video insieme;
- eliminazione dei propri upload entro 24 ore per utenti normali;
- validazione transazionale di upload, preferiti ed eliminazioni;
- funzionamento offline e installazione PWA.

## Architettura dati

- `users`: utenti, ruolo, stato e credenziali PIN derivate.
- `sites`: cantieri e stato.
- `media`: soli metadati indicizzati.
- `mediaBlobs`: file originali.
- `thumbnails`: miniature generate su richiesta.
- `favorites`: preferiti personali indicizzati per contesto.
- `settings`: impostazioni tecniche e controllo tentativi PIN.

Le query dell'Archivio usano indici composti e cursori discendenti. Non viene eseguito un caricamento completo dei media per poi filtrarli.

## Ripristino sicuro della cache

Quando un browser continua a mostrare una versione precedente, avviare la release corrente e aprire:

```text
http://127.0.0.1:8080/repair.html
```

La pagina rimuove soltanto Service Worker e cache `cantiere-media-shell-*`. Non elimina IndexedDB, utenti, cantieri, foto, video o preferiti.

## Controlli di qualita

```bash
npm test
npm run check
```

Il test end-to-end opzionale richiede Chromium:

```bash
npm run smoke
```

Per indicare un eseguibile differente:

```bash
CHROMIUM_PATH=/percorso/chromium npm run smoke
```

Prima della distribuzione eseguire prove reali su Android e iPhone per fotocamera, selettore file, pinch della griglia, condivisione, installazione e quota storage.

## Aggiornamenti

Il Service Worker controlla gli aggiornamenti all'avvio e quando l'app torna visibile. Il file viene richiesto senza cache HTTP, la nuova shell viene attivata e le cache obsolete vengono rimosse. Eseguire gli aggiornamenti quando non sono in corso upload o cancellazioni.

## Vincoli operativi

Foto, video, utenti e cantieri sono locali al singolo browser/dispositivo. Questa release non include sincronizzazione tra telefoni ne backup centralizzato. La quantita effettiva di originali memorizzabili dipende dalla quota concessa dal browser, dallo spazio libero e dalle politiche del sistema operativo.

Il parser EXIF interno legge JPEG. HEIC/HEIF e alcune varianti di metadati devono essere collaudate sui dispositivi scelti dall'impresa.

## Versionamento

Il progetto segue Semantic Versioning. Ogni modifica deve aggiornare `CHANGELOG.md` e, quando necessario, la versione del database e della cache nel Service Worker.
