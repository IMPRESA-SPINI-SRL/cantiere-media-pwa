# Verifica release 1.1.0

Data: 2026-07-21.

## Controlli completati

- `npm test`: 34 test superati su 34.
- `npm run check`: 30 file JavaScript validi.
- versione `1.1.0` coerente tra `package.json`, configurazione, bootstrap e Service Worker;
- asset PWA e tre icone verificati;
- assenza del precedente pulsante flottante di upload verificata;
- presenza della schermata upload-first e dei tre comandi diretti verificata;
- raggruppamento per data e logica pinch da 2 a 6 colonne verificati con test automatici;
- divieto di scansione completa dello store `media` verificato staticamente.

I test coprono autenticazione PIN, EXIF JPEG, permessi, query planner IndexedDB, condivisione mista, controlli video, date della galleria, densita della griglia, virtualizzazione e priorita del caricamento.

## Browser smoke test incluso

`npm run smoke` automatizza primo amministratore, creazione cantiere, upload diretto, apertura Archivio, intestazioni data, miniature, viewer, preferiti, cancellazione, Service Worker e riapertura offline.

Nel runner usato per preparare la release Chromium e soggetto alla policy aziendale `URLBlocklist: ["*"]` e blocca `127.0.0.1`. Il test e incluso ma il collaudo visuale deve essere eseguito in un browser non gestito:

```bash
npm run smoke
```

È possibile indicare un browser differente:

```bash
CHROMIUM_PATH=/percorso/chromium npm run smoke
```

## Collaudo specifico della release 1.1.0

Su Samsung/Android:

1. aggiornare l'app e controllare `Versione 1.1.0` nel menu;
2. verificare che dopo il login compaia subito la schermata `Carica foto e video`;
3. controllare che cantiere, `Scatta foto`, `Registra video` e `Scegli dalla galleria` siano visibili senza aprire altri menu;
4. eseguire almeno un caricamento con ciascuno dei tre comandi;
5. aprire l'Archivio e verificare le intestazioni `Oggi`, `Ieri` o data estesa;
6. appoggiare due dita sulla griglia e allargarle: le miniature devono diventare piu grandi e le colonne diminuire;
7. avvicinare le dita: le miniature devono diventare piu piccole e le colonne aumentare;
8. verificare che la griglia resti tra 2 e 6 colonne e che la densita scelta rimanga dopo la riapertura;
9. controllare che il pinch non apra accidentalmente un media ne avvii la selezione;
10. verificare pressione prolungata, condivisione ed eliminazione dopo il cambio densita.

Su iPhone/iOS ripetere gli stessi punti, prestando particolare attenzione agli eventi gesture di Safari e ai file HEIC.

## Collaudo generale prima della distribuzione aziendale

1. installazione in modalita standalone;
2. uso completamente offline dopo il primo caricamento;
3. foto con e senza EXIF e video vicini ai limiti;
4. condivisione singola, multipla omogenea e selezione mista separata;
5. permessi di eliminazione prima e dopo 24 ore;
6. eliminazione di un cantiere con molti media e ripresa dopo chiusura forzata;
7. comportamento vicino alla quota massima di storage;
8. aggiornamento senza perdita di utenti, cantieri e media.

La capacita effettiva deve essere misurata sui dispositivi scelti dall'impresa.
