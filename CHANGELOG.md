# Changelog

Tutte le modifiche rilevanti sono registrate in questo file.
Il progetto usa Semantic Versioning.

## [1.4.3] - 2026-07-22

### Modificato

- Le intestazioni `PREFERITI`, `CANTIERI ATTIVI` e `CANTIERI CONCLUSI` nei selettori cantieri sono ora evidenziate con testo rosso aziendale, fondo rosso molto chiaro, bordo laterale e separatore discreto.
- Aumentati leggermente peso, dimensione e spaziatura delle intestazioni per distinguerle chiaramente dai nomi dei cantieri senza appesantire il menu.

## [1.4.2] - 2026-07-22

### Corretto

- Su PC il selettore cantieri non si apre piu come pannello ancorato al bordo inferiore: viene centrato e resta interamente nello spazio visibile.
- L'elenco usa un'altezza massima dedicata e una barra di scorrimento interna, evitando che le ultime righe restino fuori dallo schermo.
- La rotellina del mouse e il trackpad scorrono direttamente l'elenco dei cantieri, senza muovere la pagina sottostante.
- Su smartphone il selettore conserva il comportamento a pannello inferiore.

## [1.4.1] - 2026-07-22

### Corretto

- Il riconoscimento dei duplicati e ora limitato al cantiere selezionato.
- Lo stesso file puo essere archiviato in cantieri diversi, ma non due volte nello stesso cantiere.
- Sostituito l'indice globale univoco con l'indice composto univoco `siteContentHash`.
- La ricerca dei media storici senza impronta usa l'indice mirato `siteTypeSize`, evitando confronti con altri cantieri.

## [1.4.0] - 2026-07-22

### Aggiunto

- Voce `Tutti i cantieri` in testa al selettore dell'Archivio.
- Query cronologica indicizzata su tutti i cantieri, compatibile con filtri per tipo, autore e data.
- Quattro indici IndexedDB globali dedicati per evitare scansioni complete dello store media.

### Modificato

- Ordinamento cantieri uniforme: prima tutti i preferiti in ordine alfabetico, poi gli attivi non preferiti in ordine alfabetico, infine i conclusi non preferiti in ordine alfabetico.
- Preferiti attivi e conclusi riuniti in un unico gruppo alfabetico.
- Palette grafica resa piu neutra: sfondi chiari, componenti grigio antracite, rosso aziendale per le azioni principali e blu limitato ai dettagli di selezione.
- Schermata di caricamento alleggerita eliminando il grande fondale blu.

## [1.2.0] - 2026-07-21

### Aggiunto

- Logo ufficiale Impresa Spini nelle schermate di accesso, caricamento, menu e icone PWA.
- Palette grafica coordinata ai colori blu e rosso del logo aziendale.
- Selettore cantieri con stella accanto a ogni cantiere.
- Cantieri preferiti personali e indipendenti tra schermata di caricamento e Archivio.
- Ordinamento automatico dei cantieri preferiti in testa al rispettivo elenco.
- Test automatici per preferiti cantieri, vincoli di trascinamento e ripristino zoom.

### Corretto

- Il doppio tap su una fotografia gia ingrandita ripristina esattamente la vista iniziale.
- Il trascinamento durante pinch e pan e limitato ai bordi utili della fotografia, evitando distacchi dai bordi dello schermo.
- Il pinch vicino alla scala iniziale scatta automaticamente a `1x`, con posizione centrata.
- Rimossa una duplicazione del campo indirizzo nell'editor cantieri.

### Rimosso

- Sezioni `I miei upload`, `Preferiti archivio` e `Preferiti upload` dal menu di tutti gli utenti.
- Comandi e moduli UI dei preferiti media non piu utilizzati.
- Testi ridondanti `OPERAZIONE PRINCIPALE`, `Seleziona il cantiere e scegli subito come acquisire il materiale.` e `Destinazione: Scegli una delle tre modalita qui sopra` dalla schermata di caricamento.

## [1.1.0] - 2026-07-21

### Aggiunto

- Nuova schermata iniziale dedicata al caricamento, mostrata subito dopo l'accesso.
- Selettore del cantiere in primo piano nella schermata di caricamento.
- Tre comandi diretti e sempre visibili: `Scatta foto`, `Registra video` e `Scegli dalla galleria`.
- Raggruppamento della galleria per data con intestazioni `Oggi`, `Ieri` e data estesa.
- Indicazione del numero di elementi per ogni data.
- Zoom della griglia con due dita, da 2 a 6 colonne, in stile galleria Samsung.
- Memorizzazione locale della densita scelta per la griglia.
- Indicatore temporaneo del numero di colonne durante il gesto di zoom.
- Test automatici per schermata upload-first, raggruppamento per data, pinch zoom e virtualizzazione delle righe.

### Modificato

- L'Archivio non e piu la prima schermata operativa: si apre solo su richiesta dell'utente.
- Rimosso il piccolo pulsante flottante di caricamento.
- Il caricamento diretto apre la finestra di avanzamento solo dopo la scelta o lo scatto dei file.
- Dopo un upload eseguito dalla schermata principale l'Archivio nascosto non viene interrogato, preservando velocita e priorita del flusso di caricamento.
- La virtualizzazione della galleria ora gestisce sia le righe delle miniature sia le intestazioni delle date.

## [1.0.4] - 2026-07-20

### Corretto

- Gestita la selezione mista di foto e video su Android/WhatsApp.
- In caso di selezione mista l'app propone due invii distinti, uno per le foto e uno per i video.
- Evitato il passaggio a WhatsApp di un allegato misto che veniva interpretato come messaggio vuoto.

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
- Manifest, Service Worker, cache applicativa, aggiornamenti, icone e installazione PWA.
- Controllo quota storage e richiesta di persistenza quando supportata.
- Test unitari per autenticazione, permessi, query planner, EXIF e windowing della galleria.
- Documentazione di architettura e modello di sicurezza.
