# Verifica release 1.8.1

Data: 2026-07-23.

## Controlli automatici completati

- PWA: `npm test`, 65 test superati su 65.
- PWA: `npm run check`, 46 file JavaScript validi e application shell completa.
- Backend: `npm test`, 11 test superati su 11.
- Backend: `npm run check`, sintassi valida per funzioni e librerie.
- Versione PWA `1.8.1` coerente tra `package.json`, configurazione, bootstrap, manifest e Service Worker.
- Versione backend `0.5.0` esposta dall'endpoint pubblico di salute.
- Avvio HTTP statico verificato con caricamento di `index.html`, `app.js` e `central-media-sync.js`.
- Test browser automatico non eseguibile nell'ambiente di build per il blocco organizzativo dell'accesso Chromium a `127.0.0.1`; resta richiesto il collaudo reale sui dispositivi aziendali.

## Archivio aziendale verificato staticamente

- Feed incrementale `/api/media/changes` con checkpoint e paginazione.
- Accesso autenticato `/api/media/access` con URL temporanei per originale e miniatura.
- Eliminazione `/api/media/delete` con controllo ruolo, autore e finestra di 24 ore.
- Unione locale senza duplicazioni tramite `siteId + contentHash`.
- Persistenza dei soli metadati e delle miniature per i media presenti esclusivamente su OneDrive.
- Streaming remoto nel viewer senza scaricare preventivamente l'intero archivio.
- Apertura, condivisione e download dei file centrali soltanto con rete disponibile.
- Propagazione locale dei record `deleted` e `missing`.
- Content Security Policy e application shell aggiornate per i moduli e gli host di consultazione OneDrive/SharePoint.
- Eliminazione definitiva collegata a OneDrive e agli altri dispositivi.

## Invarianti conservati

- Gli originali acquisiti sul dispositivo vengono salvati localmente prima dell'invio remoto.
- La coda offline e la ripresa dei caricamenti della versione 1.7.0 restano attive.
- I file locali restano consultabili offline.
- I file presenti soltanto nell'archivio aziendale richiedono Internet per aprire l'originale.
- La cancellazione di un cantiere nell'app non elimina automaticamente la cartella OneDrive.
- Non sono richieste nuove tabelle Azure.

## Collaudo reale richiesto dopo la distribuzione

1. Pubblicare il backend 0.5.0 e verificare `/api/health` e le tre nuove rotte protette.
2. Pubblicare la PWA 1.8.1 inizialmente soltanto sul PC di prova.
3. Caricare una foto dal telefono ancora in versione 1.7.0.
4. Aprire sul PC l'Archivio del medesimo cantiere e verificare comparsa, miniatura e apertura della foto.
5. Ripetere nella direzione opposta con un video breve.
6. Verificare che un media centrale gia indicizzato sia ancora visibile offline come miniatura, ma mostri un messaggio chiaro quando si tenta di aprire l'originale.
7. Eliminare un media dal PC e verificare la rimozione da OneDrive e dal telefono dopo la sincronizzazione.
8. Soltanto dopo questi controlli distribuire la PWA 1.8.1 agli altri dispositivi.

## Comandi di verifica

PWA:

```bash
npm test
npm run check
```

Backend:

```bash
npm test
npm run check
```

## Correzioni 1.8.1

- Miniatura remota recuperata da `POST /api/media/thumbnail` con sessione autenticata.
- Fotografia inizialmente contenuta nello schermo.
- Pulsanti Riduci, Adatta e Ingrandisci funzionanti; rotellina abilitata su PC.
