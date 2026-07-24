# Cantiere Media PWA

Versione 1.8.1.

Le intestazioni dei gruppi cantieri nei selettori sono evidenziate con la palette rossa aziendale per una lettura piu immediata.

PWA mobile-first per acquisire, importare e consultare foto e video dei cantieri. Autenticazione, cantieri e indice dei media sono centralizzati nel backend Azure; gli originali vengono salvati subito sul dispositivo per l'uso offline e poi copiati automaticamente nella cartella OneDrive del cantiere. La priorita operativa e il caricamento: dopo il login l'utente trova immediatamente il cantiere e i tre comandi `Scatta foto`, `Registra video` e `Scegli dalla galleria`.

Il progetto usa HTML, CSS e JavaScript Vanilla. Dopo il primo caricamento dell'application shell, login, dati e media locali funzionano offline.


## Accesso persistente

Dopo un accesso PIN corretto, la sessione resta attiva sul dispositivo anche chiudendo o riaprendo la PWA. Il PIN viene richiesto nuovamente dopo `Esci`, se l'utente viene disattivato oppure se vengono cancellati i dati dell'app. Non vengono memorizzati PIN in chiaro.


## Cantieri centralizzati

Dalla versione 1.6.0 l'app sincronizza lo stesso elenco cantieri tra tutti i dispositivi autorizzati. I cantieri locali già presenti vengono migrati automaticamente senza cancellare foto o video. Creazione, modifica ed eliminazione funzionano anche offline: l'operazione resta in attesa e viene inviata al backend quando torna la connessione. I preferiti sono sincronizzati per utente e restano indipendenti tra Caricamento e Archivio.

Il nome della cartella OneDrive viene inizialmente fissato uguale al nome del cantiere e rimane stabile anche se cambia lo stato del cantiere.

## Sincronizzazione media OneDrive

Ogni foto o video viene prima salvato integralmente in IndexedDB. La coda `mediaSync` avvia poi il caricamento diretto verso OneDrive senza far transitare il file attraverso Azure Functions. I caricamenti interrotti vengono ripresi e lo stato e visibile nella schermata `Carica`.

I media gia presenti sul dispositivo al passaggio alla versione 1.7.0 vengono messi automaticamente in coda. La deduplicazione centrale usa cantiere e SHA-256, quindi due dispositivi non creano una seconda copia dello stesso contenuto nello stesso cantiere. Lo stesso file resta invece ammesso in cantieri differenti.

## Archivio aziendale centralizzato

La versione 1.8.1 sincronizza nell'Archivio i metadati di foto e video caricati da tutti i dispositivi autorizzati. La PWA scarica e conserva localmente le miniature, mentre apre l'originale direttamente da OneDrive tramite un collegamento temporaneo. Non viene duplicato automaticamente sul dispositivo l'intero archivio aziendale.

I file acquisiti sul dispositivo restano disponibili offline. Per aprire, condividere o scaricare un file presente soltanto nell'archivio centrale serve Internet. L'eliminazione autorizzata e definitiva: rimuove il file da OneDrive e propaga la rimozione agli altri dispositivi.

## Controllo duplicati

Ogni nuovo file viene identificato con SHA-256 sull'intero contenuto. Un duplicato esatto viene ignorato anche se ha un nome differente o viene selezionato in un altro caricamento, ma il controllo vale soltanto nel cantiere selezionato. Lo stesso file puo quindi essere archiviato in cantieri diversi. Per i media creati con release precedenti, l'impronta viene calcolata solo sui candidati dello stesso cantiere, dello stesso tipo e della stessa dimensione, evitando una scansione completa del database.

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

1. Attivare l'utente aziendale con il codice personale e scegliere un PIN di 6 cifre.
2. Attendere la sincronizzazione automatica dei cantieri oppure crearne uno dal menu Amministrazione.
3. Nella schermata `Carica`, selezionare il cantiere.
4. Toccare direttamente `Scatta foto`, `Registra video` oppure `Scegli dalla galleria`.
5. Controllare il riquadro OneDrive: il salvataggio locale e immediato, mentre la copia aziendale puo proseguire in background.
6. Aprire `Archivio` per sincronizzare e consultare il materiale aziendale del cantiere selezionato.

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

