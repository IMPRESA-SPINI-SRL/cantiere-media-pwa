# Verifica release 1.3.0

Data: 2026-07-22.

## Controlli completati

- `npm test`: 46 test superati su 46.
- `npm run check`: 32 file JavaScript validi.
- versione `1.3.0` coerente tra `package.json`, configurazione, bootstrap e Service Worker;
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

## Collaudo specifico della release 1.3.0

Su Samsung/Android:

1. aggiornare l'app e controllare `Versione 1.3.0` nel menu;
2. verificare logo, sfondi neutri, azioni rosse e uso limitato del blu;
3. aprire il selettore della schermata Carica e verificare l'ordine: preferiti alfabetici, attivi alfabetici, conclusi alfabetici;
4. aprire l'Archivio e verificare che i preferiti del relativo selettore siano indipendenti da quelli del Caricamento;
5. selezionare `Tutti i cantieri` e verificare che la galleria mostri media provenienti da cantieri diversi rispettando tipo, autore e data;
6. aprire una fotografia e usare il doppio tap per ingrandire, quindi un secondo doppio tap per tornare esattamente alla vista iniziale;
7. ingrandire con pinch e trascinare con una e due dita fino ai limiti: la foto non deve staccarsi dai bordi utili;
8. ridurre la foto vicino alla scala iniziale: deve ricentrarsi e tornare esattamente a `1x`;
9. verificare che swipe tra media e controlli video continuino a funzionare;
10. controllare che nel menu non compaiano le tre sezioni media personali rimosse.

Su iPhone/iOS ripetere gli stessi punti, prestando particolare attenzione agli eventi gesture di Safari e ai file HEIC.

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
