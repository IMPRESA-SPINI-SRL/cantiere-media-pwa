# Changelog

Tutte le modifiche rilevanti sono registrate in questo file.
Il progetto usa Semantic Versioning.

## [1.0.3] - 2026-07-20

### Corretto

- Spostati il pulsante Play centrale e la barra Play/Pausa fuori dal contenitore trasformato del media: zoom, gesture e clipping del video non possono piu nasconderli.
- Resi statici nel DOM il pulsante centrale, il comando inferiore, la timeline e il contatore dei tempi, con livelli grafici indipendenti dal video.
- Usati simboli testuali ad alto contrasto (`▶` e `Ⅱ`) per evitare dipendenze da sprite o rendering SVG.
- Aggiunto un bootstrap versionato che rileva automaticamente Service Worker o cache di release precedenti prima di avviare l'app.
- Aggiunta `repair.html`, che rimuove esclusivamente Service Worker e cache dell'application shell senza cancellare IndexedDB, utenti, cantieri, foto, video o preferiti.
- Il Service Worker viene registrato con URL versionato e precarica gli asset ignorando la cache HTTP.

## [1.0.2] - 2026-07-20

### Corretto

- Sostituiti i controlli video dipendenti dal browser con controlli applicativi sempre visibili.
- Aggiunti pulsante Play centrale, pulsante Play/Pausa inferiore, barra di avanzamento e tempi corrente/totale.
- Le icone Play/Pausa ora usano SVG inline completi, senza dipendere dallo sprite della pagina.
- Il video puo essere avviato o fermato anche toccando direttamente l'immagine.
- Reso deterministico l'aggiornamento della PWA: il nuovo Service Worker bypassa la cache HTTP, attiva subito la nuova shell e rimuove le cache obsolete.

## [1.0.1] - 2026-07-20

### Corretto

- Aggiunto un comando Play/Pausa chiaramente visibile al centro del visualizzatore video.
- Resi cliccabili i controlli video nativi evitando che le gesture del viewer intercettino il puntatore.
- Spostata la didascalia dei video sopra la barra dei controlli per impedirne la sovrapposizione.

## [1.0.0] - 2026-07-20

### Aggiunto

- Prima release utilizzabile della PWA offline.
- Login multiutente tramite PIN derivato con PBKDF2.
- Configurazione atomica del primo amministratore e throttling dei tentativi PIN.
- Ruoli Amministratore e Utente.
- Gestione amministrativa di cantieri e utenti.
- Cancellazione cantieri con doppia conferma, avviso media e lavorazione a lotti riprendibile.
- IndexedDB con store separati per utenti, cantieri, metadati, blob originali, miniature, impostazioni e preferiti.
- Indici semplici e composti per query per cantiere, tipo, autore e data.
- Galleria mobile con paginazione a cursore, miniature lazy e windowing del DOM per cataloghi estesi.
- Upload da fotocamera foto, fotocamera video e galleria multipla.
- Data foto con priorita EXIF e fallback alla data file.
- Limiti video configurati a 60 secondi e 100 MB.
- Viewer fullscreen con swipe, pinch zoom, doppio tap e trascinamento.
- Selezione multipla tramite pressione prolungata.
- Condivisione singola e multipla tramite Web Share API, con fallback download singolo.
- Preferiti personali separati tra Archivio e Upload.
- Permessi di eliminazione: propri upload entro 24 ore per utenti, tutti i media per amministratori.
- Rivalutazione transazionale dei permessi prima della cancellazione e lavorazione a batch delle selezioni estese.
- Validazione atomica di cantiere e autore durante il salvataggio per impedire upload orfani in presenza di schede concorrenti.
- Preferiti e miniature protetti da transazioni che impediscono record orfani durante cancellazioni concorrenti.
- Manifest, Service Worker, cache applicativa, aggiornamenti non interruttivi, icone e installazione PWA.
- Controllo quota storage e richiesta di persistenza quando supportata.
- Test unitari per autenticazione, permessi, query planner, EXIF e windowing della galleria.
- Documentazione di architettura e modello di sicurezza.
