# Cantiere Media PWA

Versione 1.0.3.

PWA mobile-first per gestire foto e video dei cantieri senza un backend obbligatorio. Dopo il primo caricamento l'application shell, il login e tutti i media locali funzionano offline. Il progetto usa HTML, CSS e JavaScript Vanilla, senza dipendenze runtime esterne.


## Ripristino sicuro della cache

Quando un browser continua a mostrare una versione precedente dell'interfaccia, avviare il server della release corrente e aprire:

```text
http://127.0.0.1:8080/repair.html
```

La pagina rimuove soltanto il Service Worker e le cache `cantiere-media-shell-*`. Non elimina IndexedDB, utenti, cantieri, foto, video o preferiti.

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

Non aprire direttamente `index.html` con `file://`: moduli ES, Service Worker, Web Crypto e funzioni PWA richiedono un'origine web. In produzione pubblicare l'intera cartella su un hosting statico HTTPS; non e necessario un server applicativo o un database remoto.

## Primo utilizzo

1. Creare il primo amministratore e scegliere un PIN da 4 a 8 cifre.
2. Aprire il menu Amministrazione e creare almeno un cantiere.
3. Selezionare il cantiere nella schermata principale.
4. Usare il pulsante flottante per acquisire o importare foto e video.
5. Tenere premuta una miniatura per iniziare la selezione multipla.

L'app non legge foto o video all'avvio. Una query parte soltanto dopo la scelta del cantiere.

## Funzioni incluse

- login PIN multiutente con ruoli Amministratore e Utente;
- configurazione atomica del primo amministratore e blocco temporaneo dopo tentativi PIN errati;
- cantieri attivi o conclusi, con doppia conferma di eliminazione;
- upload foto, video e selezione multipla dalla galleria;
- data foto da EXIF JPEG, poi data file, poi data upload;
- limite video di 60 secondi e 100 MB;
- filtri indicizzati per cantiere, tipo, autore e data;
- galleria con paginazione, miniature lazy e windowing del DOM;
- viewer fullscreen con swipe, pinch zoom, doppio tap, trascinamento e controlli video sempre visibili (Play/Pausa, avanzamento e tempi);
- preferiti personali separati tra Archivio e Upload;
- condivisione Web Share singola e multipla;
- eliminazione dei propri upload entro 24 ore per utenti normali;
- validazione transazionale di upload, preferiti ed eliminazioni per evitare record orfani tra schede concorrenti;
- funzionamento offline e installazione PWA.

## Architettura dati

- `users`: utenti, ruolo, stato e credenziali PIN derivate.
- `sites`: cantieri e stato.
- `media`: soli metadati indicizzati, mai i blob.
- `mediaBlobs`: file originali.
- `thumbnails`: miniature generate su richiesta.
- `favorites`: preferiti personali indicizzati per contesto.
- `settings`: impostazioni tecniche e controllo tentativi PIN.

Le query della galleria usano indici composti e cursori discendenti. Non viene eseguito un caricamento completo dei media per poi filtrarli. I dettagli sono in `ARCHITECTURE.md`; il modello di sicurezza e descritto in `SECURITY.md`.

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

Prima della distribuzione eseguire anche prove reali su Android e iPhone per fotocamera, selettore file, condivisione, installazione e limiti di quota.

Il controllo statico verifica inoltre che l'interfaccia non possa richiamare direttamente la cancellazione a cascata, che nessun modulo applicativo manchi dalla cache offline e che non venga introdotta una scansione completa dello store `media`.

I risultati della verifica della release e la checklist per il collaudo su dispositivi reali sono in `VERIFICATION.md`.

## Aggiornamenti

Il Service Worker controlla gli aggiornamenti all'avvio e quando l'app torna visibile. Dalla versione 1.0.3 il file del Service Worker viene richiesto senza cache HTTP; quando una nuova shell e pronta viene attivata automaticamente, le cache obsolete vengono rimosse e l'app viene ricaricata una sola volta. Avviare gli aggiornamenti quando non sono in corso upload o cancellazioni.

## Vincoli operativi importanti

L'architettura e preparata per cataloghi molto grandi e mantiene soltanto una finestra limitata di card nel DOM. La quantita effettiva di originali memorizzabili dipende comunque dalla quota concessa dal browser, dallo spazio libero e dalle politiche del sistema operativo. Il menu mostra uso e quota stimati e l'app richiede storage persistente quando disponibile.

Il parser EXIF integrato legge `DateTimeOriginal` dai JPEG. Per formati come HEIC/HEIF, quando i metadati non sono leggibili dal browser, viene usata la data del file.

La release 1.0.3 non sincronizza dispositivi diversi e non include ancora un backup completo. Prima di usare l'app come unica copia di dati aziendali non sostituibili, definire e collaudare una procedura di backup o aggiungere una sincronizzazione opzionale.

Il PIN e un controllo di accesso locale, non una cifratura dei media. Proteggere il dispositivo con blocco schermo e cifratura di sistema.

## Versionamento

Il progetto segue Semantic Versioning. Ogni modifica deve aggiornare `CHANGELOG.md` e, quando necessario, la versione del database e della cache nel Service Worker.
