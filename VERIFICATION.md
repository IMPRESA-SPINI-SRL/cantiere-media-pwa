# Verifica release 1.0.3

Data: 2026-07-20.

## Controlli completati

- `npm test`: 22 test superati su 22.
- `npm run check`: 26 file JavaScript validi, versione coerente, asset PWA e icone verificati.
- verifica HTTP locale della release aggiornata completata con stato 200;
- MIME verificati: manifest `application/json`, Service Worker `text/javascript`;
- header `X-Content-Type-Options: nosniff` presente sul server locale.

I test unitari coprono autenticazione PIN, rimozione dei campi sensibili dalle sessioni, EXIF, permessi di eliminazione, query planner IndexedDB, windowing della galleria e stato/timeline dei controlli video.

## Browser smoke test incluso

`npm run smoke` esegue un flusso Chromium completo: primo amministratore, creazione cantiere, upload foto e video, miniature, viewer, controlli video visibili, preferito, cancellazione a cascata, Service Worker e riapertura offline.

Nel runner usato per preparare questa release il test non ha potuto raggiungere l'applicazione perché Chromium applica una policy aziendale `URLBlocklist: ["*"]`, restituendo la pagina `chrome-error://chromewebdata/`. Il test è quindi incluso ma deve essere eseguito in un ambiente Chromium non gestito:

```bash
npm run smoke
```

È possibile indicare un browser differente:

```bash
CHROMIUM_PATH=/percorso/chromium npm run smoke
```

## Collaudo obbligatorio prima della distribuzione aziendale

Eseguire almeno questi scenari su uno smartphone Android e un iPhone reali:

1. installazione dalla schermata Home e riapertura in modalità standalone;
2. primo avvio, login, blocco dopo PIN errati e cambio PIN;
3. acquisizione da fotocamera e importazione multipla dalla galleria;
4. foto JPEG con EXIF, foto senza EXIF e video vicino ai limiti di 60 secondi e 100 MB;
5. uso completamente offline dopo il primo caricamento;
6. swipe, pinch zoom, doppio tap, trascinamento, pulsante Play centrale, Play/Pausa inferiore, barra di avanzamento e tempi video;
7. condivisione singola e multipla tramite il pannello di sistema;
8. permessi di eliminazione prima e dopo le 24 ore;
9. eliminazione di un cantiere con molti media e ripresa dopo chiusura forzata;
10. comportamento vicino alla quota massima di storage del dispositivo.

La capacità effettiva deve essere misurata sui dispositivi scelti dall'impresa, perché dipende dalla quota concessa dal browser e dallo spazio disponibile.


## Verifica aggiornamento forzato

1. Avviare la release sulla stessa origine usata in precedenza.
2. Aprire `/repair.html`.
3. Verificare il reindirizzamento automatico all'app.
4. Controllare che il menu riporti `Versione 1.0.3`.
5. Verificare che utenti, cantieri e media preesistenti siano ancora disponibili.
6. Aprire un video e controllare il pulsante centrale `▶`, il comando inferiore Play/Pausa, la timeline e i tempi.