## Zoom della singola fotografia

Nel viewer fotografico:

- il doppio tap alterna tra ingrandimento e vista iniziale;
- il pan con uno o due dita resta vincolato ai bordi utili della fotografia;
- avvicinando il pinch alla scala iniziale, la foto scatta esattamente a `1x` e si ricentra;
- la foto non puo essere trascinata fino a lasciare aree vuote oltre i limiti consentiti.

## Cantieri preferiti

Ogni utente puo toccare la stella accanto a un cantiere. I preferiti vengono mostrati prima degli altri cantieri. Le preferenze sono personali e indipendenti:

- i preferiti scelti nella schermata `Carica` influenzano solo quel selettore;
- i preferiti scelti nell'`Archivio` influenzano solo il selettore dell'Archivio.

Le sezioni media `I miei upload`, `Preferiti archivio` e `Preferiti upload` non fanno piu parte del menu.

Su PC il selettore cantieri si apre centrato nello schermo, con altezza limitata e scorrimento interno tramite rotellina del mouse o trackpad. Su smartphone resta un pannello inferiore ottimizzato per il tocco.

## Funzioni incluse

- login PIN multiutente con ruoli Amministratore e Utente;
- schermata iniziale upload-first con tre azioni dirette;
- cantieri attivi o conclusi, con doppia conferma di eliminazione;
- upload foto, video e selezione multipla dalla galleria;
- data foto da EXIF JPEG, poi data file, poi data upload;
- limite video di 180 secondi e 500 MB;
- filtri indicizzati per cantiere, tipo, autore e data;
- galleria per data con pinch zoom della griglia;
- viewer fullscreen con swipe, pinch zoom vincolato ai bordi, doppio tap avanti/indietro, ripristino esatto a `1x` e controlli video applicativi;
- cantieri preferiti personali, con elenchi indipendenti tra Caricamento e Archivio;
- logo e colori coordinati all'identita visiva Impresa Spini;
- condivisione Web Share singola e multipla;
- separazione in due invii quando Android/WhatsApp non accetta foto e video insieme;
- eliminazione dei propri upload entro 24 ore per utenti normali;
- validazione transazionale di upload ed eliminazioni;
- funzionamento offline e installazione PWA.

## Architettura dati

- `users`: utenti, ruolo, stato e credenziali PIN derivate.
- `sites`: cantieri e stato.
- `media`: soli metadati indicizzati.
- `mediaBlobs`: file originali.
- `thumbnails`: miniature generate su richiesta.
- `favorites`: store storico mantenuto per compatibilita con dati di release precedenti; non e esposto nell'interfaccia 1.8.1.
- `settings`: impostazioni tecniche, controllo tentativi PIN e cantieri preferiti per utente e contesto.

Le query dell'Archivio usano indici composti e cursori discendenti. Non viene eseguito un caricamento completo dei media per poi filtrarli.

## Ripristino sicuro della cache

Quando un browser continua a mostrare una versione precedente, avviare la release corrente e aprire:

```text
http://127.0.0.1:8080/repair.html
```

La pagina rimuove soltanto Service Worker e cache `cantiere-media-shell-*`. Non elimina IndexedDB, utenti, cantieri, foto, video o preferenze cantieri.

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

Foto e video acquisiti localmente restano nel browser/dispositivo e vengono anche copiati su OneDrive. L'Archivio riceve dagli altri dispositivi metadati e miniature, ma non scarica automaticamente tutti gli originali: per aprire un file esclusivamente centrale serve Internet. La quantita di originali e miniature conservabili localmente dipende dalla quota concessa dal browser, dallo spazio libero e dalle politiche del sistema operativo.

Il parser EXIF interno legge JPEG. HEIC/HEIF e alcune varianti di metadati devono essere collaudate sui dispositivi scelti dall'impresa.

## Versionamento

Il progetto segue Semantic Versioning. Ogni modifica deve aggiornare `CHANGELOG.md` e, quando necessario, la versione del database e della cache nel Service Worker.
