# Verifica release 1.6.0

Data: 2026-07-22.

## Controlli completati

- `npm test`: 55 test superati su 55.
- `npm run check`: 36 file JavaScript validi.
- versione `1.6.0` coerente tra `package.json`, configurazione, bootstrap e Service Worker;
- logo Impresa Spini, palette coordinata e nuove icone PWA inclusi nell'application shell;
- asset PWA e tre icone verificate nelle dimensioni dichiarate;
- assenza delle sezioni `I miei upload`, `Preferiti archivio` e `Preferiti upload` verificata;
- assenza dei tre testi ridondanti della schermata di caricamento verificata;
- presenza dei selettori cantieri con stella per Caricamento e Archivio verificata;
- indipendenza dei contesti preferiti `upload` e `archive` verificata;
- doppio tap reversibile, vincoli di trascinamento e snap esatto a `1x` verificati con test automatici;
- raggruppamento per data e logica pinch della griglia da 2 a 6 colonne verificati;
- divieto di scansione completa dello store `media` verificato staticamente.
- ordine cantieri verificato: preferiti alfabetici, attivi non preferiti alfabetici, conclusi non preferiti alfabetici;
- selezione `Tutti i cantieri` disponibile soltanto nell'Archivio;
- query `Tutti i cantieri` servita da quattro indici globali IndexedDB, senza scansione completa;
- palette neutra con rosso aziendale e uso ridotto del blu verificata staticamente;
- sessione persistente verificata: ripristino consentito solo per utente esistente e attivo;
- logout esplicito collegato alla cancellazione della sessione persistente;
- SHA-256 verificato su contenuti identici e differenti;
- indici IndexedDB `siteContentHash` univoco per cantiere e `siteTypeSize` presenti;
- duplicati classificati come ignorati e non salvati;
- compatibilita con media storici senza hash verificata strutturalmente tramite ricerca mirata per tipo e dimensione;
- selettore cantieri desktop centrato, con altezza vincolata al viewport e lista a scorrimento interno;
- gestione esplicita di rotellina e trackpad verificata con test automatico sullo spostamento di `scrollTop`;
- intestazioni dei gruppi cantieri verificate con rosso aziendale, fondo tenue, bordo laterale e gerarchia tipografica rafforzata;


I test coprono autenticazione PIN, EXIF JPEG, permessi, query planner IndexedDB, condivisione mista, controlli video, date della galleria, densita della griglia, virtualizzazione, priorita del caricamento, cantieri preferiti e trasformazioni del viewer.

## Browser smoke test incluso

`npm run smoke` automatizza primo amministratore, creazione cantiere, upload diretto, apertura Archivio, intestazioni data, miniature, viewer, cancellazione, Service Worker e riapertura offline.

Nel runner usato per preparare la release Chromium e soggetto alla policy aziendale `URLBlocklist: ["*"]` e blocca `127.0.0.1`. Il test e incluso ma il collaudo visuale deve essere eseguito in un browser non gestito:

```bash
npm run smoke
```

È possibile indicare un browser differente:

```bash
CHROMIUM_PATH=/percorso/chromium npm run smoke
```

## Collaudo specifico della release 1.6.0

1. verificare che la versione sia visibile sia nella schermata di accesso sia nel menu;
2. con internet attivo, controllare che i cantieri locali esistenti compaiano senza duplicazioni e senza perdita di media;
3. aprire la stessa app su un secondo dispositivo e verificare che l'elenco cantieri sia identico;
4. modificare nome cliente, indirizzo o stato su un dispositivo e verificare l'aggiornamento sull'altro;
5. creare un cantiere in modalità aereo, riattivare la connessione e verificare la sincronizzazione;
6. controllare che i preferiti di Caricamento e Archivio restino indipendenti ma seguano lo stesso utente sugli altri dispositivi;
7. eliminare soltanto un cantiere di prova e verificare la propagazione della cancellazione;
8. verificare nuovamente caricamento, Archivio, zoom, condivisione e funzionamento offline.

## Collaudo generale prima della distribuzione aziendale

1. installazione in modalita standalone;
2. uso completamente offline dopo il primo caricamento;
3. foto con e senza EXIF e video vicini ai limiti;
4. condivisione singola, multipla omogenea e selezione mista separata;
5. permessi di eliminazione prima e dopo 24 ore;
6. eliminazione di un cantiere con molti media e ripresa dopo chiusura forzata;
7. comportamento vicino alla quota massima di storage;
8. aggiornamento senza perdita di utenti, cantieri, media e preferenze cantieri.

La capacita effettiva deve essere misurata sui dispositivi scelti dall'impresa.


## Collaudo specifico di sessione e duplicati

1. accedere con PIN, chiudere completamente l'app senza usare `Esci` e riaprirla: deve aprirsi direttamente sulla schermata di caricamento;
2. premere `Esci` e riaprire l'app: deve ricomparire la richiesta PIN;
3. caricare una foto, poi selezionare nuovamente lo stesso file nello stesso cantiere anche con nome diverso: il secondo caricamento deve essere ignorato;
4. selezionare nello stesso cantiere, in un unico caricamento, due copie identiche e un file diverso: devono risultare un duplicato ignorato e due media complessivi presenti soltanto una volta ciascuno;
5. ripetere la prova con un video breve;
6. caricare la stessa foto o lo stesso video in un cantiere differente: il file deve essere accettato;
7. tornare al primo cantiere e riprovare lo stesso file: deve essere ignorato come duplicato;
8. verificare un file gia salvato con una release precedente: il nuovo tentativo deve essere riconosciuto cercando solo nel cantiere selezionato, senza eseguire una scansione globale dell'archivio.
